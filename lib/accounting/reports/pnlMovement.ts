/**
 * Ledger-derived P&L movement for a date range (je.date inclusive).
 * Fresh snapshot → fast path; missing/invalidated/stale → bounded live + durable refresh.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  enqueueSnapshotRefreshJob,
  ensureZeroPnlSnapshotForPeriod,
  periodHasLivePnlMovement,
  readPnlSnapshotMetadata,
  readStalePnlSnapshotMetadata,
  scheduleTargetedSnapshotRefresh,
} from "@/lib/server/accountingSnapshotRefresh"
import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"
import {
  readPnlMovementLinesFromSnapshot,
  tryRefreshPnlMovementSnapshot,
} from "@/lib/server/pnlMovementSnapshotRefresh"

/** Beyond this age, a non-invalidated snapshot is treated as materially stale. */
export const PNL_MATERIAL_STALE_SECONDS = 900

export type PnLMovementRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  period_total?: number
}

export type PnLMovementSource =
  | "snapshot"
  | "ledger"
  | "unavailable"
  | "zero_initialized"

export type PnLMovementFetchOptions = {
  /** When false, skip blocking try_refresh; still use bounded live fallback when needed. */
  refreshOnRequest?: boolean
  scheduleBackground?: (promise: Promise<unknown>) => void
}

export type PnLMovementFetchResult = {
  rows: PnLMovementRow[]
  error: string
  source: PnLMovementSource
  snapshotStale: boolean
  refreshJobId?: string | null
  /** True only when live ledger RPC was skipped for a verified empty period. */
  liveFallbackSkipped?: boolean
}

const livePnlSingleflight = new Map<string, Promise<PnLMovementFetchResult>>()

