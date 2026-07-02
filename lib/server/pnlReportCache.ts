/**
 * Full-response cache + singleflight for GET /api/accounting/reports/profit-and-loss.
 *
 * Caches the final built report payload (sections/totals/telemetry) per process instance.
 * Default TTL 30s — override with FINZA_PNL_REPORT_CACHE_TTL_SEC (0 disables).
 *
 * Mixed-load: fresh hit skips snapshot reads and report assembly; expired entries are
 * served while an identical rebuild is in flight.
 */

import type { PnLReportResponse } from "@/lib/accounting/reports/getProfitAndLossReport"
import type { PnLReportLoadMeta } from "@/lib/accounting/reports/getProfitAndLossReport"

type CacheEntry = { expiresAt: number; payload: unknown; loadMeta: PnLReportLoadMeta }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<{ payload: unknown; loadMeta: PnLReportLoadMeta }>>()

const DEFAULT_TTL_SEC = 30

function ttlMs(): number {
  const raw = process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC
  const sec = raw === undefined || raw === "" ? DEFAULT_TTL_SEC : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(Math.max(sec, 15), 120) * 1000
}

export function isPnlReportCacheEnabled(): boolean {
  return ttlMs() > 0
}

export type PnlReportCacheStatus =
  | "hit"
  | "miss"
  | "expired_served"
  | "singleflight_owner"
  | "singleflight_joined"

/** @deprecated use PnlReportCacheStatus */
export type PnlReportCacheSource = "cache_hit" | "cache_miss" | "cache_coalesce"

export type PnlReportCachedPayload<T> = {
  data: T
  loadMeta: PnLReportLoadMeta
}

export type PnlReportCacheResult<T> = {
  value: PnlReportCachedPayload<T>
  cacheStatus: PnlReportCacheStatus
  cache_enabled: boolean
  servedExpiredCache: boolean
  /** @deprecated */
  source: PnlReportCacheSource
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

export type PnlReportCacheKeyInput = {
  businessId: string
  movementStart: string
  movementEnd: string
  queryFingerprint: string
  /** Refresh-on-request changes data path — separate cache entries. */
  refreshOnRequest: boolean
}

export function buildPnlReportCacheKey(input: PnlReportCacheKeyInput): string {
  return [
    "pnl",
    input.businessId,
    input.movementStart,
    input.movementEnd,
    input.queryFingerprint,
    input.refreshOnRequest ? "refresh" : "norefresh",
  ].join("|")
}

/** @deprecated pass PnlReportCacheKeyInput */
export function buildPnlReportCacheKeyLegacy(
  businessId: string,
  movementStart: string,
  movementEnd: string,
  queryFingerprint: string
): string {
  return buildPnlReportCacheKey({
    businessId,
    movementStart,
    movementEnd,
    queryFingerprint,
    refreshOnRequest: false,
  })
}

export function pnlReportCacheStatusForDiag(
  status: PnlReportCacheStatus,
  cacheEnabled: boolean
): "disabled" | "hit" | "miss" | "singleflight" {
  if (!cacheEnabled) return "disabled"
  if (status === "hit" || status === "expired_served") return "hit"
  if (status === "singleflight_joined" || status === "singleflight_owner") return "singleflight"
  return "miss"
}

/** @deprecated */
export function pnlReportCacheSourceForDiag(
  source: PnlReportCacheSource,
  cacheEnabled: boolean
): "disabled" | "hit" | "miss" | "singleflight" {
  return pnlReportCacheStatusForDiag(
    source === "cache_hit"
      ? "hit"
      : source === "cache_coalesce"
        ? "singleflight_joined"
        : "miss",
    cacheEnabled
  )
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

function getEntry(key: string): CacheEntry | undefined {
  return store.get(key)
}

function wrapResult<T>(
  payload: T,
  loadMeta: PnLReportLoadMeta,
  cacheStatus: PnlReportCacheStatus,
  cacheEnabled: boolean,
  servedExpiredCache: boolean
): PnlReportCacheResult<T> {
  const source: PnlReportCacheSource =
    cacheStatus === "hit" || cacheStatus === "expired_served"
      ? "cache_hit"
      : cacheStatus === "singleflight_joined"
        ? "cache_coalesce"
        : "cache_miss"

  return {
    value: { data: clonePayload(payload), loadMeta: { ...loadMeta } },
    cacheStatus,
    cache_enabled: cacheEnabled,
    servedExpiredCache,
    source,
  }
}

export async function loadOrComputePnlReportCache<T>(
  key: string,
  compute: () => Promise<{ payload: T; loadMeta: PnLReportLoadMeta } | null>,
  options?: {
    shouldStore?: (payload: T) => boolean
    /** When compute returns null/failure, serve last expired entry if present. */
    serveExpiredOnMiss?: boolean
  }
): Promise<PnlReportCacheResult<T>> {
  const cacheEnabled = isPnlReportCacheEnabled()
  const ms = ttlMs()
  const shouldStore = options?.shouldStore ?? shouldCachePnlReportPayload
  const now = Date.now()

  const entry = ms > 0 ? getEntry(key) : undefined
  const isFresh = Boolean(entry && now < entry.expiresAt)
  const isExpired = Boolean(entry && now >= entry.expiresAt)

  if (ms > 0 && isFresh && entry) {
    return wrapResult(
      entry.payload as T,
      entry.loadMeta,
      "hit",
      cacheEnabled,
      false
    )
  }

  const pending = inflight.get(key)
  if (pending) {
    if (ms > 0 && isExpired && entry) {
      return wrapResult(
        entry.payload as T,
        entry.loadMeta,
        "expired_served",
        cacheEnabled,
        true
      )
    }
    const built = await pending
    return wrapResult(built.payload as T, built.loadMeta, "singleflight_joined", cacheEnabled, false)
  }

  const promise = (async () => {
    const built = await compute()
    if (built && ms > 0 && shouldStore(built.payload)) {
      store.set(key, {
        expiresAt: Date.now() + ms,
        payload: built.payload,
        loadMeta: built.loadMeta,
      })
      if (store.size > 200) {
        const t = Date.now()
        for (const [k, v] of store) {
          if (v.expiresAt <= t) store.delete(k)
        }
      }
    }
    return built
  })().finally(() => {
    inflight.delete(key)
  })

  inflight.set(key, promise as Promise<{ payload: unknown; loadMeta: PnLReportLoadMeta }>)

  const built = await promise

  if (!built) {
    if (options?.serveExpiredOnMiss && entry) {
      return wrapResult(entry.payload as T, entry.loadMeta, "expired_served", cacheEnabled, true)
    }
    return wrapResult({} as T, { movementSource: "unavailable", snapshotStale: false }, "miss", cacheEnabled, false)
  }

  return wrapResult(
    built.payload,
    built.loadMeta,
    isExpired ? "singleflight_owner" : "miss",
    cacheEnabled,
    false
  )
}

/** Returns last stored payload regardless of TTL (process-local stale cache). */
export function getExpiredPnlReportCacheEntry<T>(key: string): T | null {
  const hit = store.get(key)
  if (!hit) return null
  return clonePayload(hit.payload as T)
}

/** Test-only: mark cache entry expired immediately. */
export function expirePnlReportCacheEntryForTests(key: string): void {
  const hit = store.get(key)
  if (hit) {
    hit.expiresAt = Date.now() - 1
  }
}

/** Test-only: clear process-local store and inflight. */
export function resetPnlReportCacheForTests(): void {
  store.clear()
  inflight.clear()
}
