/**
 * DB-backed dashboard period summary reads (512).
 * Shared freshness window with timeline summary (508/509).
 *
 * Dashboard metrics fast path is OFF by default — enable with
 * FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH=1 after operational load validation.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { SUMMARY_FRESH_SECONDS } from "@/lib/server/serviceDashboardTimeline"

export { SUMMARY_FRESH_SECONDS as PNL_SNAPSHOT_FRESH_SECONDS }

export type DashboardPnlSource = "live_metrics_rpc" | "summary_fast_path"

export function isDashboardPnlSummaryFastPathEnabled(): boolean {
  const raw = String(process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH ?? "").trim()
  return raw === "1" || raw.toLowerCase() === "true"
}

export function dashboardPnlSourceForDiag(
  usedSummaryFastPath: boolean
): DashboardPnlSource {
  return usedSummaryFastPath ? "summary_fast_path" : "live_metrics_rpc"
}

export type FreshPeriodPnlRow = {
  revenue: number | string
  expenses: number | string
  net_profit: number | string
  refreshed_at: string
}

export async function fetchFreshDashboardPeriodPnl(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  maxStaleSeconds: number = SUMMARY_FRESH_SECONDS
): Promise<FreshPeriodPnlRow | null> {
  const { data, error } = await supabase.rpc("get_fresh_service_dashboard_period_pnl", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_max_stale_seconds: maxStaleSeconds,
  })

  if (error) {
    console.warn("[dashboard-period-pnl] fresh summary read failed:", error.message)
    return null
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") return null
  return row as FreshPeriodPnlRow
}
