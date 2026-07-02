/**
 * Short-TTL cache + singleflight for GET /api/accounting/reports/profit-and-loss (512a).
 * Enable on staging preview: FINZA_PNL_REPORT_CACHE_TTL_SEC=30
 *
 * Process-local only — coalesces concurrent requests on the same key within one instance.
 */

import type { PnLReportResponse } from "@/lib/accounting/reports/getProfitAndLossReport"

type CacheEntry = { expiresAt: number; payload: unknown }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

function ttlMs(): number {
  const sec = Number(process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC ?? 0)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(Math.max(sec, 15), 120) * 1000
}

export function isPnlReportCacheEnabled(): boolean {
  return ttlMs() > 0
}

export type PnlReportCacheSource = "cache_hit" | "cache_miss" | "cache_coalesce"

export type PnlReportCacheResult<T> = {
  value: T
  source: PnlReportCacheSource
  cache_enabled: boolean
}

export type PnlReportQueryFingerprintInput = {
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
}

export function buildPnlReportQueryFingerprint(input: PnlReportQueryFingerprintInput): string {
  return [
    input.period_id?.trim() || "",
    input.period_start?.trim() || "",
    input.as_of_date?.trim() || "",
    input.start_date?.trim() || "",
    input.end_date?.trim() || "",
  ].join("|")
}

export function buildPnlReportCacheKey(
  businessId: string,
  movementStart: string,
  movementEnd: string,
  queryFingerprint: string
): string {
  return ["pnl", businessId, movementStart, movementEnd, queryFingerprint].join("|")
}

/** Map internal cache source to reports_pnl route diagnostic vocabulary. */
export function pnlReportCacheSourceForDiag(
  source: PnlReportCacheSource,
  cacheEnabled: boolean
): "disabled" | "miss" | "hit" | "singleflight" {
  if (!cacheEnabled) return "disabled"
  if (source === "cache_hit") return "hit"
  if (source === "cache_coalesce") return "singleflight"
  return "miss"
}

export function shouldCachePnlReportPayload(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object") return false
  const report = payload as Partial<PnLReportResponse>
  if (!Array.isArray(report.sections)) return false
  if (!report.period || typeof report.period !== "object") return false
  if (!report.totals || typeof report.totals !== "object") return false
  return true
}

function clonePayload<T>(value: T): T {
  return structuredClone(value)
}

export async function loadOrComputePnlReportCache<T>(
  key: string,
  compute: () => Promise<T>,
  options?: { shouldStore?: (value: T) => boolean }
): Promise<PnlReportCacheResult<T>> {
  const cacheEnabled = isPnlReportCacheEnabled()
  const ms = ttlMs()
  const shouldStore = options?.shouldStore ?? shouldCachePnlReportPayload

  if (ms > 0) {
    const hit = store.get(key)
    if (hit && Date.now() < hit.expiresAt) {
      return {
        value: clonePayload(hit.payload as T),
        source: "cache_hit",
        cache_enabled: cacheEnabled,
      }
    }
    if (hit) store.delete(key)
  }

  const pending = inflight.get(key)
  if (pending) {
    const value = (await pending) as T
    return {
      value: clonePayload(value),
      source: "cache_coalesce",
      cache_enabled: cacheEnabled,
    }
  }

  const promise = compute()
    .then((value) => {
      if (ms > 0 && shouldStore(value)) {
        store.set(key, { expiresAt: Date.now() + ms, payload: value })
        if (store.size > 200) {
          const now = Date.now()
          for (const [k, v] of store) {
            if (v.expiresAt <= now) store.delete(k)
          }
        }
      }
      return value
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)
  const value = await promise
  return { value: clonePayload(value), source: "cache_miss", cache_enabled: cacheEnabled }
}
