/**
 * Dashboard-only default P&L period (service-cluster).
 * Prefers latest accounting period with non-zero summary P&L — not merely any journal date in range.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

function hasMeaningfulPnl(revenue: unknown, expenses: unknown, netProfit: unknown): boolean {
  return Number(revenue) !== 0 || Number(expenses) !== 0 || Number(netProfit) !== 0
}

/** Latest period_start with meaningful P&L in service_dashboard_period_summary, or null. */
export async function resolveDashboardDefaultPeriodStart(
  supabase: SupabaseClient,
  businessId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("service_dashboard_period_summary")
    .select("period_start, revenue, expenses, net_profit")
    .eq("business_id", businessId)
    .order("period_start", { ascending: false })

  if (error) {
    console.warn("[dashboard-default-pnl-period] summary read failed:", error.message)
    return null
  }

  for (const row of data ?? []) {
    if (hasMeaningfulPnl(row.revenue, row.expenses, row.net_profit)) {
      return String(row.period_start)
    }
  }

  return null
}
