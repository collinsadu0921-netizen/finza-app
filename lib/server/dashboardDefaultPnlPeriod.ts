/**
 * Dashboard-only default P&L period (service-cluster).
 * Latest non-zero summary P&L whose period_start is on or before business today.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getBusinessToday } from "@/lib/accounting/businessDate"
import { isPeriodOnOrBefore, normalizePeriodStart } from "@/lib/accounting/periodDate"

function hasMeaningfulPnl(revenue: unknown, expenses: unknown, netProfit: unknown): boolean {
  return Number(revenue) !== 0 || Number(expenses) !== 0 || Number(netProfit) !== 0
}

/** Latest non-future period_start with meaningful P&L in service_dashboard_period_summary, or null. */
export async function resolveDashboardDefaultPeriodStart(
  supabase: SupabaseClient,
  businessId: string,
  options?: { businessToday?: string }
): Promise<string | null> {
  const businessToday =
    options?.businessToday?.trim() || (await getBusinessToday(supabase, businessId))

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
    if (!isPeriodOnOrBefore(row.period_start, businessToday)) continue
    if (hasMeaningfulPnl(row.revenue, row.expenses, row.net_profit)) {
      return normalizePeriodStart(row.period_start) || String(row.period_start)
    }
  }

  return null
}
