import { NextRequest, NextResponse } from "next/server"

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"
import { resolvePnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"
import {
  buildPnlReportCacheKey,
  buildPnlReportQueryFingerprint,
  loadOrComputePnlReportCache,
  pnlReportCacheSourceForDiag,
  shouldCachePnlReportPayload,
} from "@/lib/server/pnlReportCache"
import {
  authFailureStageForScopeError,
  resolveAuthenticatedApiUser,
} from "@/lib/server/resolveAuthenticatedApiUser"
import { createRouteDiag, supabaseErrorDiag, timedStepMs } from "@/lib/server/routeDiagnostics"

type PnlReportComputeResult =
  | { ok: true; data: NonNullable<Awaited<ReturnType<typeof getProfitAndLossReport>>["data"]> }
  | { ok: false; error: string }

/**
 * GET /api/accounting/reports/profit-and-loss
 *
 * Canonical P&L — ledger period movement via getProfitAndLossReport.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date, end_date (optional).
 *
 * Auth: session-first (same pattern as operational list routes). Middleware validates
 * accounting API access; this handler resolves user + business scope without a second
 * Auth-server getUser() when the signed session cookie is valid.
 */
export async function GET(request: NextRequest) {
  let diag = createRouteDiag("reports_pnl")
  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const auth = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: request.headers.get("cookie"),
    })

    if (!auth.ok) {
      diag.fail(auth.status, auth.error, { auth_failure_stage: auth.authFailureStage })
      return NextResponse.json(
        { error: auth.error, auth_failure_stage: auth.authFailureStage },
        { status: auth.status }
      )
    }

    const { searchParams } = new URL(request.url)
    const scope = await resolveBusinessScopeForUser(
      supabase,
      auth.user.id,
      searchParams.get("business_id") ?? searchParams.get("businessId")
    )

    if (!scope.ok) {
      const authFailureStage = authFailureStageForScopeError(scope.status)
      diag.fail(scope.status, scope.error, { auth_failure_stage: authFailureStage })
      return NextResponse.json(
        { error: scope.error, auth_failure_stage: authFailureStage },
        { status: scope.status }
      )
    }

    const businessId = scope.businessId
    diag = createRouteDiag("reports_pnl", businessId)

    const authority = await checkAccountingAuthority(supabase, auth.user.id, businessId, "read")
    if (!authority.authorized) {
      diag.fail(403, "forbidden", { auth_failure_stage: "business_access_denied" })
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view profit & loss." },
        { status: 403 }
      )
    }

    diag.step("auth", {
      ms_auth: Math.round((performance.now() - tAuth) * 10) / 10,
      auth_source: auth.authSource,
    })

    const tReady = performance.now()
    const { ready } = await checkAccountingReadiness(supabase, businessId)
    if (!ready) {
      if (canUserInitializeAccounting(authority.authority_source)) {
        const tBootstrap = performance.now()
        const { error: bootstrapError } = await supabase.rpc("create_system_accounts", {
          p_business_id: businessId,
        })
        diag.step("bootstrap_accounts", {
          ms_bootstrap: timedStepMs(tBootstrap),
          ...(bootstrapError ? supabaseErrorDiag(bootstrapError) : {}),
        })
      } else {
        diag.fail(403, "accounting_not_ready")
        return NextResponse.json(
          {
            error: "ACCOUNTING_NOT_READY",
            business_id: businessId,
            authority_source: authority.authority_source,
          },
          { status: 403 }
        )
      }
    }
    diag.step("readiness", {
      ready,
      ms_readiness: timedStepMs(tReady),
    })

    const reportInput = {
      businessId,
      period_id: searchParams.get("period_id") ?? undefined,
      period_start: searchParams.get("period_start") ?? undefined,
      as_of_date: searchParams.get("as_of_date") ?? undefined,
      start_date: searchParams.get("start_date") ?? undefined,
      end_date: searchParams.get("end_date") ?? undefined,
    }

    const tRange = performance.now()
    const { range, error: rangeError } = await resolvePnLMovementRange(supabase, reportInput)
    if (rangeError || !range) {
      diag.fail(500, rangeError ?? "period_unresolved", {
        ms_period: timedStepMs(tRange),
      })
      return NextResponse.json(
        { error: rangeError ?? "Accounting period could not be resolved" },
        { status: 500 }
      )
    }
    diag.step("period_resolve", {
      ms_period: timedStepMs(tRange),
      period_start: range.movementStart,
      period_end: range.movementEnd,
    })

    const cacheKey = buildPnlReportCacheKey(
      businessId,
      range.movementStart,
      range.movementEnd,
      buildPnlReportQueryFingerprint(reportInput)
    )

    const tReport = performance.now()
    const { value: reportResult, source, cache_enabled } =
      await loadOrComputePnlReportCache<PnlReportComputeResult>(
        cacheKey,
        async () => {
          const { data, error } = await getProfitAndLossReport(supabase, reportInput)
          if (error || !data) {
            return { ok: false, error: error || "Accounting period could not be resolved" }
          }
          return { ok: true, data }
        },
        { shouldStore: (result) => result.ok && shouldCachePnlReportPayload(result.data) }
      )

    const cacheSource = pnlReportCacheSourceForDiag(source, cache_enabled)

    if (!reportResult.ok) {
      diag.fail(500, reportResult.error, {
        rpc: "get_profit_and_loss_movement",
        ms_report: Math.round((performance.now() - tReport) * 10) / 10,
        cache_source: cacheSource,
      })
      return NextResponse.json({ error: reportResult.error }, { status: 500 })
    }

    diag.step("report", {
      rpc: "get_profit_and_loss_movement",
      ms_report: Math.round((performance.now() - tReport) * 10) / 10,
      cache_source: cacheSource,
    })
    diag.finish(200, { cache_source: cacheSource })
    return NextResponse.json(reportResult.data)
  } catch (err: unknown) {
    console.error("Error in profit & loss:", err)
    diag.fail(500, err instanceof Error ? err.message : "Internal server error")
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
