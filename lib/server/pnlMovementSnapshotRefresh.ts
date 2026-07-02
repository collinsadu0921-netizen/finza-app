/**
 * Reports-only P&L movement snapshot refresh (513).
 * Not used by dashboard_cluster timeline refresh.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/** Read snapshot lines without freshness filter (reports degraded path). */
export const PNL_SNAPSHOT_STALE_ANY_SECONDS = 10 * 365 * 24 * 60 * 60

export async function tryRefreshPnlMovementSnapshot(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<{ refreshed: boolean; lockHeld: boolean }> {
  const { data, error } = await supabase.rpc("try_refresh_service_pnl_movement_snapshot", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })

  if (error) {
    console.warn("[pnl-movement] try_refresh snapshot failed:", error.message)
    return { refreshed: false, lockHeld: false }
  }

  const row = (data ?? {}) as {
    refreshed?: boolean
    lock_held?: boolean
  }

  return {
    refreshed: Boolean(row.refreshed),
    lockHeld: Boolean(row.lock_held),
  }
}

export async function readPnlMovementLinesFromSnapshot(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  maxStaleSeconds: number
) {
  return supabase.rpc("get_pnl_movement_lines_from_snapshot", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_max_stale_seconds: maxStaleSeconds,
  })
}

export async function readStalePnlMovementLinesFromSnapshot(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
) {
  return readPnlMovementLinesFromSnapshot(
    supabase,
    businessId,
    startDate,
    endDate,
    PNL_SNAPSHOT_STALE_ANY_SECONDS
  )
}
