/**
 * Short-TTL in-process cache for default P&L period resolution (reports_pnl route only).
 * Enable: FINZA_PNL_REPORT_PERIOD_CACHE_TTL_SEC=45 (default 45s, max 120s; 0 disables).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { PnLReportInput } from "@/lib/accounting/reports/getProfitAndLossReport"
import {
  resolvePnLMovementRange,
  type PnLMovementRange,
} from "@/lib/accounting/reports/resolvePnLMovementRange"
import { buildPnlReportQueryFingerprint } from "@/lib/server/pnlReportCache"

export type PnlDefaultPeriodCacheStatus = "hit" | "miss" | "disabled"

type CacheEntry = {
  expiresAt: number
  range: PnLMovementRange
  error: string
}

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<CacheEntry | null>>()

const DEFAULT_TTL_SEC = 45

function ttlMs(): number {
  const raw = process.env.FINZA_PNL_REPORT_PERIOD_CACHE_TTL_SEC
  const sec = raw === undefined || raw === "" ? DEFAULT_TTL_SEC : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(sec, 120) * 1000
}

export function isDefaultPnLPeriodRequest(input: PnLReportInput): boolean {
  const rangeStart = input.start_date?.trim() ?? ""
  const rangeEnd = input.end_date?.trim() ?? ""
  const hasExplicitDateRange =
    !!(
      rangeStart &&
      rangeEnd &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) &&
      /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) &&
      rangeStart <= rangeEnd
    )
  if (hasExplicitDateRange) return false
  if (input.period_id?.trim()) return false
  if (input.period_start?.trim()) return false
  if (input.as_of_date?.trim()) return false
  if (rangeStart || rangeEnd) return false
  return true
}

function cacheKey(businessId: string, input: PnLReportInput): string {
  return `pnl_default_period:${businessId}:${buildPnlReportQueryFingerprint(input)}`
}

export function resetPnlDefaultPeriodCacheForTests(): void {
  store.clear()
  inflight.clear()
}

export type ResolvePnLMovementRangeForPnlRouteResult = {
  range: PnLMovementRange | null
  error: string
  periodCacheStatus: PnlDefaultPeriodCacheStatus
}

export async function resolvePnLMovementRangeForPnlRoute(
  supabase: SupabaseClient,
  input: PnLReportInput
): Promise<ResolvePnLMovementRangeForPnlRouteResult> {
  if (!isDefaultPnLPeriodRequest(input)) {
    const { range, error } = await resolvePnLMovementRange(supabase, input)
    return { range, error, periodCacheStatus: "disabled" }
  }

  const ms = ttlMs()
  if (ms <= 0) {
    const { range, error } = await resolvePnLMovementRange(supabase, input)
    return { range, error, periodCacheStatus: "disabled" }
  }

  const key = cacheKey(input.businessId, input)
  const hit = store.get(key)
  if (hit && Date.now() < hit.expiresAt) {
    return { range: hit.range, error: hit.error, periodCacheStatus: "hit" }
  }
  if (hit) store.delete(key)

  const pending = inflight.get(key)
  if (pending) {
    const entry = await pending
    if (entry) {
      return { range: entry.range, error: entry.error, periodCacheStatus: "miss" }
    }
    const { range, error } = await resolvePnLMovementRange(supabase, input)
    return { range, error, periodCacheStatus: "miss" }
  }

  const promise = resolvePnLMovementRange(supabase, input).then(({ range, error }) => {
    if (range) {
      const entry: CacheEntry = {
        expiresAt: Date.now() + ms,
        range,
        error,
      }
      store.set(key, entry)
      if (store.size > 200) {
        const now = Date.now()
        for (const [k, v] of store) {
          if (v.expiresAt <= now) store.delete(k)
        }
      }
      return entry
    }
    return null
  })

  inflight.set(
    key,
    promise.finally(() => {
      inflight.delete(key)
    })
  )

  const entry = await promise
  if (entry) {
    return { range: entry.range, error: entry.error, periodCacheStatus: "miss" }
  }
  return { range: null, error: "Accounting period could not be resolved", periodCacheStatus: "miss" }
}
