/**
 * GET /api/dashboard/service-cluster?business_id=...&periods=12&activity_limit=10
 *
 * Sequenced dashboard load: timeline → metrics → activity (one HTTP round-trip).
 * Replaces concurrent client-side fan-out to service-metrics/timeline/activity.
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { loadOrComputeDashboardClusterCache, loadOrComputeDashboardActivityCache } from "@/lib/server/dashboardClusterCache"
import { loadServiceDashboardActivityFeed } from "@/lib/server/serviceDashboardActivityLoader"
import { loadServiceDashboardMetrics } from "@/lib/server/serviceDashboardMetricsLoader"
import { loadServiceDashboardTimeline, shouldCacheDashboardClusterPayload } from "@/lib/server/serviceDashboardTimeline"
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
  timeline: Awaited<ReturnType<typeof loadServiceDashboardTimeline>>["timeline"]
  metrics: Awaited<ReturnType<typeof loadServiceDashboardMetrics>>
  activity: { items: Awaited<ReturnType<typeof loadServiceDashboardActivityFeed>>["items"] }
  timelineSource?: string
  timelineCacheable?: boolean
}

async function loadDashboardCluster(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  options: {
    periodsParam: number
    activityLimit: number
    periodStart?: string
    previousPeriodStart?: string
  },
  diag: ReturnType<typeof createRouteDiag>
): Promise<ServiceDashboardClusterPayload> {
  const tTimeline = performance.now()
  const timelineResult = await loadServiceDashboardTimeline(
    supabase,
    businessId,
    options.periodsParam,
    diag
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
  const metrics = await loadServiceDashboardMetrics(
    supabase,
    businessId,
    {
      periodStart: options.periodStart,
      previousPeriodStart,
    },
    diag
  )
  devClusterLog("metrics", tMetrics)

  const activityCacheKey = `activity|${businessId}|${options.activityLimit}`
  const tActivity = performance.now()
  const { value: activity, source: activityCacheSource } = await loadOrComputeDashboardActivityCache(
    activityCacheKey,
    () => loadServiceDashboardActivityFeed(supabase, businessId, options.activityLimit, diag)
  )
  devClusterLog(`activity (${activityCacheSource})`, tActivity)
  diag.step("activity_cache", { source: activityCacheSource })

  return {
    timeline,
    metrics,
    activity,
    timelineSource,
    timelineCacheable: timelineResult.cacheable,
  }
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  let diag = createRouteDiag("dashboard_cluster")

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      return NextResponse.json({ error: "Missing business_id" }, { status: 400 })
    }

    diag = createRouteDiag("dashboard_cluster", businessId)

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
    ].join("|")

    try {
      const { value, source: cacheSource, cache_enabled } =
        await loadOrComputeDashboardClusterCache(
          cacheKey,
          () =>
            loadDashboardCluster(
              supabase,
              businessId,
              { periodsParam, activityLimit, periodStart, previousPeriodStart },
              diag
            ),
          { shouldStore: shouldCacheDashboardClusterPayload }
        )

      diag.step("cache", { cache_source: cacheSource, cache_enabled })
      diag.finish(200)
      devClusterLog("total route", routeT0)
      return NextResponse.json(value)
    } catch (err) {
      const rpcMeta = (err as { rpcMeta?: RouteDiagFields }).rpcMeta
      diag.fail(500, err instanceof Error ? err.message : "cluster_load_failed", rpcMeta)
      devClusterLog("total route", routeT0)
      return NextResponse.json({ error: "Could not load dashboard cluster" }, { status: 500 })
    }
  } catch (err) {
    diag.fail(500, err instanceof Error ? err.message : "Server error")
    console.error("Dashboard service-cluster error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
