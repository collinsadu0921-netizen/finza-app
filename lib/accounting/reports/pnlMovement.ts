/**
 * Ledger-derived P&L movement for a date range (je.date inclusive).
 * Snapshot-first for reports_pnl (512/513); refresh is reports-only, not dashboard.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"
import {
  readPnlMovementLinesFromSnapshot,
  tryRefreshPnlMovementSnapshot,
} from "@/lib/server/pnlMovementSnapshotRefresh"

export type PnLMovementRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  period_total?: number
}

export type PnLMovementSource = "snapshot" | "ledger"

async function loadSnapshotRows(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<{ rows: PnLMovementRow[]; error: string | null }> {
  const { data, error } = await readPnlMovementLinesFromSnapshot(
    supabase,
    businessId,
    startDate,
    endDate,
    PNL_SNAPSHOT_FRESH_SECONDS
  )

  if (error) {
    return { rows: [], error: error.message ?? "snapshot_read_failed" }
  }

  if (!Array.isArray(data) || data.length === 0) {
    return { rows: [], error: null }
  }

  return { rows: data as PnLMovementRow[], error: null }
}

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

  const initialSnapshot = await loadSnapshotRows(supabase, businessId, startDate, endDate)
  if (initialSnapshot.error) {
    console.warn("[pnl-movement] snapshot read failed:", initialSnapshot.error)
  } else if (initialSnapshot.rows.length > 0) {
    return { rows: initialSnapshot.rows, error: "", source: "snapshot" }
  }

  const refresh = await tryRefreshPnlMovementSnapshot(supabase, businessId, startDate, endDate)
  if (refresh.refreshed) {
    const afterRefresh = await loadSnapshotRows(supabase, businessId, startDate, endDate)
    if (!afterRefresh.error && afterRefresh.rows.length > 0) {
      return { rows: afterRefresh.rows, error: "", source: "snapshot" }
    }
  } else if (refresh.lockHeld) {
    console.info("[pnl-movement] snapshot refresh lock held; using live RPC")
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
