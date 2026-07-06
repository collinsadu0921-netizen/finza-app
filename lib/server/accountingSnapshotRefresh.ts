/**
 * Accounting snapshot refresh queue helpers (522).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"

export type PnlSnapshotMetadata = {
  line_count: number
  revenue: number | string
  expenses: number | string
  net_profit: number | string
  refreshed_at: string
  source_version: number
  snapshotStale: boolean
}

export type SnapshotRefreshJobType = "dashboard" | "pnl" | "both"

export async function readPnlSnapshotMetadata(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  maxStaleSeconds: number = PNL_SNAPSHOT_FRESH_SECONDS
): Promise<PnlSnapshotMetadata | null> {
  const { data, error } = await supabase.rpc("get_service_pnl_movement_snapshot_metadata", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
    p_max_stale_seconds: maxStaleSeconds,
  })
  if (error) {
    console.warn("[accounting-snapshot] metadata read failed:", error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") return null
  return { ...(row as Omit<PnlSnapshotMetadata, "snapshotStale">), snapshotStale: false }
}

export async function readStalePnlSnapshotMetadata(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<PnlSnapshotMetadata | null> {
  const { data, error } = await supabase.rpc("get_stale_service_pnl_movement_snapshot_metadata", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) {
    console.warn("[accounting-snapshot] stale metadata read failed:", error.message)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") return null
  return { ...(row as Omit<PnlSnapshotMetadata, "snapshotStale">), snapshotStale: true }
}

export async function periodHasLivePnlMovement(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("period_has_live_pnl_movement", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) {
    console.warn("[accounting-snapshot] live movement probe failed:", error.message)
    return false
  }
  return Boolean(data)
}

export async function enqueueSnapshotRefreshJob(
  supabase: SupabaseClient,
  input: {
    businessId: string
    periodStart: string
    periodEnd: string
    jobType?: SnapshotRefreshJobType
    reason?: string
    sourceType?: string | null
    sourceId?: string | null
  }
): Promise<string | null> {
  const { data, error } = await supabase.rpc("enqueue_accounting_snapshot_refresh_job", {
    p_business_id: input.businessId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_job_type: input.jobType ?? "both",
    p_reason: input.reason ?? "read_path_missing_snapshot",
    p_source_type: input.sourceType ?? null,
    p_source_id: input.sourceId ?? null,
  })
  if (error) {
    console.warn("[accounting-snapshot] enqueue failed:", error.message)
    return null
  }
  return typeof data === "string" ? data : null
}

export async function ensureZeroPnlSnapshotForPeriod(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("ensure_zero_pnl_snapshot_for_period", {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  })
  if (error) {
    console.warn("[accounting-snapshot] ensure zero snapshot failed:", error.message)
    return false
  }
  return Boolean(data)
}
