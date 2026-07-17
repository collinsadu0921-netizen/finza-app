/**
 * Dashboard timeline loader — summary-first with circuit breaker (508/509).
 * Live ledger scan only as controlled first-load fallback when summary empty but ledger exists.
 */

import type { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enqueueSnapshotRefreshJob } from "@/lib/server/accountingSnapshotRefresh"
import { supabaseErrorDiag, type createRouteDiag } from "@/lib/server/routeDiagnostics"
import {
  loadLiveTimelineRowsBounded,
  mergeTimelineWithLiveMissingPeriods,
} from "@/lib/server/dashboardMetricsLedgerFallback"

export const SUMMARY_FRESH_SECONDS = 300

export type TimelineRpcRow = {
  period_id: string | null
  period_start: string
  period_end: string
  revenue: number | string
  expenses: number | string
  net_profit: number | string
}

export type ServiceDashboardTimelineItem = {
  period_id?: string
  period_start: string
  period_end: string
  revenue: number
  expenses: number
  netProfit: number
}

export type TimelineLoadSource =
  | "summary_fresh"
  | "summary_stale"
  | "summary_stale_lock"
  | "summary_refreshed"
  | "live_first_load_fallback"
  | "summary_stale_live_patch"
  | "empty_refresh_in_progress"
  | "empty_with_ledger"
  | "empty"
  | "degraded"

export type ServiceDashboardTimelineLoadOptions = {
  /** When false, read summary only — no refresh or live fallback (cluster operational gate). */
  refreshOnRequest?: boolean
}

export type ServiceDashboardTimelineResult = {
  timeline: ServiceDashboardTimelineItem[]
  source: TimelineLoadSource
  /** False when empty timeline but ledger movement exists — do not cache. */
  cacheable: boolean
  diagnostic?: string
}

export function mapTimelineRows(rows: TimelineRpcRow[]): ServiceDashboardTimelineItem[] {
  return rows.map((row) => ({
    period_id: row.period_id ?? undefined,
    period_start: row.period_start,
    period_end: row.period_end,
    revenue: Number(row.revenue) || 0,
    expenses: Number(row.expenses) || 0,
    netProfit: Number(row.net_profit) || 0,
  }))
}

export function isTimelineResultCacheable(result: ServiceDashboardTimelineResult): boolean {
  if (result.timeline.length > 0) return true
  return result.cacheable
}

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>
type RouteDiag = ReturnType<typeof createRouteDiag>

async function readFreshSummary(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<TimelineRpcRow[]> {
  const { data, error } = await supabase.rpc("get_service_dashboard_timeline_from_summary", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
    p_max_stale_seconds: SUMMARY_FRESH_SECONDS,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] fresh summary read failed:", error.message)
    return []
  }
  return (data ?? []) as TimelineRpcRow[]
}

async function readStaleSummary(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<TimelineRpcRow[]> {
  const { data, error } = await supabase.rpc("get_service_dashboard_timeline_stale_summary", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] stale summary read failed:", error.message)
    return []
  }
  return (data ?? []) as TimelineRpcRow[]
}

async function tryRefreshSummary(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<{ refreshed: boolean; lockHeld: boolean; periodCount: number }> {
  const { data, error } = await supabase.rpc("try_refresh_service_dashboard_period_summaries", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] try_refresh failed:", error.message)
    return { refreshed: false, lockHeld: false, periodCount: 0 }
  }
  const row = (data ?? {}) as {
    refreshed?: boolean
    lock_held?: boolean
    period_count?: number
  }
  return {
    refreshed: Boolean(row.refreshed),
    lockHeld: Boolean(row.lock_held),
    periodCount: Number(row.period_count) || 0,
  }
}

