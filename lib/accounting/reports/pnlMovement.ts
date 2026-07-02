/**
 * Ledger-derived P&L movement for a date range (je.date inclusive).
 * Snapshot-first for reports_pnl (512/513); refresh is reports-only, not dashboard.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"
import {
  readPnlMovementLinesFromSnapshot,
  readStalePnlMovementLinesFromSnapshot,
  tryRefreshPnlMovementSnapshot,
} from "@/lib/server/pnlMovementSnapshotRefresh"

export type PnLMovementRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  period_total?: number
}

export type PnLMovementSource = "snapshot" | "ledger" | "unavailable"

export type PnLMovementFetchOptions = {
  /** When false, snapshot reads only — no refresh or live get_profit_and_loss_movement RPC. */
  refreshOnRequest?: boolean
}

export type PnLMovementFetchResult = {
  rows: PnLMovementRow[]
  error: string
  source: PnLMovementSource
  snapshotStale: boolean
}

async function loadSnapshotRows(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  maxStaleSeconds: number
): Promise<{ rows: PnLMovementRow[]; error: string | null }> {
  const { data, error } = await readPnlMovementLinesFromSnapshot(
    supabase,
    businessId,
    startDate,
    endDate,
    maxStaleSeconds
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
  endDate: string,
  options?: PnLMovementFetchOptions
): Promise<PnLMovementFetchResult> {
  const refreshOnRequest = options?.refreshOnRequest !== false

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { rows: [], error: "Invalid date range", source: "ledger", snapshotStale: false }
  }
  if (startDate > endDate) {
    return {
      rows: [],
      error: "start_date must be on or before end_date",
      source: "ledger",
      snapshotStale: false,
    }
  }

  const initialSnapshot = await loadSnapshotRows(
    supabase,
    businessId,
    startDate,
    endDate,
    PNL_SNAPSHOT_FRESH_SECONDS
  )
  if (initialSnapshot.error) {
    console.warn("[pnl-movement] snapshot read failed:", initialSnapshot.error)
  } else if (initialSnapshot.rows.length > 0) {
    return {
      rows: initialSnapshot.rows,
      error: "",
      source: "snapshot",
      snapshotStale: false,
    }
  }

  if (!refreshOnRequest) {
    const staleSnapshot = await readStalePnlMovementLinesFromSnapshot(
      supabase,
      businessId,
      startDate,
      endDate
    )
    if (staleSnapshot.error) {
      console.warn("[pnl-movement] stale snapshot read failed:", staleSnapshot.error.message)
    } else if (Array.isArray(staleSnapshot.data) && staleSnapshot.data.length > 0) {
      return {
        rows: staleSnapshot.data as PnLMovementRow[],
        error: "",
        source: "snapshot",
        snapshotStale: true,
      }
    }
    return { rows: [], error: "", source: "unavailable", snapshotStale: false }
  }

  const refresh = await tryRefreshPnlMovementSnapshot(supabase, businessId, startDate, endDate)
  if (refresh.refreshed) {
    const afterRefresh = await loadSnapshotRows(
      supabase,
      businessId,
      startDate,
      endDate,
      PNL_SNAPSHOT_FRESH_SECONDS
    )
    if (!afterRefresh.error && afterRefresh.rows.length > 0) {
      return {
        rows: afterRefresh.rows,
        error: "",
        source: "snapshot",
        snapshotStale: false,
      }
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
    return {
      rows: [],
      error: error.message ?? "Failed to fetch P&L movement",
      source: "ledger",
      snapshotStale: false,
    }
  }

  return {
    rows: (data ?? []) as PnLMovementRow[],
    error: "",
    source: "ledger",
    snapshotStale: false,
  }
}