function snapshotAgeSeconds(refreshedAt: string | undefined): number | null {
  if (!refreshedAt) return null
  const ms = Date.now() - new Date(refreshedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms / 1000
}

function isMateriallyStale(refreshedAt: string | undefined): boolean {
  const ageSec = snapshotAgeSeconds(refreshedAt)
  return ageSec != null && ageSec > PNL_MATERIAL_STALE_SECONDS
}

async function loadFreshSnapshotLines(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<PnLMovementRow[]> {
  const { data, error } = await readPnlMovementLinesFromSnapshot(
    supabase,
    businessId,
    startDate,
    endDate,
    PNL_SNAPSHOT_FRESH_SECONDS
  )
  if (error || !Array.isArray(data)) return []
  return data as PnLMovementRow[]
}

async function fetchLivePnLMovement(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<PnLMovementFetchResult> {
  const key = `${businessId}|${startDate}|${endDate}`
  const existing = livePnlSingleflight.get(key)
  if (existing) return existing

  const work = (async (): Promise<PnLMovementFetchResult> => {
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
  })()

  livePnlSingleflight.set(key, work)
  try {
    return await work
  } finally {
    livePnlSingleflight.delete(key)
  }
}

async function ensureRefreshAndSchedule(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  reason: string,
  scheduleBackground?: (promise: Promise<unknown>) => void
): Promise<string | null> {
  const refreshJobId = await enqueueSnapshotRefreshJob(supabase, {
    businessId,
    periodStart: startDate,
    periodEnd: endDate,
    jobType: "both",
    reason,
  })
  scheduleTargetedSnapshotRefresh({
    businessId,
    periodStart: startDate,
    periodEnd: endDate,
    triggerSource: "stale_report_read",
    scheduleBackground,
  })
  return refreshJobId
}

async function isExactAccountingPeriodRange(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<boolean> {
  const { data } = await supabase
    .from("accounting_periods")
    .select("id")
    .eq("business_id", businessId)
    .eq("period_start", startDate)
    .eq("period_end", endDate)
    .limit(1)
    .maybeSingle()
  return !!data
}

async function liveFallbackWithRefresh(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  reason: string,
  scheduleBackground?: (promise: Promise<unknown>) => void
): Promise<PnLMovementFetchResult> {
  const refreshJobId = await ensureRefreshAndSchedule(
    supabase,
    businessId,
    startDate,
    endDate,
    reason,
    scheduleBackground
  )
  const live = await fetchLivePnLMovement(supabase, businessId, startDate, endDate)
  if (!live.error) {
    return {
      ...live,
      snapshotStale: true,
      refreshJobId,
      liveFallbackSkipped: false,
    }
  }
  return { ...live, snapshotStale: true, refreshJobId, liveFallbackSkipped: false }
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

  // Fresh valid snapshot (metadata RPC excludes invalidated / stale-beyond-window).
  const freshMeta = await readPnlSnapshotMetadata(supabase, businessId, startDate, endDate)
  if (freshMeta && !freshMeta.snapshotStale && !isMateriallyStale(freshMeta.refreshed_at)) {
    if (freshMeta.line_count === 0) {
      return {
        rows: [],
        error: "",
        source: "snapshot",
        snapshotStale: false,
      }
    }
    const lines = await loadFreshSnapshotLines(supabase, businessId, startDate, endDate)
    if (lines.length > 0 || freshMeta.line_count === 0) {
      return {
        rows: lines,
        error: "",
        source: "snapshot",
        snapshotStale: false,
      }
    }
  }

  // Custom ranges (not an exact accounting period): always live.
  const isExactPeriod = await isExactAccountingPeriodRange(
    supabase,
    businessId,
    startDate,
    endDate
  )
  if (!isExactPeriod) {
    return fetchLivePnLMovement(supabase, businessId, startDate, endDate)
  }

  // Invalidated / missing / materially stale → bounded live + durable refresh.
  // Never treat invalidated or empty snapshot zeros as truth when the ledger moved.
  if (refreshOnRequest) {
    const refresh = await tryRefreshPnlMovementSnapshot(supabase, businessId, startDate, endDate)
    if (refresh.refreshed) {
      const after = await readPnlSnapshotMetadata(supabase, businessId, startDate, endDate)
      if (after && !after.snapshotStale && !isMateriallyStale(after.refreshed_at)) {
        if (after.line_count === 0) {
          return { rows: [], error: "", source: "snapshot", snapshotStale: false }
        }
        const lines = await loadFreshSnapshotLines(supabase, businessId, startDate, endDate)
        if (lines.length > 0) {
          return { rows: lines, error: "", source: "snapshot", snapshotStale: false }
        }
      }
    }
  }

  const staleMeta = freshMeta?.snapshotStale
    ? freshMeta
    : await readStalePnlSnapshotMetadata(supabase, businessId, startDate, endDate)

  const liveResult = await liveFallbackWithRefresh(
    supabase,
    businessId,
    startDate,
    endDate,
    staleMeta ? "read_path_stale_snapshot" : "read_path_missing_snapshot",
    options?.scheduleBackground
  )
  if (!liveResult.error) {
    return liveResult
  }

  // Live failed. Only initialize a zero snapshot when the ledger truly has no movement.
  const hasMovement = await periodHasLivePnlMovement(supabase, businessId, startDate, endDate)
  if (hasMovement) {
    return {
      rows: [],
      error: liveResult.error || "PNL_SNAPSHOT_UNAVAILABLE",
      source: "unavailable",
      snapshotStale: true,
      refreshJobId: liveResult.refreshJobId,
      liveFallbackSkipped: false,
    }
  }

  const zeroWritten = await ensureZeroPnlSnapshotForPeriod(
    supabase,
    businessId,
    startDate,
    endDate
  )
  if (zeroWritten) {
    return {
      rows: [],
      error: "",
      source: "zero_initialized",
      snapshotStale: false,
      refreshJobId: liveResult.refreshJobId,
      liveFallbackSkipped: true,
    }
  }

  return {
    rows: [],
    error: "",
    source: "snapshot",
    snapshotStale: false,
    refreshJobId: liveResult.refreshJobId,
    liveFallbackSkipped: true,
  }
}
