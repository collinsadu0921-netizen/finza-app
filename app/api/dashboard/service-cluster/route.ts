/**
 * GET /api/dashboard/service-cluster?business_id=...&periods=12&activity_limit=10
 *
 * Sequenced dashboard load: timeline → metrics → activity (one HTTP round-trip).
 * Replaces concurrent client-side fan-out to service-metrics/timeline/activity.
 *
 * Operational load gate: FINZA_DASHBOARD_CLUSTER_REFRESH_ON_REQUEST unset/0 (default)
 * reads summary/cache only — no refresh or live metrics RPC in the request path.
 */

import { NextRequest, NextResponse } from "next/server"
import { waitUntil } from "@vercel/functions"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import {
  dashboardClusterCacheResponseHeaders,
  loadOrComputeDashboardClusterCache,
  loadOrComputeDashboardActivityCache,
  type DashboardClusterCacheSource,
} from "@/lib/server/dashboardClusterCache"
import {
  isDashboardClusterReady,
  resolveDashboardClusterStatus,
  type DashboardClusterStatus,
} from "@/lib/server/dashboardClusterStatus"
import {
  dashboardRefreshOnRequestDiag,
  dashboardRefreshSkipped,
  isDashboardClusterRefreshOnRequestEnabled,
  resolveDashboardClusterSource,
  type DashboardClusterSource,
} from "@/lib/server/dashboardClusterRefreshPolicy"
import { loadServiceDashboardActivityFeed } from "@/lib/server/serviceDashboardActivityLoader"
import {
  loadServiceDashboardMetrics,
  type ServiceDashboardMetricsLoadMeta,
  type ServiceDashboardMetricsPayload,
} from "@/lib/server/serviceDashboardMetricsLoader"
import {
  loadServiceDashboardTimeline,
  shouldCacheDashboardClusterPayload,
  type ServiceDashboardTimelineItem,
} from "@/lib/server/serviceDashboardTimeline"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { createRouteDiag, isRouteDiagnosticsEnabled, type RouteDiagFields } from "@/lib/server/routeDiagnostics"

const DEFAULT_PERIODS = 12
const MAX_PERIODS = 24
const DEFAULT_ACTIVITY_LIMIT = 10
const MAX_ACTIVITY_LIMIT = 15

function devClusterLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production" && !isRouteDiagnosticsEnabled()) return
  console.info(`[service-cluster] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

export type ServiceDashboardClusterPayload = {
  timeline: ServiceDashboardTimelineItem[]
  metrics: ServiceDashboardMetricsPayload
  activity: { items: Awaited<ReturnType<typeof loadServiceDashboardActivityFeed>>["items"] }
  timelineSource?: string
  timelineCacheable?: boolean
  dashboard_refresh_on_request: ReturnType<typeof dashboardRefreshOnRequestDiag>
  dashboard_refresh_skipped: boolean
  dashboard_source: DashboardClusterSource
  dashboard_status?: DashboardClusterStatus
  dashboard_ready?: boolean
}

function preparingClusterPayload(refreshOnRequest: boolean): ServiceDashboardClusterPayload {
  return {
    timeline: [],
    metrics: {
      period: { period_start: "", period_end: "", resolution_reason: "preparing" },
      currency: { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
      revenue: 0,
      expenses: 0,
      netProfit: 0,
      cashCollected: 0,
      accountsReceivable: 0,
      accountsPayable: 0,
      cashBalance: 0,
      positionBalancesAsOfToday: true,
      positionAsOfDate: "",
      previousPeriod: null,
      unpaidInvoicesTotal: 0,
      unpaidInvoicesCount: 0,
      overdueInvoicesTotal: 0,
      overdueInvoicesCount: 0,
    },
    activity: { items: [] },
    timelineSource: "preparing",
    timelineCacheable: false,
    dashboard_refresh_on_request: dashboardRefreshOnRequestDiag(),
    dashboard_refresh_skipped: dashboardRefreshSkipped(refreshOnRequest),
    dashboard_source: "degraded",
    dashboard_status: "preparing",
    dashboard_ready: false,
  }
}

function attachDashboardClusterMetadata(
  value: ServiceDashboardClusterPayload,
  cacheSource: DashboardClusterCacheSource,
  servedFromCache: boolean
): ServiceDashboardClusterPayload {
  const dashboard_status = resolveDashboardClusterStatus(cacheSource, value)
  const dashboard_ready = isDashboardClusterReady(dashboard_status)
  return {
    ...value,
    dashboard_source: servedFromCache ? "cache" : value.dashboard_source,
    dashboard_status,
    dashboard_ready,
  }
}

function clusterPayloadShouldStore(payload: ServiceDashboardClusterPayload): boolean {
  if (payload.dashboard_ready === false || payload.dashboard_status === "preparing") {
    return false
  }
  if (payload.metrics?.metrics_ready === false) {
    return false
  }
  return shouldCacheDashboardClusterPayload(payload)
}

function emptyDegradedClusterPayload(
  refreshOnRequest: boolean,
  metrics?: ServiceDashboardMetricsPayload
): ServiceDashboardClusterPayload {
  return {
    timeline: [],
    metrics:
      metrics ??
      ({
        period: { period_start: "", period_end: "", resolution_reason: "degraded" },
        currency: { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
        revenue: 0,
        expenses: 0,
        netProfit: 0,
        cashCollected: 0,
        accountsReceivable: 0,
        accountsPayable: 0,
        cashBalance: 0,
        positionBalancesAsOfToday: true,
        positionAsOfDate: "",
        previousPeriod: null,
        unpaidInvoicesTotal: 0,
        unpaidInvoicesCount: 0,
        overdueInvoicesTotal: 0,
        overdueInvoicesCount: 0,
      } satisfies ServiceDashboardMetricsPayload),
    activity: { items: [] },
    timelineSource: "degraded",
    timelineCacheable: true,
    dashboard_refresh_on_request: dashboardRefreshOnRequestDiag(),
    dashboard_refresh_skipped: dashboardRefreshSkipped(refreshOnRequest),
    dashboard_source: "degraded",
  }
}

async function loadDashboardCluster(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  options: {
    periodsParam: number
    activityLimit: number
    periodStart?: string
    previousPeriodStart?: string
    refreshOnRequest: boolean
  },
  diag: ReturnType<typeof createRouteDiag>
): Promise<ServiceDashboardClusterPayload> {
  const loaderOptions = { refreshOnRequest: options.refreshOnRequest }
  const metricsMeta: ServiceDashboardMetricsLoadMeta = { source: "degraded" }

  const tTimeline = performance.now()
  const timelineResult = await loadServiceDashboardTimeline(
    supabase,
    businessId,
    options.periodsParam,
    diag,
    loaderOptions
  )
  const { timeline, source: timelineSource } = timelineResult
  devClusterLog(`timeline (${timelineSource})`, tTimeline)

  let previousPeriodStart = options.previousPeriodStart
  if (options.periodStart && !previousPeriodStart) {
    const idx = timeline.findIndex((t) => t.period_start === options.periodStart)
    if (idx > 0) {
      previousPeriodStart = timeline[idx - 1].period_start
    }
  }

  const tMetrics = performance.now()
  let metrics: ServiceDashboardMetricsPayload
  try {
    metrics = await loadServiceDashboardMetrics(
      supabase,
      businessId,
      {
        periodStart: options.periodStart,
        previousPeriodStart,
      },
      diag,
      loaderOptions,
      metricsMeta
    )
  } catch (err) {
    if (!options.refreshOnRequest) {
      console.warn(
        "[service-cluster] metrics degraded:",
        err instanceof Error ? err.message : "metrics_load_failed"
      )
      metrics = emptyDegradedClusterPayload(options.refreshOnRequest).metrics
      metricsMeta.source = "degraded"
    } else {
      throw err
    }
  }
  devClusterLog("metrics", tMetrics)

  const activityCacheKey = `activity|${businessId}|${options.activityLimit}`
  const tActivity = performance.now()
  const { value: activity, source: activityCacheSource } = await loadOrComputeDashboardActivityCache(
    activityCacheKey,
    () =>
      loadServiceDashboardActivityFeed(
        supabase,
        businessId,
        options.activityLimit,
        diag,
        { degradeOnError: !options.refreshOnRequest }
      )
  )
  devClusterLog(`activity (${activityCacheSource})`, tActivity)
  diag.step("activity_cache", { source: activityCacheSource })

  const fullyDegraded =
    timeline.length === 0 &&
    metricsMeta.source === "degraded" &&
    activity.items.length === 0

  const dashboardSource = resolveDashboardClusterSource({
    cacheSource: "cache_miss",
    timelineSource,
    metricsSource: metricsMeta.source,
    fullyDegraded,
  })

  return {
    timeline,
    metrics,
    activity,
    timelineSource,
    timelineCacheable: timelineResult.cacheable,
    dashboard_refresh_on_request: dashboardRefreshOnRequestDiag(),
    dashboard_refresh_skipped: dashboardRefreshSkipped(options.refreshOnRequest),
    dashboard_source: dashboardSource,
  }
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  let diag = createRouteDiag("dashboard_cluster")
  const refreshOnRequest = isDashboardClusterRefreshOnRequestEnabled()

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const sessionAuth = await resolveAuthenticatedApiUser(supabase, {
      cookieHeader: request.headers.get("cookie"),
    })

    if (!sessionAuth.ok) {
      diag.fail(sessionAuth.status, sessionAuth.error, {
        auth_failure_stage: sessionAuth.authFailureStage,
      })
      return NextResponse.json(
        { error: sessionAuth.error, auth_failure_stage: sessionAuth.authFailureStage },
        { status: sessionAuth.status }
      )
    }
    const user = sessionAuth.user

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      return NextResponse.json({ error: "Missing business_id" }, { status: 400 })
    }

    diag = createRouteDiag("dashboard_cluster", businessId)
    diag.step("refresh_policy", {
      dashboard_refresh_on_request: dashboardRefreshOnRequestDiag(),
      dashboard_refresh_skipped: dashboardRefreshSkipped(refreshOnRequest),
    })

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      diag.fail(403, "forbidden")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    diag.step("auth", { ms_auth: Math.round((performance.now() - tAuth) * 10) / 10 })

    const periodsRaw = parseInt(searchParams.get("periods") ?? String(DEFAULT_PERIODS), 10)
    const periodsParam = Math.min(
      MAX_PERIODS,
      Math.max(1, Number.isFinite(periodsRaw) ? periodsRaw : DEFAULT_PERIODS)
    )
    const activityLimit = Math.min(
      MAX_ACTIVITY_LIMIT,
      Math.max(1, parseInt(searchParams.get("activity_limit") ?? String(DEFAULT_ACTIVITY_LIMIT), 10) ||
        DEFAULT_ACTIVITY_LIMIT)
    )
    const periodStart = searchParams.get("period_start")?.trim() || undefined
    const previousPeriodStart = searchParams.get("previous_period_start")?.trim() || undefined

    const cacheKey = [
      "cluster",
      businessId,
      periodsParam,
      activityLimit,
      periodStart ?? "",
      previousPeriodStart ?? "",
      refreshOnRequest ? "refresh" : "norefresh",
    ].join("|")

    try {
      const preparingPayload = () => preparingClusterPayload(refreshOnRequest)

      const {
        value,
        cacheSource,
        cache_age_ms,
        refresh_mode,
        cache_enabled,
        source: legacyCacheSource,
      } = await loadOrComputeDashboardClusterCache(
        cacheKey,
        () =>
          loadDashboardCluster(
            supabase,
            businessId,
            { periodsParam, activityLimit, periodStart, previousPeriodStart, refreshOnRequest },
            diag
          ),
        {
          shouldStore: clusterPayloadShouldStore,
          createPreparing: preparingPayload,
          createDegraded: preparingPayload,
          scheduleBackground: (promise) => waitUntil(promise),
        }
      )

      const servedFromCache =
        cacheSource === "fresh_hit" ||
        cacheSource === "stale_hit" ||
        cacheSource === "refresh_started" ||
        cacheSource === "refresh_skipped"

      const payload = attachDashboardClusterMetadata(value, cacheSource, servedFromCache)

      diag.step("cache", {
        cache_source: legacyCacheSource,
        dashboard_cache_source: cacheSource,
        dashboard_cache_age_ms: Math.round(cache_age_ms),
        dashboard_refresh_mode: refresh_mode,
        dashboard_status: payload.dashboard_status,
        cache_enabled,
        dashboard_source: payload.dashboard_source,
      })
      diag.finish(200)
      devClusterLog("total route", routeT0)
      return NextResponse.json(payload, {
        headers: dashboardClusterCacheResponseHeaders({
          cacheSource,
          cacheAgeMs: cache_age_ms,
          refreshMode: refresh_mode,
          dashboardStatus: payload.dashboard_status,
        }),
      })
    } catch (err) {
      if (!refreshOnRequest) {
        console.warn(
          "[service-cluster] cluster load degraded:",
          err instanceof Error ? err.message : "cluster_load_failed"
        )
        const degraded = preparingClusterPayload(refreshOnRequest)
        diag.step("cluster_degraded", {
          error: err instanceof Error ? err.message : "cluster_load_failed",
          dashboard_status: "preparing",
        })
        diag.finish(200)
        devClusterLog("total route (preparing)", routeT0)
        return NextResponse.json(degraded, {
          headers: dashboardClusterCacheResponseHeaders({
            cacheSource: "preparing",
            cacheAgeMs: 0,
            refreshMode: "skipped",
            dashboardStatus: "preparing",
          }),
        })
      }

      const rpcMeta = (err as { rpcMeta?: RouteDiagFields }).rpcMeta
      diag.fail(500, err instanceof Error ? err.message : "cluster_load_failed", rpcMeta)
      devClusterLog("total route", routeT0)
      return NextResponse.json({ error: "Could not load dashboard cluster" }, { status: 500 })
    }
  } catch (err) {
    if (!refreshOnRequest) {
      const degraded = preparingClusterPayload(refreshOnRequest)
      diag.finish(200)
      return NextResponse.json(degraded, {
        headers: dashboardClusterCacheResponseHeaders({
          cacheSource: "preparing",
          cacheAgeMs: 0,
          refreshMode: "skipped",
          dashboardStatus: "preparing",
        }),
      })
    }
    diag.fail(500, err instanceof Error ? err.message : "Server error")
    console.error("Dashboard service-cluster error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
