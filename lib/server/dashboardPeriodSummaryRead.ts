/**
 * DB-backed dashboard period summary reads (512).
 * Shared freshness window with timeline summary (508/509).
 *
 * Fresh valid current-period summary is the default financial KPI source.
 * `FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH` is retained for compatibility only —
 * normal behaviour no longer depends on it.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { SUMMARY_FRESH_SECONDS } from "@/lib/server/serviceDashboardTimeline"

export { SUMMARY_FRESH_SECONDS as PNL_SNAPSHOT_FRESH_SECONDS }

/** @deprecated Prefer DashboardFinancialSource */
export type DashboardPnlSource = "live_metrics_rpc" | "summary_fast_path"

/** Truthful financial KPI provenance for diagnostics (never log line amounts). */
export type DashboardFinancialSource = "fresh_snapshot" | "live_fallback" | "cache_hit"

/** @deprecated Compatibility shim — summary path is always attempted. */
export function isDashboardPnlSummaryFastPathEnabled(): boolean {
  const raw = String(process.env.FINZA_DASHBOARD_PNL_SUMMARY_FAST_PATH ?? "").trim()
  return raw === "1" || raw.toLowerCase() === "true"
}

export function dashboardPnlSourceForDiag(
  usedSummaryFastPath: boolean
): DashboardPnlSource {
  return usedSummaryFastPath ? "summary_fast_path" : "live_metrics_rpc"
}

export function dashboardFinancialSourceForDiag(input: {
  cacheHit: boolean
  usedSummaryFastPath: boolean
  usedLiveFallback: boolean
}): DashboardFinancialSource {
  if (input.cacheHit) return "cache_hit"
  if (input.usedSummaryFastPath) return "fresh_snapshot"
  return "live_fallback"
}

export type FreshPeriodPnlRow = {
  revenue: number | string
  expenses: number | string
  net_profit: number | string
  refreshed_at: string
}

/** Read period P&L from summary without freshness filter (cluster degraded path). */
const STALE_SUMMARY_ANY_SECONDS = 10 * 365 * 24 * 60 * 60

export async function fetchStaleDashboardPeriodPnl(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<FreshPeriodPnlRow | null> {
  return fetchFreshDashboardPeriodPnl(
    supabase,
    businessId,
    startDate,
    endDate,
    STALE_SUMMARY_ANY_SECONDS
  )
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
