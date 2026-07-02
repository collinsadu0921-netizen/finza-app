import { NextRequest, NextResponse } from "next/server"

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import {
  getProfitAndLossReport,
  type PnLReportLoadMeta,
  type PnLReportResponse,
} from "@/lib/accounting/reports/getProfitAndLossReport"
import { resolvePnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"
import {
  buildPnlReportCacheKey,
  buildPnlReportQueryFingerprint,
  loadOrComputePnlReportCache,
  shouldCachePnlReportPayload,
} from "@/lib/server/pnlReportCache"
import {
  authFailureStageForScopeError,
  resolveAuthenticatedApiUser,
} from "@/lib/server/resolveAuthenticatedApiUser"
import {
  buildReportsPnlDiagnostics,
  isReportsPnlRefreshOnRequestEnabled,
  reportsPnlResponseHeaders,
  resolveReportsPnlSource,
  type ReportsPnlDiagnostics,
} from "@/lib/server/reportsPnlRefreshPolicy"
import { createRouteDiag, supabaseErrorDiag, timedStepMs } from "@/lib/server/routeDiagnostics"

function attachReportsDiagnostics(
  payload: PnLReportResponse,
  diagnostics: ReportsPnlDiagnostics
): PnLReportResponse & ReportsPnlDiagnostics {
  return { ...payload, ...diagnostics }
}

function jsonWithReportsDiagnostics(
  payload: PnLReportResponse,
  diagnostics: ReportsPnlDiagnostics,
  status = 200
) {
  return NextResponse.json(attachReportsDiagnostics(payload, diagnostics), {
    status,
    headers: reportsPnlResponseHeaders(diagnostics),
  })
}

/**
 * GET /api/accounting/reports/profit-and-loss
 *
 * Canonical P&L — ledger period movement via getProfitAndLossReport.
 * Full final-response process cache + singleflight (default TTL 30s).
 */
export async function GET(request: NextRequest) {
  let diag = createRouteDiag("reports_pnl")
  const refreshOnRequest = isReportsPnlRefreshOnRequestEnabled()

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
      reports_refresh_on_request: refreshOnRequest ? "enabled" : "disabled",
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

    const cacheKey = buildPnlReportCacheKey({
      businessId,
      movementStart: range.movementStart,
      movementEnd: range.movementEnd,
      queryFingerprint: buildPnlReportQueryFingerprint(reportInput),
      refreshOnRequest,
    })

    const tReport = performance.now()
    const { value: cached, cacheStatus, servedExpiredCache } =
      await loadOrComputePnlReportCache<PnLReportResponse>(
        cacheKey,
        async () => {
          const loadMeta: PnLReportLoadMeta = {
            movementSource: "unavailable",
            snapshotStale: false,
          }
          const { data, error } = await getProfitAndLossReport(
            supabase,
            reportInput,
            { refreshOnRequest },
            loadMeta
          )
          if (error || !data) {
            return null
          }
          return { payload: data, loadMeta }
        },
        {
          shouldStore: shouldCachePnlReportPayload,
          serveExpiredOnMiss: true,
        }
      )

    const loadMeta = cached.loadMeta
    const reportsSource = resolveReportsPnlSource({
      cacheStatus,
      movementSource: loadMeta.movementSource,
      snapshotStale: loadMeta.snapshotStale,
      servedExpiredCache,
    })

    const reportsDiagnostics = buildReportsPnlDiagnostics({
      refreshOnRequest,
      reportsSource,
      cacheStatus,
      snapshotStale: loadMeta.snapshotStale || servedExpiredCache,
    })

    if (
      loadMeta.movementSource === "unavailable" &&
      cacheStatus !== "hit" &&
      cacheStatus !== "expired_served"
    ) {
      diag.fail(503, "PNL_SNAPSHOT_UNAVAILABLE", {
        ms_report: Math.round((performance.now() - tReport) * 10) / 10,
        ...reportsDiagnostics,
      })
      return NextResponse.json(
        { error: "PNL_SNAPSHOT_UNAVAILABLE", ...reportsDiagnostics },
        {
          status: 503,
          headers: reportsPnlResponseHeaders(reportsDiagnostics),
        }
      )
    }

    diag.step("report", {
      ms_report: Math.round((performance.now() - tReport) * 10) / 10,
      ...reportsDiagnostics,
    })
    diag.finish(200, reportsDiagnostics)
    return jsonWithReportsDiagnostics(cached.data, reportsDiagnostics)
  } catch (err: unknown) {
    console.error("Error in profit & loss:", err)
    diag.fail(500, err instanceof Error ? err.message : "Internal server error")
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
