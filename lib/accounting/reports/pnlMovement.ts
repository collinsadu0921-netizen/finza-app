/**
 * Ledger-derived P&L movement for a date range (je.date inclusive).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type PnLMovementRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  period_total?: number
}

export async function fetchProfitAndLossMovementRows(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<{ rows: PnLMovementRow[]; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { rows: [], error: "Invalid date range" }
  }
  if (startDate > endDate) {
    return { rows: [], error: "start_date must be on or before end_date" }
  }

  const { data, error } = await supabase.rpc("get_profit_and_loss_movement", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })

  if (error) {
    return { rows: [], error: error.message ?? "Failed to fetch P&L movement" }
  }

  return { rows: (data ?? []) as PnLMovementRow[], error: "" }
}
