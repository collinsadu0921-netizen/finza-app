/**
 * In-process stale-while-revalidate cache + singleflight for dashboard cluster.
 * Enable: FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC=30 on preview/staging.
 *
 * L1 only — per-instance. Cross-instance stampede protection is not included;
 * pair with summary tables / remote cache in a follow-up if needed.
 */

type CacheEntry = { expiresAt: number; payload: unknown }

const activityStore = new Map<string, CacheEntry>()
const activityInflight = new Map<string, Promise<unknown>>()

/** Fixed TTL for activity payload cache (always on). */
export const DASHBOARD_ACTIVITY_CACHE_TTL_MS = 30_000

function activityTtlMs(): number {
  const envSec = Number(process.env.FINZA_DASHBOARD_ACTIVITY_CACHE_TTL_SEC ?? 0)
  if (Number.isFinite(envSec) && envSec > 0) {
    return Math.min(envSec, 120) * 1000
  }
  return DASHBOARD_ACTIVITY_CACHE_TTL_MS
}

// ── Cluster SWR cache ───────────────────────────────────────────────────────

type ClusterCacheEntry = {
  payload: unknown
  cachedAt: number
  softExpiresAt: number
  hardExpiresAt: number
}

const clusterStore = new Map<string, ClusterCacheEntry>()
const clusterInflight = new Map<string, Promise<unknown | null>>()
const clusterRefreshInFlight = new Map<string, Promise<void>>()

const DEFAULT_SOFT_TTL_SEC = 30
const DEFAULT_HARD_TTL_SEC = 120
const DEFAULT_COMPUTE_TIMEOUT_MS = 8000

function softTtlMs(): number {
  const raw = process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC
  const sec = raw === undefined || raw === "" ? DEFAULT_SOFT_TTL_SEC : Number(raw)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(Math.max(sec, 15), 120) * 1000
}

function hardTtlMs(): number {
  const raw = process.env.FINZA_DASHBOARD_CLUSTER_CACHE_HARD_TTL_SEC
  if (raw !== undefined && raw !== "") {
    const sec = Number(raw)
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(Math.max(sec, 30), 600) * 1000
    }
  }
  const soft = softTtlMs()
  if (soft <= 0) return 0
  return Math.min(soft * 4, DEFAULT_HARD_TTL_SEC * 1000)
}

