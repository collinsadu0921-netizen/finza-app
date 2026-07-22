/**
 * Ledger-derived P&L movement for a date range (je.date inclusive).
 * Metadata-first snapshot reads (522) with async refresh queue fallback.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  enqueueSnapshotRefreshJob,
  ensureZeroPnlSnapshotForPeriod,
  readPnlSnapshotMetadata,
  readStalePnlSnapshotMetadata,
} from "@/lib/server/accountingSnapshotRefresh"
import { PNL_SNAPSHOT_FRESH_SECONDS } from "@/lib/server/dashboardPeriodSummaryRead"
import {
  readPnlMovementLinesFromSnapshot,
  readStalePnlMovementLinesFromSnapshot,
  tryRefreshPnlMovementSnapshot,
} from "@/lib/server/pnlMovementSnapshotRefresh"

/** Beyond this age, stale snapshots must not be silently treated as current truth. */
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
  /** When false, snapshot reads only — no blocking live refresh RPC. */
  refreshOnRequest?: boolean
}

export type PnLMovementFetchResult = {
  rows: PnLMovementRow[]
  error: string
  source: PnLMovementSource
  snapshotStale: boolean
  refreshJobId?: string | null
  /** True when refresh-on-request is off and live ledger RPC was not used. */
  liveFallbackSkipped?: boolean
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

function snapshotAgeSeconds(refreshedAt: string | undefined): number | null {
  if (!refreshedAt) return null
  const ms = Date.now() - new Date(refreshedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return ms / 1000
}

async function resolveFromMetadata(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  metadata: { line_count: number; snapshotStale: boolean; refreshed_at?: string },
  options?: { refreshOnRequest?: boolean; enqueueOnStale?: boolean }
): Promise<PnLMovementFetchResult | null> {
  let refreshJobId: string | null | undefined

  if (metadata.snapshotStale && options?.enqueueOnStale !== false) {
    refreshJobId = await enqueueSnapshotRefreshJob(supabase, {
      businessId,
      periodStart: startDate,
      periodEnd: endDate,
      jobType: "both",
      reason: "read_path_stale_snapshot",
    })
  }

  const ageSec = snapshotAgeSeconds(metadata.refreshed_at)
  const materiallyStale =
    metadata.snapshotStale &&
    ageSec != null &&
    ageSec > PNL_MATERIAL_STALE_SECONDS

  // Materially stale + refresh-on-request off: bounded live fallback for exact period.
  if (materiallyStale && options?.refreshOnRequest === false) {
    const live = await fetchLivePnLMovement(supabase, businessId, startDate, endDate)
    if (!live.error) {
      return {
        ...live,
        snapshotStale: true,
        refreshJobId,
        liveFallbackSkipped: false,
      }
    }
  }

  if (metadata.line_count === 0 && !materiallyStale) {
    return {
      rows: [],
      error: "",
      source: "snapshot",
      snapshotStale: metadata.snapshotStale,
      refreshJobId,
    }
  }

  const lines = metadata.snapshotStale
    ? await loadStaleSnapshotLines(supabase, businessId, startDate, endDate)
    : (
        await loadSnapshotLines(supabase, businessId, startDate, endDate, PNL_SNAPSHOT_FRESH_SECONDS)
      ).rows

  if (lines.length > 0 && !materiallyStale) {
    return {
      rows: lines,
      error: "",
      source: "snapshot",
      snapshotStale: metadata.snapshotStale,
      refreshJobId,
    }
  }

  if (materiallyStale && lines.length > 0 && options?.refreshOnRequest !== false) {
    // Refresh-on-request path prefers live after tryRefresh; return null to continue.
    return null
  }

  if (materiallyStale) {
    return {
      rows: [],
      error: "PNL_SNAPSHOT_STALE",
      source: "unavailable",
      snapshotStale: true,
      refreshJobId,
      liveFallbackSkipped: options?.refreshOnRequest === false,
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
    const resolved = await resolveFromMetadata(supabase, businessId, startDate, endDate, metadata, {
      refreshOnRequest,
      enqueueOnStale: true,
    })
    if (resolved) return resolved
  }

  if (!metadata) {
    metadata = await readStalePnlSnapshotMetadata(supabase, businessId, startDate, endDate)
    if (metadata) {
      const resolved = await resolveFromMetadata(supabase, businessId, startDate, endDate, metadata, {
        refreshOnRequest,
        enqueueOnStale: true,
      })
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

  // Exact period, refresh off: enqueue async rebuild; never block on live ledger RPC.
  const refreshJobId = await enqueueSnapshotRefreshJob(supabase, {
    businessId,
    periodStart: startDate,
    periodEnd: endDate,
    jobType: "both",
    reason: "read_path_missing_snapshot",
  })

  const zeroWritten = await ensureZeroPnlSnapshotForPeriod(
    supabase,
    businessId,
    startDate,
    endDate
  )
  if (zeroWritten) {
    console.info("[pnl-movement] zero snapshot initialized (refresh-on-request off)", {
      businessId,
      startDate,
      endDate,
      refreshJobId,
      live_fallback_skipped: true,
    })
    return {
      rows: [],
      error: "",
      source: "zero_initialized",
      snapshotStale: false,
      refreshJobId,
      liveFallbackSkipped: true,
    }
  }

  console.info("[pnl-movement] snapshot missing; live fallback skipped (refresh-on-request off)", {
    businessId,
    startDate,
    endDate,
    refreshJobId,
    snapshot_missing: true,
    live_fallback_skipped: true,
  })
  return {
    rows: [],
    error: "PNL_SNAPSHOT_UNAVAILABLE",
    source: "unavailable",
    snapshotStale: false,
    refreshJobId,
    liveFallbackSkipped: true,
  }
}
