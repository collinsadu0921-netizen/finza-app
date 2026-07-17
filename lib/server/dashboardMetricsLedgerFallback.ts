/**
 * Bounded ledger fallback for dashboard period metrics/timeline when snapshots are missing.
 * Ledger (finza_dashboard_pnl_totals / get_service_dashboard_timeline) is source of truth;
 * service_dashboard_period_summary is a projection only.
 */

import type { createSupabaseServerClient } from "@/lib/supabaseServer"
import type { TimelineRpcRow } from "@/lib/server/serviceDashboardTimeline"

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export type LivePeriodPnlRow = {
  revenue: number
  expenses: number
  net_profit: number
}

export type LivePeriodPnlResult = {
  row: LivePeriodPnlRow | null
  timedOut: boolean
  error?: string
}

const DEFAULT_TIMEOUT_MS = 4000

export function dashboardLiveFallbackTimeoutMs(): number {
  const raw = process.env.FINZA_DASHBOARD_LIVE_FALLBACK_TIMEOUT_MS?.trim()
  if (!raw) return DEFAULT_TIMEOUT_MS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 8000) : DEFAULT_TIMEOUT_MS
}

export async function withBoundedTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function num(v: unknown): number {
  return roundMoney(Number(v) || 0)
}

export async function loadLivePeriodPnlFromLedger(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string,
  endDate: string,
  timeoutMs: number = dashboardLiveFallbackTimeoutMs()
): Promise<LivePeriodPnlResult> {
  const fetchPnl = async (): Promise<LivePeriodPnlResult> => {
    const { data, error } = await supabase.rpc("finza_dashboard_pnl_totals", {
      p_business_id: businessId,
      p_start_date: startDate,
      p_end_date: endDate,
    })
    if (error) {
      return { row: null, timedOut: false, error: error.message }
    }
    const raw = Array.isArray(data) ? data[0] : data
    if (!raw || typeof raw !== "object") {
      return { row: null, timedOut: false }
    }
    return {
      row: {
        revenue: num((raw as { revenue?: unknown }).revenue),
        expenses: num((raw as { expenses?: unknown }).expenses),
        net_profit: num((raw as { net_profit?: unknown }).net_profit),
      },
      timedOut: false,
    }
  }

  return withBoundedTimeout(fetchPnl(), timeoutMs, () => ({
    row: null,
    timedOut: true,
  }))
}

export async function loadLiveTimelineRowsBounded(
  supabase: SupabaseClient,
  businessId: string,
  periodsLimit: number,
  timeoutMs: number = dashboardLiveFallbackTimeoutMs()
): Promise<{ rows: TimelineRpcRow[]; timedOut: boolean; error?: string }> {
  const fetchTimeline = async () => {
    const { data, error } = await supabase.rpc("get_service_dashboard_timeline", {
      p_business_id: businessId,
      p_start_date: null,
      p_end_date: null,
      p_granularity: "accounting_period",
      p_periods_limit: periodsLimit,
    })
    if (error) {
      return { rows: [] as TimelineRpcRow[], timedOut: false, error: error.message }
    }
    return { rows: (data ?? []) as TimelineRpcRow[], timedOut: false }
  }

  return withBoundedTimeout(fetchTimeline(), timeoutMs, () => ({
    rows: [],
    timedOut: true,
  }))
}

/** Merge live ledger timeline rows for periods absent from summary projection. */
export function mergeTimelineWithLiveMissingPeriods(
  summaryRows: TimelineRpcRow[],
  liveRows: TimelineRpcRow[],
  periodsLimit: number
): { rows: TimelineRpcRow[]; patchedPeriods: string[] } {
  if (liveRows.length === 0) {
    return { rows: summaryRows, patchedPeriods: [] }
  }
  const byStart = new Map<string, TimelineRpcRow>()
  for (const row of summaryRows) {
    byStart.set(row.period_start, row)
  }
  const patchedPeriods: string[] = []
  for (const live of liveRows) {
    if (!byStart.has(live.period_start)) {
      byStart.set(live.period_start, live)
      patchedPeriods.push(live.period_start)
    }
  }
  const merged = Array.from(byStart.values()).sort((a, b) =>
    b.period_start.localeCompare(a.period_start)
  )
  return {
    rows: merged.slice(0, periodsLimit),
    patchedPeriods,
  }
}