function computeTimeoutMs(): number {
  const raw = Number(process.env.FINZA_DASHBOARD_CLUSTER_COMPUTE_TIMEOUT_MS ?? DEFAULT_COMPUTE_TIMEOUT_MS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_COMPUTE_TIMEOUT_MS
  return Math.min(Math.max(raw, 2000), 20000)
}

/** Jitter soft TTL per entry so instances do not expire simultaneously. */
function jitteredSoftExpiryMs(now: number, baseMs: number): number {
  const jitter = Math.floor(baseMs * 0.15 * Math.random())
  return now + baseMs + jitter
}

export function isDashboardClusterCacheEnabled(): boolean {
  return softTtlMs() > 0
}

export type DashboardClusterCacheSource =
  | "fresh_hit"
  | "stale_hit"
  | "miss"
  | "refresh_started"
  | "refresh_skipped"
  | "degraded"

export type DashboardClusterRefreshMode = "foreground" | "background" | "skipped"

/** @deprecated use DashboardClusterCacheSource */
export type DashboardClusterLegacySource = "cache_hit" | "cache_miss" | "cache_coalesce"

export type DashboardClusterCacheResult<T> = {
  value: T
  cacheSource: DashboardClusterCacheSource
  cache_age_ms: number
  refresh_mode: DashboardClusterRefreshMode
  cache_enabled: boolean
  /** @deprecated use cacheSource */
  source: DashboardClusterLegacySource
}

function clonePayload<T>(value: T): T {
  return structuredClone(value)
}

function legacySourceFrom(cacheSource: DashboardClusterCacheSource): DashboardClusterLegacySource {
  if (
    cacheSource === "fresh_hit" ||
    cacheSource === "stale_hit" ||
    cacheSource === "refresh_started" ||
    cacheSource === "refresh_skipped"
  ) {
    return "cache_hit"
  }
  if (cacheSource === "degraded") return "cache_miss"
  return "cache_miss"
}

function cacheAgeMs(entry: ClusterCacheEntry, now: number): number {
  return Math.max(0, now - entry.cachedAt)
}

function getClusterEntry(key: string): ClusterCacheEntry | undefined {
  return clusterStore.get(key)
}

function isFresh(entry: ClusterCacheEntry, now: number): boolean {
  return now < entry.softExpiresAt
}

function isStaleServable(entry: ClusterCacheEntry, now: number): boolean {
  return now >= entry.softExpiresAt && now < entry.hardExpiresAt
}

function pruneClusterStore(): void {
  if (clusterStore.size <= 200) return
  const now = Date.now()
  for (const [k, v] of clusterStore) {
    if (v.hardExpiresAt <= now) clusterStore.delete(k)
  }
}

function storeClusterEntry(key: string, payload: unknown, now: number): void {
  const softMs = softTtlMs()
  if (softMs <= 0) return
  const hardMs = hardTtlMs()
  clusterStore.set(key, {
    payload,
    cachedAt: now,
    softExpiresAt: jitteredSoftExpiryMs(now, softMs),
    hardExpiresAt: now + (hardMs > 0 ? hardMs : softMs * 4),
  })
  pruneClusterStore()
}

function wrapClusterResult<T>(
  value: T,
  cacheSource: DashboardClusterCacheSource,
  cache_age_ms: number,
  refresh_mode: DashboardClusterRefreshMode,
  cache_enabled: boolean
): DashboardClusterCacheResult<T> {
  return {
    value: clonePayload(value),
    cacheSource,
    cache_age_ms,
    refresh_mode,
    cache_enabled,
    source: legacySourceFrom(cacheSource),
  }
}

function staleCacheSource(refreshStarted: boolean, refreshAlreadyInFlight: boolean): DashboardClusterCacheSource {
  if (refreshStarted) return "refresh_started"
  if (refreshAlreadyInFlight) return "refresh_skipped"
  return "stale_hit"
}

function serveStaleEntry<T>(
  entry: ClusterCacheEntry,
  now: number,
  refreshStarted: boolean,
  refreshAlreadyInFlight = false
): DashboardClusterCacheResult<T> {
  const cacheSource = staleCacheSource(refreshStarted, refreshAlreadyInFlight)
  return wrapClusterResult(
    entry.payload as T,
    cacheSource,
    cacheAgeMs(entry, now),
    refreshStarted ? "background" : "skipped",
    isDashboardClusterCacheEnabled()
  )
}

async function computeWithTimeout<T>(
  compute: () => Promise<T>
): Promise<T | null> {
  const timeoutMs = computeTimeoutMs()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      compute(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function scheduleClusterRefresh<T>(
  key: string,
  compute: () => Promise<T>,
  shouldStore: (value: T) => boolean,
  scheduleBackground?: (promise: Promise<void>) => void
): boolean {
  if (!scheduleBackground || clusterRefreshInFlight.has(key)) return false

  const refreshPromise = new Promise<void>((resolve, reject) => {
    setImmediate(() => {
      ;(async () => {
        try {
          const built = await computeWithTimeout(compute)
          if (built != null && shouldStore(built)) {
            storeClusterEntry(key, built, Date.now())
          }
        } catch (err) {
          console.warn(
            "[dashboard-cluster-cache] background refresh failed:",
            err instanceof Error ? err.message : "refresh_failed"
          )
          reject(err)
        } finally {
          clusterRefreshInFlight.delete(key)
          resolve()
        }
      })()
    })
  })

  clusterRefreshInFlight.set(key, refreshPromise)
  scheduleBackground(refreshPromise)
  return true
}

export async function loadOrComputeDashboardClusterCache<T>(
  key: string,
  compute: () => Promise<T>,
  options?: {
    shouldStore?: (value: T) => boolean
    createDegraded?: () => T
    scheduleBackground?: (promise: Promise<void>) => void
  }
): Promise<DashboardClusterCacheResult<T>> {
  const cacheEnabled = isDashboardClusterCacheEnabled()
  const softMs = softTtlMs()
  const shouldStore = options?.shouldStore ?? (() => true)
  const createDegraded = options?.createDegraded ?? (() => ({}) as T)
  const now = Date.now()
  const entry = softMs > 0 ? getClusterEntry(key) : undefined

  if (softMs > 0 && entry && isFresh(entry, now)) {
    return wrapClusterResult(
      entry.payload as T,
      "fresh_hit",
      cacheAgeMs(entry, now),
      "skipped",
      cacheEnabled
    )
  }

  if (softMs > 0 && entry && isStaleServable(entry, now)) {
    const refreshInFlight = clusterRefreshInFlight.has(key)
    const refreshStarted = scheduleClusterRefresh(
      key,
      compute,
      shouldStore,
      options?.scheduleBackground
    )
    return serveStaleEntry<T>(entry, now, refreshStarted, refreshInFlight && !refreshStarted)
  }

  const pending = clusterInflight.get(key)
  if (pending) {
    if (entry && isStaleServable(entry, now)) {
      const refreshInFlight = clusterRefreshInFlight.has(key)
      const refreshStarted =
        !refreshInFlight &&
        scheduleClusterRefresh(key, compute, shouldStore, options?.scheduleBackground)
      return serveStaleEntry<T>(entry, now, refreshStarted, refreshInFlight)
    }

    if (entry && now < entry.hardExpiresAt) {
      return serveStaleEntry<T>(entry, now, false, clusterRefreshInFlight.has(key))
    }

    return wrapClusterResult(
      createDegraded(),
      "degraded",
      entry ? cacheAgeMs(entry, now) : 0,
      "skipped",
      cacheEnabled
    )
  }

  const promise = (async (): Promise<T | null> => {
    const built = await computeWithTimeout(compute)
    if (built != null && softMs > 0 && shouldStore(built)) {
      storeClusterEntry(key, built, Date.now())
    }
    return built
  })().finally(() => {
    clusterInflight.delete(key)
  })

  clusterInflight.set(key, promise)
  const built = await promise

  if (built != null) {
    return wrapClusterResult(built, "miss", 0, "foreground", cacheEnabled)
  }

  if (entry && now < entry.hardExpiresAt) {
    const refreshInFlight = clusterRefreshInFlight.has(key)
    const refreshStarted = scheduleClusterRefresh(
      key,
      compute,
      shouldStore,
      options?.scheduleBackground
    )
    return serveStaleEntry<T>(entry, now, refreshStarted, refreshInFlight && !refreshStarted)
  }

  return wrapClusterResult(createDegraded(), "degraded", 0, "skipped", cacheEnabled)
}

/** Test-only: clear cluster SWR store and inflight maps. */
export function resetDashboardClusterCacheForTests(): void {
  clusterStore.clear()
  clusterInflight.clear()
  clusterRefreshInFlight.clear()
}

/** Test-only: mark cluster entry soft-expired. */
export function expireDashboardClusterCacheSoftForTests(key: string): void {
  const hit = clusterStore.get(key)
  if (hit) {
    hit.softExpiresAt = Date.now() - 1
  }
}

export type DashboardClusterCacheHeaders = {
  cacheSource: DashboardClusterCacheSource
  cacheAgeMs: number
  refreshMode: DashboardClusterRefreshMode
}

export function dashboardClusterCacheResponseHeaders(
  diag: DashboardClusterCacheHeaders
): Record<string, string> {
  return {
    "x-finza-dashboard-cache-source": diag.cacheSource,
    "x-finza-dashboard-cache-age-ms": String(Math.round(diag.cacheAgeMs)),
    "x-finza-dashboard-refresh-mode": diag.refreshMode,
  }
}

// ── Activity sub-cache (unchanged) ──────────────────────────────────────────

export async function loadOrComputeDashboardActivityCache<T>(
  key: string,
  compute: () => Promise<T>
): Promise<{
  value: T
  source: "cache_hit" | "cache_miss" | "cache_coalesce"
  cache_enabled: boolean
}> {
  const ms = activityTtlMs()
  const cacheEnabled = true

  const hit = activityStore.get(key)
  if (hit && Date.now() < hit.expiresAt) {
    return { value: hit.payload as T, source: "cache_hit", cache_enabled: cacheEnabled }
  }
  if (hit) activityStore.delete(key)

  const pending = activityInflight.get(key)
  if (pending) {
    const value = (await pending) as T
    return { value, source: "cache_coalesce", cache_enabled: cacheEnabled }
  }

  const promise = compute()
    .then((value) => {
      activityStore.set(key, { expiresAt: Date.now() + ms, payload: value })
      if (activityStore.size > 200) {
        const t = Date.now()
        for (const [k, v] of activityStore) {
          if (v.expiresAt <= t) activityStore.delete(k)
        }
      }
      return value
    })
    .finally(() => {
      activityInflight.delete(key)
    })

  activityInflight.set(key, promise)
  const value = await promise
  return { value, source: "cache_miss", cache_enabled: cacheEnabled }
}
