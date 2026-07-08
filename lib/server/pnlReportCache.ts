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
import {
  getPnlReportRemoteCacheEntry,
  isPnlReportRemoteCacheEnabled,
  setPnlReportRemoteCacheEntry,
  type PnlReportRemoteCacheStatus,
} from "@/lib/server/pnlReportRemoteCache"

type CacheEntry = { expiresAt: number; payload: unknown; loadMeta: PnLReportLoadMeta }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<{ payload: unknown; loadMeta: PnLReportLoadMeta }>>()

// Coalesce background refresh triggers per key within one instance.
const remoteRefreshInFlight = new Map<string, Promise<void>>()

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

export type PnlReportCacheTiming = {
  remoteCacheReadMs: number
  staleReturnMs: number
  refreshScheduled: boolean
  refreshAwaited: boolean
}

export type PnlReportCacheResult<T> = {
  value: PnlReportCachedPayload<T>
  cacheStatus: PnlReportCacheStatus
  cache_enabled: boolean
  servedExpiredCache: boolean
  remoteCacheStatus: PnlReportRemoteCacheStatus
  remoteRefreshStarted: boolean
  timing: PnlReportCacheTiming
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

function businessIdFromCacheKey(key: string): string | undefined {
  const parts = key.split("|")
  return parts.length >= 2 && parts[0] === "pnl" ? parts[1] : undefined
}

const emptyTiming = (): PnlReportCacheTiming => ({
  remoteCacheReadMs: 0,
  staleReturnMs: 0,
  refreshScheduled: false,
  refreshAwaited: false,
})

function wrapResult<T>(
  payload: T,
  loadMeta: PnLReportLoadMeta,
  cacheStatus: PnlReportCacheStatus,
  cacheEnabled: boolean,
  servedExpiredCache: boolean,
  remoteCacheStatus: PnlReportRemoteCacheStatus,
  remoteRefreshStarted: boolean,
  timing: PnlReportCacheTiming = emptyTiming()
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
    remoteCacheStatus,
    remoteRefreshStarted,
    timing,
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
    businessId?: string
    cacheRemote?: boolean
    /** Schedule background refresh (e.g. Vercel waitUntil). If absent, skip refresh. */
    scheduleBackground?: (promise: Promise<void>) => void
  }
): Promise<PnlReportCacheResult<T>> {
  const cacheEnabled = isPnlReportCacheEnabled()
  const ms = ttlMs()
  const shouldStore = options?.shouldStore ?? shouldCachePnlReportPayload
  const businessId = options?.businessId ?? businessIdFromCacheKey(key)
  const cacheRemote = options?.cacheRemote ?? true

  const now = Date.now()
  const entry = ms > 0 ? getEntry(key) : undefined
  const isFresh = Boolean(entry && now < entry.expiresAt)
  const isExpired = Boolean(entry && now >= entry.expiresAt)

  // ── L1 hit (process-local) ───────────────────────────────────────────────
  if (ms > 0 && isFresh && entry) {
    return wrapResult(
      entry.payload as T,
      entry.loadMeta,
      "hit",
      cacheEnabled,
      false,
      "miss",
      false
    )
  }

  // ── L1 inflight singleflight ─────────────────────────────────────────────
  const pending = inflight.get(key)
  if (pending) {
    if (ms > 0 && isExpired && entry) {
      return wrapResult(
        entry.payload as T,
        entry.loadMeta,
        "expired_served",
        cacheEnabled,
        true,
        "miss",
        false
      )
    }
    const built = await pending
    return wrapResult(
      built.payload as T,
      built.loadMeta,
      "singleflight_joined",
      cacheEnabled,
      false,
      "miss",
      false
    )
  }

  // ── Remote (L2) soft TTL + stale-while-revalidate ─────────────────────────
  const computeTimeoutMs = (() => {
    const raw = Number(process.env.FINZA_PNL_REPORT_COMPUTE_TIMEOUT_MS ?? "8000")
    if (!Number.isFinite(raw) || raw <= 0) return 8000
    return Math.min(Math.max(raw, 2000), 20000)
  })()

  const computeWithTimeout = async () => {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        compute(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), computeTimeoutMs)
        }),
      ])
    } catch {
      return null
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  let remoteCacheStatus: PnlReportRemoteCacheStatus = "miss"
  let timing = emptyTiming()
  if (isPnlReportRemoteCacheEnabled()) {
    const tRemote = performance.now()
    const remote = await getPnlReportRemoteCacheEntry<T>(key)
    timing.remoteCacheReadMs = remote.readMs
    remoteCacheStatus = remote.status

    if (remote.entry && remote.status === "hit") {
      if (ms > 0) {
        store.set(key, {
          expiresAt: Date.now() + ms,
          payload: remote.entry.payload,
          loadMeta: remote.entry.loadMeta,
        })
      }

      return wrapResult(
        remote.entry.payload,
        remote.entry.loadMeta,
        "hit",
        cacheEnabled,
        false,
        remoteCacheStatus,
        false,
        timing
      )
    }

    if (remote.entry && remote.status === "stale_hit") {
      let remoteRefreshStarted = false
      const existing = remoteRefreshInFlight.get(key)
      if (!existing && options?.scheduleBackground) {
        remoteRefreshStarted = true
        timing.refreshScheduled = true
        timing.refreshAwaited = false

        const refreshPromise = new Promise<void>((resolve, reject) => {
          setImmediate(() => {
            ;(async () => {
              try {
                const built = await computeWithTimeout()
                if (!built) return

                if (ms > 0 && shouldStore(built.payload)) {
                  store.set(key, {
                    expiresAt: Date.now() + ms,
                    payload: built.payload,
                    loadMeta: built.loadMeta,
                  })
                }

                if (cacheRemote && shouldStore(built.payload) && isPnlReportRemoteCacheEnabled()) {
                  await setPnlReportRemoteCacheEntry(
                    key,
                    { payload: built.payload, loadMeta: built.loadMeta },
                    { businessId }
                  )
                }
              } catch (err) {
                reject(err)
              } finally {
                remoteRefreshInFlight.delete(key)
                resolve()
              }
            })()
          })
        })

        remoteRefreshInFlight.set(key, refreshPromise)
        options.scheduleBackground(refreshPromise)
      }

      timing.staleReturnMs = Math.round((performance.now() - tRemote) * 10) / 10

      // Serve stale immediately; rebuild is scheduled via waitUntil (never awaited here).
      return wrapResult(
        remote.entry.payload,
        remote.entry.loadMeta,
        "expired_served",
        cacheEnabled,
        true,
        remoteCacheStatus,
        remoteRefreshStarted,
        timing
      )
    }
  }

  const pendingAfterRemote = inflight.get(key)
  if (pendingAfterRemote) {
    const built = await pendingAfterRemote
    return wrapResult(
      built.payload as T,
      built.loadMeta,
      "singleflight_joined",
      cacheEnabled,
      false,
      remoteCacheStatus,
      false,
      timing
    )
  }

  // ── Compute path (remote miss/error / hard-expired) ──────────────────────
  const promise = (async () => {
    const built = await computeWithTimeout()

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

    if (built && shouldStore(built.payload) && cacheRemote && isPnlReportRemoteCacheEnabled()) {
      const setStatus = await setPnlReportRemoteCacheEntry(
        key,
        { payload: built.payload, loadMeta: built.loadMeta },
        { businessId }
      )
      if (setStatus === "error") {
        remoteCacheStatus = "error"
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
      return wrapResult(
        entry.payload as T,
        entry.loadMeta,
        "expired_served",
        cacheEnabled,
        true,
        remoteCacheStatus,
        false,
        timing
      )
    }

    return wrapResult(
      {} as T,
      { movementSource: "unavailable", snapshotStale: false },
      "miss",
      cacheEnabled,
      false,
      remoteCacheStatus,
      false,
      timing
    )
  }

  return wrapResult(
    built.payload,
    built.loadMeta,
    isExpired ? "singleflight_owner" : "miss",
    cacheEnabled,
    false,
    remoteCacheStatus,
    false,
    { ...timing, refreshAwaited: true }
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
  remoteRefreshInFlight.clear()
}