async function blockingRefreshSummary(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<number> {
  const { data, error } = await supabase.rpc("refresh_service_dashboard_period_summaries", {
    p_business_id: businessId,
    p_periods_limit: periodsParam,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] blocking refresh failed:", error.message)
    return 0
  }
  return Number(data) || 0
}

async function businessHasLedgerMovement(
  supabase: SupabaseClient,
  businessId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("get_service_dashboard_business_has_ledger_movement", {
    p_business_id: businessId,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] ledger probe failed:", error.message)
    return false
  }
  return Boolean(data)
}

async function loadTimelineLiveOnce(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number
): Promise<TimelineRpcRow[]> {
  const { data, error } = await supabase.rpc("get_service_dashboard_timeline", {
    p_business_id: businessId,
    p_start_date: null,
    p_end_date: null,
    p_granularity: "accounting_period",
    p_periods_limit: periodsParam,
  })
  if (error) {
    console.warn("[service-dashboard-timeline] live fallback failed:", error.message)
    return []
  }
  return (data ?? []) as TimelineRpcRow[]
}

function finish(
  diag: RouteDiag,
  t0: number,
  periodsParam: number,
  result: ServiceDashboardTimelineResult,
  extra?: Record<string, unknown>
): ServiceDashboardTimelineResult {
  diag.step("timeline", {
    timeline_source: result.source,
    row_count: result.timeline.length,
    periods: periodsParam,
    cacheable: result.cacheable,
    ms: Math.round((performance.now() - t0) * 10) / 10,
    ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
    ...extra,
  })
  return result
}

function rowsResult(
  rows: TimelineRpcRow[],
  source: TimelineLoadSource
): ServiceDashboardTimelineResult {
  return {
    timeline: mapTimelineRows(rows),
    source,
    cacheable: rows.length > 0,
  }
}

async function enqueueTimelineSnapshotRefreshJobs(
  supabase: SupabaseClient,
  businessId: string,
  rows: TimelineRpcRow[]
): Promise<void> {
  const seen = new Set<string>()
  for (const row of rows) {
    const key = `${row.period_start}|${row.period_end}`
    if (seen.has(key)) continue
    seen.add(key)
    void enqueueSnapshotRefreshJob(supabase, {
      businessId,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      jobType: "both",
      reason: "read_path_missing_snapshot",
      sourceType: "dashboard_timeline",
    })
  }
}

async function resolveEmptyWithLedger(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number,
  diag: RouteDiag,
  t0: number,
  extra?: Record<string, unknown> & { refreshOnRequest?: boolean }
): Promise<ServiceDashboardTimelineResult> {
  const refreshOnRequest = extra?.refreshOnRequest !== false
  const hasLedger = await businessHasLedgerMovement(supabase, businessId)
  if (!hasLedger) {
    return finish(diag, t0, periodsParam, {
      timeline: [],
      source: "empty",
      cacheable: true,
    }, extra)
  }

  const liveRows = await loadTimelineLiveOnce(supabase, businessId, periodsParam)
  if (liveRows.length > 0) {
    if (refreshOnRequest) {
      void blockingRefreshSummary(supabase, businessId, periodsParam)
    } else {
      void enqueueTimelineSnapshotRefreshJobs(supabase, businessId, liveRows)
    }
    return finish(
      diag,
      t0,
      periodsParam,
      rowsResult(liveRows, "live_first_load_fallback"),
      { ...extra, live_fallback_rows: liveRows.length }
    )
  }

  return finish(diag, t0, periodsParam, {
    timeline: [],
    source: "empty_with_ledger",
    cacheable: false,
    diagnostic: "summary_and_live_fallback_empty",
  }, extra)
}

/**
 * Summary-first timeline with circuit breaker and controlled live first-load fallback.
 */
export async function loadServiceDashboardTimeline(
  supabase: SupabaseClient,
  businessId: string,
  periodsParam: number,
  diag: RouteDiag,
  options?: ServiceDashboardTimelineLoadOptions
): Promise<ServiceDashboardTimelineResult> {
  const t0 = performance.now()
  const refreshOnRequest = options?.refreshOnRequest !== false

  const freshRows = await readFreshSummary(supabase, businessId, periodsParam)
  if (freshRows.length > 0) {
    return finish(diag, t0, periodsParam, rowsResult(freshRows, "summary_fresh"))
  }

  const staleRows = await readStaleSummary(supabase, businessId, periodsParam)
  if (staleRows.length > 0) {
    if (!refreshOnRequest) {
      const liveRead = await loadLiveTimelineRowsBounded(supabase, businessId, periodsParam)
      if (liveRead.rows.length > 0) {
        const { rows, patchedPeriods } = mergeTimelineWithLiveMissingPeriods(
          staleRows,
          liveRead.rows,
          periodsParam
        )
        if (patchedPeriods.length > 0) {
          void enqueueTimelineSnapshotRefreshJobs(
            supabase,
            businessId,
            liveRead.rows.filter((r) => patchedPeriods.includes(r.period_start))
          )
          return finish(
            diag,
            t0,
            periodsParam,
            rowsResult(rows, "summary_stale_live_patch"),
            {
              refresh_skipped: true,
              live_patched_periods: patchedPeriods,
              ...(liveRead.timedOut ? { live_fallback_timeout: true } : {}),
            }
          )
        }
      }
    }
    if (refreshOnRequest) {
      void tryRefreshSummary(supabase, businessId, periodsParam)
    }
    return finish(
      diag,
      t0,
      periodsParam,
      rowsResult(staleRows, "summary_stale"),
      refreshOnRequest ? undefined : { refresh_skipped: true }
    )
  }

  if (!refreshOnRequest) {
    return resolveEmptyWithLedger(supabase, businessId, periodsParam, diag, t0, {
      refresh_skipped: true,
      refreshOnRequest: false,
    })
  }

  const blockingCount = await blockingRefreshSummary(supabase, businessId, periodsParam)
  const afterFresh = await readFreshSummary(supabase, businessId, periodsParam)
  const afterRows =
    afterFresh.length > 0 ? afterFresh : await readStaleSummary(supabase, businessId, periodsParam)

  if (afterRows.length > 0) {
    return finish(
      diag,
      t0,
      periodsParam,
      rowsResult(afterRows, "summary_refreshed"),
      { refresh_period_count: blockingCount }
    )
  }

  const refreshTry = await tryRefreshSummary(supabase, businessId, periodsParam)
  if (refreshTry.lockHeld) {
    const lockedStale = await readStaleSummary(supabase, businessId, periodsParam)
    if (lockedStale.length > 0) {
      return finish(
        diag,
        t0,
        periodsParam,
        rowsResult(lockedStale, "summary_stale_lock"),
        { lock_held: true }
      )
    }
    return resolveEmptyWithLedger(supabase, businessId, periodsParam, diag, t0, {
      lock_held: true,
      refresh_period_count: blockingCount,
      refreshOnRequest: true,
    })
  }

  return resolveEmptyWithLedger(supabase, businessId, periodsParam, diag, t0, {
    refresh_period_count: blockingCount || refreshTry.periodCount,
    refreshOnRequest: true,
  })
}

/** Cluster payload guard: do not cache empty timeline when metrics show movement. */
export function shouldCacheDashboardClusterPayload(payload: {
  timeline: ServiceDashboardTimelineItem[]
  metrics?: { revenue?: number; expenses?: number; netProfit?: number } | null
}): boolean {
  if (payload.timeline.length > 0) return true
  const revenue = Number(payload.metrics?.revenue ?? 0)
  const expenses = Number(payload.metrics?.expenses ?? 0)
  const netProfit = Number(payload.metrics?.netProfit ?? 0)
  if (revenue !== 0 || expenses !== 0 || netProfit !== 0) return false
  return true
}
