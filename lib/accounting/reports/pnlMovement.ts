/**
 * Ledger-derived P&L movement for a date range (je.date inclusive).
 * Metadata-first snapshot reads (522) with async refresh queue fallback.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  enqueueSnapshotRefreshJob,
  ensureZeroPnlSnapshotForPeriod,
  periodHasLivePnlMovement,
  readPnlSnapshotMetadata,
  readStalePnlSnapshotMetadata,
} from "@/lib/server/accountingSnapshotRefresh"
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

export type PnLMovementSource =
  | "snapshot"
  | "ledger"
  | "unavailable"
  | "zero_initialized"

export type PnLMovementFetchOptions = {
  /** When false, snapshot reads only — no blocking live refresh RPC. */
  refreshOnRequest?: boolean
}

export type PnLMovementFetchResult = {
  rows: PnLMovementRow[]
  error: string
  source: PnLMovementSource
  snapshotStale: boolean
  refreshJobId?: string | null
}

async function loadSnapshotLines(
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

async function loadStaleSnapshotLines(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<PnLMovementRow[]> {
  const { data, error } = await readStalePnlMovementLinesFromSnapshot(
    supabase,
    businessId,
    startDate,
    endDate
  )
  if (error || !Array.isArray(data)) return []
  return data as PnLMovementRow[]
}

async function resolveFromMetadata(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  metadata: { line_count: number; snapshotStale: boolean }
): Promise<PnLMovementFetchResult | null> {
  if (metadata.line_count === 0) {
    return {
      rows: [],
      error: "",
      source: "snapshot",
      snapshotStale: metadata.snapshotStale,
    }
  }

  const lines = metadata.snapshotStale
    ? await loadStaleSnapshotLines(supabase, businessId, startDate, endDate)
    : (
        await loadSnapshotLines(supabase, businessId, startDate, endDate, PNL_SNAPSHOT_FRESH_SECONDS)
      ).rows

  if (lines.length > 0) {
    return {
      rows: lines,
      error: "",
      source: "snapshot",
      snapshotStale: metadata.snapshotStale,
    }
  }

  return null
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

async function fetchLivePnLMovement(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string
): Promise<PnLMovementFetchResult> {
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

  let metadata = await readPnlSnapshotMetadata(supabase, businessId, startDate, endDate)
  if (metadata) {
    const resolved = await resolveFromMetadata(supabase, businessId, startDate, endDate, metadata)
    if (resolved) return resolved
  }

  if (!metadata) {
    metadata = await readStalePnlSnapshotMetadata(supabase, businessId, startDate, endDate)
    if (metadata) {
      const resolved = await resolveFromMetadata(supabase, businessId, startDate, endDate, metadata)
      if (resolved) return resolved
    }
  }

  if (refreshOnRequest) {
    const refresh = await tryRefreshPnlMovementSnapshot(supabase, businessId, startDate, endDate)
    if (refresh.refreshed) {
      metadata = await readPnlSnapshotMetadata(supabase, businessId, startDate, endDate)
      if (metadata) {
        const resolved = await resolveFromMetadata(supabase, businessId, startDate, endDate, metadata)
        if (resolved) return resolved
      }
    } else if (refresh.lockHeld) {
      console.info("[pnl-movement] snapshot refresh lock held; using live RPC")
    }

    return fetchLivePnLMovement(supabase, businessId, startDate, endDate)
  }

  const isExactPeriod = await isExactAccountingPeriodRange(
    supabase,
    businessId,
    startDate,
    endDate
  )
  if (!isExactPeriod) {
    return fetchLivePnLMovement(supabase, businessId, startDate, endDate)
  }

  const hasLiveMovement = await periodHasLivePnlMovement(supabase, businessId, startDate, endDate)

  if (hasLiveMovement) {
    const refreshJobId = await enqueueSnapshotRefreshJob(supabase, {
      businessId,
      periodStart: startDate,
      periodEnd: endDate,
      jobType: "both",
      reason: "read_path_missing_snapshot",
    })
    const live = await fetchLivePnLMovement(supabase, businessId, startDate, endDate)
    return { ...live, refreshJobId }
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
    }
  }

  const liveZero = await fetchLivePnLMovement(supabase, businessId, startDate, endDate)
  if (liveZero.error) {
    return { ...liveZero, source: "unavailable" }
  }
  return {
    ...liveZero,
    source: liveZero.rows.length === 0 ? "zero_initialized" : "ledger",
  }
}
