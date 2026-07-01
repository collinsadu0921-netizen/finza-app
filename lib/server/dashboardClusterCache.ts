/**
 * In-process cache + singleflight for dashboard timeline/activity (staging/load-test).
 * Enable: FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC=30 on preview/staging.
 *
 * Per-instance only — coalesces concurrent requests on the same key within one
 * serverless instance. Pair with DB summary tables for cross-instance stampede control.
 */

type CacheEntry = { expiresAt: number; payload: unknown }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

/** Fixed TTL for activity payload cache (always on). */
export const DASHBOARD_ACTIVITY_CACHE_TTL_MS = 30_000

function ttlMs(): number {
  const sec = Number(process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC ?? 0)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(sec, 120) * 1000
}

function activityTtlMs(): number {
  const envSec = Number(process.env.FINZA_DASHBOARD_ACTIVITY_CACHE_TTL_SEC ?? 0)
  if (Number.isFinite(envSec) && envSec > 0) {
    return Math.min(envSec, 120) * 1000
  }
  return DASHBOARD_ACTIVITY_CACHE_TTL_MS
}

export function isDashboardClusterCacheEnabled(): boolean {
  return ttlMs() > 0
}

export type DashboardClusterCacheResult<T> = {
  value: T
  source: "cache_hit" | "cache_miss" | "cache_coalesce"
  cache_enabled: boolean
}

export async function loadOrComputeDashboardClusterCache<T>(
  key: string,
  compute: () => Promise<T>
): Promise<DashboardClusterCacheResult<T>> {
  const cacheEnabled = isDashboardClusterCacheEnabled()
  const ms = ttlMs()

  if (ms > 0) {
    const hit = store.get(key)
    if (hit && Date.now() < hit.expiresAt) {
      return { value: hit.payload as T, source: "cache_hit", cache_enabled: cacheEnabled }
    }
    if (hit) store.delete(key)
  }

  const pending = inflight.get(key)
  if (pending) {
    const value = (await pending) as T
    return { value, source: "cache_coalesce", cache_enabled: cacheEnabled }
  }

  const promise = compute()
    .then((value) => {
      if (ms > 0) {
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
  return { value, source: "cache_miss", cache_enabled: cacheEnabled }
}

const activityStore = new Map<string, CacheEntry>()
const activityInflight = new Map<string, Promise<unknown>>()

/** Activity feed cache — always 30s (override via FINZA_DASHBOARD_ACTIVITY_CACHE_TTL_SEC). */
export async function loadOrComputeDashboardActivityCache<T>(
  key: string,
  compute: () => Promise<T>
): Promise<DashboardClusterCacheResult<T>> {
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
        const now = Date.now()
        for (const [k, v] of activityStore) {
          if (v.expiresAt <= now) activityStore.delete(k)
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
