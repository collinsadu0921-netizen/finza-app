/**
 * Dashboard timeline loader — summary-first with circuit breaker (508).
 * Never calls get_service_dashboard_timeline (live ledger scan) under load.
 */

import type { createSupabaseServerClient } from "@/lib/supabaseServer"
import type { createRouteDiag } from "@/lib/server/routeDiagnostics"

export const SUMMARY_FRESH_SECONDS = 300

export type TimelineRpcRow = {
  period_id: string | null
  period_start: string
  period_end: string
  revenue: number | string
  expenses: number | string
  net_profit: number | string
}

export type ServiceDashboardTimelineItem = {
  period_id?: string
  period_start: string
  period_end: string
  revenue: number
  expenses: number
  netProfit: number
}

export type TimelineLoadSource =
  | "summary_fresh"
  | "summary_stale"
  | "summary_stale_lock"
  | "summary_refreshed"
  | "empty_refresh_in_progress"
  | "empty"

export function mapTimelineRows(rows: TimelineRpcRow[]): ServiceDashboardTimelineItem[] {
  return rows.map((row) => ({
    period_id: row.period_id ?? undefined,
    period_start: row.period_start,
    period_end: row.period_end,
    revenue: Number(row.revenue) || 0,
    expenses: Number(row.expenses) || 0,
    netProfit: Number(row.net_profit) || 0,
  }))
}

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type RouteDiag = ReturnType<typeof createRouteDiag>

async function readFreshSummary(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<TimelineRpcRow[]> {
  const { data, error } = await supabase.rpc("get_service_dashboard_timeline_from_summary", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
    p_max_stale_seconds: SUMMARY_FRESH_SECONDS,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] fresh summary read failed:", error.message)
    return []
  }
  return (data ?? []) as TimelineRpcRow[]
}

async function readStaleSummary(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<TimelineRpcRow[]> {
  const { data, error } = await supabase.rpc("get_service_dashboard_timeline_stale_summary", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] stale summary read failed:", error.message)
    return []
  }
  return (data ?? []) as TimelineRpcRow[]
}

async function tryRefreshSummary(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<{ refreshed: boolean; lockHeld: boolean; periodCount: number }> {
  const { data, error } = await supabase.rpc("try_refresh_service_dashboard_period_summaries", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] try_refresh failed:", error.message)
    return { refreshed: false, lockHeld: false, periodCount: 0 }
  }
  const row = (data ?? {}) as {
    refreshed?: boolean
    lock_held?: boolean
    period_count?: number
  }
  return {
    refreshed: Boolean(row.refreshed),
    lockHeld: Boolean(row.lock_held),
    periodCount: Number(row.period_count) || 0,
  }
}

function hasEnoughSummaryRows(rows: TimelineRpcRow[], periodsParam: number): boolean {
  return rows.length >= periodsParam
}

/**
 * Summary-first timeline with circuit breaker — no live ledger scan fallback.
 */
export async function loadServiceDashboardTimeline(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number,
  diag: RouteDiag
): Promise<{ timeline: ServiceDashboardTimelineItem[]; source: TimelineLoadSource }> {
  const t0 = performance.now()

  const freshRows = await readFreshSummary(supabase, businessId, periodsParam)
  if (hasEnoughSummaryRows(freshRows, periodsParam)) {
    diag.step("timeline", {
      timeline_source: "summary_fresh",
      row_count: freshRows.length,
      periods: periodsParam,
      ms: Math.round((performance.now() - t0) * 10) / 10,
    })
    return { timeline: mapTimelineRows(freshRows), source: "summary_fresh" }
  }

  const staleRows = await readStaleSummary(supabase, businessId, periodsParam)
  if (hasEnoughSummaryRows(staleRows, periodsParam)) {
    void tryRefreshSummary(supabase, businessId, periodsParam)
    diag.step("timeline", {
      timeline_source: "summary_stale",
      row_count: staleRows.length,
      periods: periodsParam,
      ms: Math.round((performance.now() - t0) * 10) / 10,
    })
    return { timeline: mapTimelineRows(staleRows), source: "summary_stale" }
  }

  const refresh = await tryRefreshSummary(supabase, businessId, periodsParam)

  if (refresh.lockHeld) {
    const lockedStale = await readStaleSummary(supabase, businessId, periodsParam)
    if (lockedStale.length > 0) {
      diag.step("timeline", {
        timeline_source: "summary_stale_lock",
        row_count: lockedStale.length,
        periods: periodsParam,
        ms: Math.round((performance.now() - t0) * 10) / 10,
      })
      return { timeline: mapTimelineRows(lockedStale), source: "summary_stale_lock" }
    }
    diag.step("timeline", {
      timeline_source: "empty_refresh_in_progress",
      row_count: 0,
      periods: periodsParam,
      ms: Math.round((performance.now() - t0) * 10) / 10,
    })
    return { timeline: [], source: "empty_refresh_in_progress" }
  }

  const afterRefresh = await readFreshSummary(supabase, businessId, periodsParam)
  const rows = afterRefresh.length > 0 ? afterRefresh : await readStaleSummary(supabase, businessId, periodsParam)

  diag.step("timeline", {
    timeline_source: rows.length > 0 ? "summary_refreshed" : "empty",
    row_count: rows.length,
    periods: periodsParam,
    refresh_period_count: refresh.periodCount,
    ms: Math.round((performance.now() - t0) * 10) / 10,
  })

  if (rows.length > 0) {
    return { timeline: mapTimelineRows(rows), source: "summary_refreshed" }
  }
  return { timeline: [], source: "empty" }
}
