/**
 * GET /api/dashboard/service-timeline?business_id=...&periods=6
 *
 * Summary-first timeline with circuit breaker (508/509). Controlled live fallback on first load only.
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { loadOrComputeDashboardClusterCache } from "@/lib/server/dashboardClusterCache"
import {
  isTimelineResultCacheable,
  loadServiceDashboardTimeline,
} from "@/lib/server/serviceDashboardTimeline"
import { createRouteDiag, isRouteDiagnosticsEnabled } from "@/lib/server/routeDiagnostics"

const DEFAULT_PERIODS = 6
const MAX_PERIODS = 24

function devServiceTimelineLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production" && !isRouteDiagnosticsEnabled()) return
  console.info(`[service-timeline] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

export async function GET(request: NextRequest) {
  const routeT0 = performance.now()
  let diag = createRouteDiag("dashboard_timeline")
  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    diag = createRouteDiag("dashboard_timeline", businessId)

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      diag.fail(403, "forbidden")
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json(
        { error: "You do not have access to this business" },
        { status: 403 }
      )
    }
    diag.step("auth", { ms_auth: Math.round((performance.now() - tAuth) * 10) / 10 })

    const periodsRaw = parseInt(searchParams.get("periods") ?? String(DEFAULT_PERIODS), 10)
    const periodsParam = Math.min(
      MAX_PERIODS,
      Math.max(1, Number.isFinite(periodsRaw) ? periodsRaw : DEFAULT_PERIODS)
    )

    const cacheKey = `timeline|${businessId}|${periodsParam}`

    const { value, source: cacheSource, cache_enabled } =
      await loadOrComputeDashboardClusterCache(
        cacheKey,
        () => loadServiceDashboardTimeline(supabase, businessId, periodsParam, diag),
        { shouldStore: isTimelineResultCacheable }
      )

    diag.step("cache", {
      cache_source: cacheSource,
      cache_enabled,
      timeline_source: value.source,
      timeline_cacheable: value.cacheable,
    })
    diag.finish(200)
    devServiceTimelineLog("total route", routeT0)
    return NextResponse.json({ timeline: value.timeline })
  } catch (err) {
    devServiceTimelineLog("total route", routeT0)
    diag.fail(500, err instanceof Error ? err.message : "Server error")
    console.error("Dashboard service-timeline error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}
