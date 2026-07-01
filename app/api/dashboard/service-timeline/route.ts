/**
 * GET /api/dashboard/service-timeline?business_id=...&periods=6
 *
 * Read-only. Returns ledger-derived revenue/expense/profit per accounting period for chart.
 *
 * 507: reads fresh rows from service_dashboard_period_summary when available;
 * falls back to get_service_dashboard_timeline (live ledger scan) and refreshes summary.
 * Cluster cache + singleflight reduce concurrent stampede on serverless instances.
 *
 * Response shape (unchanged for ServiceDashboardCockpit / FinancialFlowChart):
 *   { timeline: [{ period_id, period_start, period_end, revenue, expenses, netProfit }] }
 */

import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { loadOrComputeDashboardClusterCache } from "@/lib/server/dashboardClusterCache"
import { createRouteDiag, isRouteDiagnosticsEnabled, supabaseErrorDiag } from "@/lib/server/routeDiagnostics"

const DEFAULT_PERIODS = 6
const MAX_PERIODS = 24
const SUMMARY_MAX_STALE_SECONDS = 300

function devServiceTimelineLog(label: string, startedAt: number) {
  if (process.env.NODE_ENV === "production" && !isRouteDiagnosticsEnabled()) return
  console.info(`[service-timeline] ${label}: ${(performance.now() - startedAt).toFixed(1)}ms`)
}

type TimelineRpcRow = {
  period_id: string | null
  period_start: string
  period_end: string
  revenue: number | string
  expenses: number | string
  net_profit: number | string
}

function mapTimelineRows(rows: TimelineRpcRow[]) {
  return rows.map((row) => ({
    period_id: row.period_id ?? undefined,
    period_start: row.period_start,
    period_end: row.period_end,
    revenue: Number(row.revenue) || 0,
    expenses: Number(row.expenses) || 0,
    netProfit: Number(row.net_profit) || 0,
  }))
}

async function loadTimelineFromSummary(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  periodsParam: number
): Promise<TimelineRpcRow[] | null> {
  const { data, error } = await supabase.rpc("get_service_dashboard_timeline_from_summary", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
    p_max_stale_seconds: SUMMARY_MAX_STALE_SECONDS,
  })
  if (error) {
    console.warn("[service-timeline] summary read failed:", error.message)
    return null
  }
  const rows = (data ?? []) as TimelineRpcRow[]
  if (rows.length < periodsParam) return null
  return rows
}

async function loadTimelineLive(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  periodsParam: number
): Promise<{ rows: TimelineRpcRow[]; error: { message: string; code?: string } | null }> {
  const { data, error } = await supabase.rpc("get_service_dashboard_timeline", {
    p_business_id: businessId,
    p_start_date: null,
    p_end_date: null,
    p_granularity: "accounting_period",
    p_periods_limit: periodsParam,
  })
  return { rows: (data ?? []) as TimelineRpcRow[], error }
}

async function refreshTimelineSummary(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  periodsParam: number
): Promise<void> {
  const { error } = await supabase.rpc("refresh_service_dashboard_period_summaries", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
  })
  if (error) {
    console.warn("[service-timeline] summary refresh failed:", error.message)
  }
}

async function loadTimeline(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  businessId: string,
  periodsParam: number,
  diag: ReturnType<typeof createRouteDiag>
): Promise<{ timeline: ReturnType<typeof mapTimelineRows>; source: "summary" | "live" }> {
  const tSummary = performance.now()
  const summaryRows = await loadTimelineFromSummary(supabase, businessId, periodsParam)
  devServiceTimelineLog("get_service_dashboard_timeline_from_summary RPC", tSummary)

  if (summaryRows) {
    diag.step("rpc", {
      rpc: "get_service_dashboard_timeline_from_summary",
      periods: periodsParam,
      row_count: summaryRows.length,
      ms_rpc: Math.round((performance.now() - tSummary) * 10) / 10,
      timeline_source: "summary",
    })
    return { timeline: mapTimelineRows(summaryRows), source: "summary" }
  }

  const tRpc = performance.now()
  const { rows, error: rpcError } = await loadTimelineLive(supabase, businessId, periodsParam)
  devServiceTimelineLog("get_service_dashboard_timeline RPC", tRpc)

  if (rpcError) {
    console.error("get_service_dashboard_timeline RPC error:", rpcError)
    diag.fail(500, "rpc_error", {
      rpc: "get_service_dashboard_timeline",
      ...supabaseErrorDiag(rpcError),
      periods: periodsParam,
      ms_rpc: Math.round((performance.now() - tRpc) * 10) / 10,
    })
    throw rpcError
  }

  const tRefresh = performance.now()
  await refreshTimelineSummary(supabase, businessId, periodsParam)
  devServiceTimelineLog("refresh_service_dashboard_period_summaries RPC", tRefresh)

  diag.step("rpc", {
    rpc: "get_service_dashboard_timeline",
    periods: periodsParam,
    row_count: rows.length,
    ms_rpc: Math.round((performance.now() - tRpc) * 10) / 10,
    ms_refresh: Math.round((performance.now() - tRefresh) * 10) / 10,
    timeline_source: "live",
  })

  return { timeline: mapTimelineRows(rows), source: "live" }
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
      devServiceTimelineLog("auth/access", tAuth)
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    if (!businessId) {
      devServiceTimelineLog("auth/access", tAuth)
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
      devServiceTimelineLog("auth/access", tAuth)
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json(
        { error: "You do not have access to this business" },
        { status: 403 }
      )
    }
    diag.step("auth", { ms_auth: Math.round((performance.now() - tAuth) * 10) / 10 })
    devServiceTimelineLog("auth/access", tAuth)

    const periodsRaw = parseInt(searchParams.get("periods") ?? String(DEFAULT_PERIODS), 10)
    const periodsParam = Math.min(
      MAX_PERIODS,
      Math.max(1, Number.isFinite(periodsRaw) ? periodsRaw : DEFAULT_PERIODS)
    )

    const cacheKey = `timeline|${businessId}|${periodsParam}`

    try {
      const { value, source: cacheSource, cache_enabled } =
        await loadOrComputeDashboardClusterCache(cacheKey, () =>
          loadTimeline(supabase, businessId, periodsParam, diag)
        )

      diag.step("cache", {
        cache_source: cacheSource,
        cache_enabled,
        timeline_source: value.source,
      })
      diag.finish(200)
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json({ timeline: value.timeline })
    } catch (rpcErr) {
      devServiceTimelineLog("total route", routeT0)
      return NextResponse.json(
        { error: "Could not load dashboard timeline" },
        { status: 500 }
      )
    }
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
