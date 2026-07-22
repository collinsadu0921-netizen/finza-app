import { NextRequest, NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import {
  getProfitAndLossReport,
  type PnLReportLoadMeta,
  type PnLReportResponse,
} from "@/lib/accounting/reports/getProfitAndLossReport"
import { resolvePnLMovementRangeForPnlRoute } from "@/lib/server/pnlReportDefaultPeriodCache"
import { checkAccountingReadinessForPnlRoute } from "@/lib/server/pnlReportReadinessCache"
import { resolvePnlReportScopeAndAuthority } from "@/lib/server/pnlReportScopeCache"
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
    const requestedBusinessId = searchParams.get("business_id") ?? searchParams.get("businessId")

    const gate = await resolvePnlReportScopeAndAuthority(
      supabase,
      auth.user.id,
      requestedBusinessId
    )

    if (!gate.ok && "scope" in gate && !gate.scope.ok) {
      const authFailureStage = authFailureStageForScopeError(gate.scope.status)
      diag.fail(gate.scope.status, gate.scope.error, {
        auth_failure_stage: authFailureStage,
        pnl_scope_cache: gate.pnlScopeCacheStatus,
      })
      return NextResponse.json(
        { error: gate.scope.error, auth_failure_stage: authFailureStage },
        { status: gate.scope.status }
      )
    }

    if (!gate.ok) {
      diag.fail(403, "forbidden", {
        auth_failure_stage: "business_access_denied",
        pnl_scope_cache: gate.pnlScopeCacheStatus,
      })
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view profit & loss." },
        { status: 403 }
      )
    }

    const { businessId, authority } = gate.value
    diag = createRouteDiag("reports_pnl", businessId)

    diag.step("auth", {
      ms_auth: Math.round((performance.now() - tAuth) * 10) / 10,
      auth_source: auth.authSource,
      reports_refresh_on_request: refreshOnRequest ? "enabled" : "disabled",
      pnl_scope_cache: gate.pnlScopeCacheStatus,
    })

    const tReady = performance.now()
    const { ready, readinessCacheStatus } = await checkAccountingReadinessForPnlRoute(
      supabase,
      businessId
    )
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
      readiness_cache: readinessCacheStatus,
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
    const {
      range,
      error: rangeError,
      periodCacheStatus,
    } = await resolvePnLMovementRangeForPnlRoute(supabase, reportInput)
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
      period_cache: periodCacheStatus,
    })

    const cacheKey = buildPnlReportCacheKey({
      businessId,
      movementStart: range.movementStart,
      movementEnd: range.movementEnd,
      queryFingerprint: buildPnlReportQueryFingerprint(reportInput),
      refreshOnRequest,
    })

    const tReport = performance.now()
    const {
      value: cached,
      cacheStatus,
      servedExpiredCache,
      remoteCacheStatus,
      remoteRefreshStarted,
      timing: cacheTiming,
    } =
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
            {
              refreshOnRequest,
              scheduleBackground: (promise) => waitUntil(promise),
            },
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
          businessId,
          cacheRemote: !refreshOnRequest,
          scheduleBackground: (promise) => waitUntil(promise),
        }
      )

    const loadMeta = cached.loadMeta

    const remoteCacheHeader =
      remoteCacheStatus === "hit"
        ? "hit"
        : remoteCacheStatus === "stale_hit"
          ? "stale_hit"
          : remoteCacheStatus === "error"
            ? "error"
            : "miss"

    const reportsCacheHeader =
      remoteCacheStatus === "hit"
        ? "fresh_hit"
        : remoteCacheStatus === "stale_hit"
          ? remoteRefreshStarted
            ? "refresh_started"
            : "stale_hit"
          : cacheStatus === "hit"
            ? "fresh_hit"
            : cacheStatus === "expired_served" || servedExpiredCache
              ? "stale_hit"
              : "miss"

    const reportsSource =
      remoteCacheStatus === "stale_hit" || cacheStatus === "expired_served" || servedExpiredCache
        ? "stale_cache"
        : remoteCacheStatus === "hit" || cacheStatus === "hit"
          ? "cache"
          : loadMeta.movementSource === "snapshot" || loadMeta.movementSource === "zero_initialized"
            ? loadMeta.snapshotStale
              ? "stale_snapshot"
              : "fresh_snapshot"
            : loadMeta.movementSource === "ledger"
              ? "fresh_snapshot"
              : // For unavailable, still emit a stable header value (avoid "unavailable" in cache metadata)
                "fresh_snapshot"

    const reportsDiagnostics = buildReportsPnlDiagnostics({
      refreshOnRequest,
      reportsSource,
      cacheHeader: reportsCacheHeader,
      remoteCacheHeader,
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
      ms_remote_cache_read: cacheTiming.remoteCacheReadMs,
      ms_stale_return: cacheTiming.staleReturnMs,
      reports_refresh_scheduled: cacheTiming.refreshScheduled,
      reports_refresh_awaited: cacheTiming.refreshAwaited,
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
