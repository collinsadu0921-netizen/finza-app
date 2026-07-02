/**
 * Ledger-derived P&L movement for a date range (je.date inclusive).
 * Snapshot-first when 512 read model is populated (falls back to live RPC).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"

export type PnLMovementRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  period_total?: number
}

export type PnLMovementSource = "snapshot" | "ledger"

export async function fetchProfitAndLossMovementRows(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<{ rows: PnLMovementRow[]; error: string; source: PnLMovementSource }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { rows: [], error: "Invalid date range", source: "ledger" }
  }
  if (startDate > endDate) {
    return { rows: [], error: "start_date must be on or before end_date", source: "ledger" }
  }

  const { data: snapshotData, error: snapshotError } = await supabase.rpc(
    "get_pnl_movement_lines_from_snapshot",
    {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_max_stale_seconds: PNL_SNAPSHOT_FRESH_SECONDS,
    }
  )

  if (!snapshotError && Array.isArray(snapshotData) && snapshotData.length > 0) {
    return { rows: snapshotData as PnLMovementRow[], error: "", source: "snapshot" }
  }

  if (snapshotError) {
    console.warn("[pnl-movement] snapshot read failed:", snapshotError.message)
  }

  const { data, error } = await supabase.rpc("get_profit_and_loss_movement", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })

  if (error) {
    return { rows: [], error: error.message ?? "Failed to fetch P&L movement", source: "ledger" }
  }

  return { rows: (data ?? []) as PnLMovementRow[], error: "", source: "ledger" }
}
