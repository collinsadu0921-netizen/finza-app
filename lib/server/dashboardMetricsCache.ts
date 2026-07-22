/**
 * Optional in-process cache for dashboard metrics (staging/load-test only).
 * Enable: FINZA_DASHBOARD_METRICS_CACHE_TTL_SEC=30 on preview/staging.
 *
 * Serverless note: cache is per function instance — use loadOrComputeDashboardMetrics
 * singleflight so concurrent requests on one instance share one RPC.
 */

type CacheEntry = { expiresAt: number; payload: unknown }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

function ttlMs(): number {
  const sec = Number(process.env.FINZA_DASHBOARD_METRICS_CACHE_TTL_SEC ?? 0)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(sec, 120) * 1000
}

export function dashboardMetricsCacheKey(parts: {
  businessId: string
  start: string
  end: string
  positionAsOf: string
  compareStart: string | null
  compareEnd: string | null
}): string {
  return [
    parts.businessId,
    parts.start,
    parts.end,
    parts.positionAsOf,
    parts.compareStart ?? "",
    parts.compareEnd ?? "",
  ].join("|")
}

export function isDashboardMetricsCacheEnabled(): boolean {
  return ttlMs() > 0
}

/** Drop in-process dashboard metrics entries whose key starts with businessId. */
export function invalidateDashboardMetricsCachePrefix(businessId: string): void {
  const prefix = `${businessId}|`
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}

export function getCachedDashboardMetrics(key: string): unknown | null {
  const ms = ttlMs()
  if (ms <= 0) return null
  const hit = store.get(key)
  if (!hit) return null
  if (Date.now() >= hit.expiresAt) {
    store.delete(key)
    return null
  }
  return hit.payload
}

export function setCachedDashboardMetrics(key: string, payload: unknown): void {
  const ms = ttlMs()
  if (ms <= 0) return
  store.set(key, { expiresAt: Date.now() + ms, payload })
  if (store.size > 200) {
    const now = Date.now()
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k)
    }
  }
}

export type DashboardMetricsCacheResult<T> = {
  value: T
  source: "cache_hit" | "cache_miss" | "cache_coalesce"
  cache_enabled: boolean
}

/**
 * Returns cached payload or runs compute once per key per instance (singleflight).
 */
export async function loadOrComputeDashboardMetrics<T>(
  key: string,
  compute: () => Promise<T>
): Promise<DashboardMetricsCacheResult<T>> {
  const cacheEnabled = isDashboardMetricsCacheEnabled()

  const cached = getCachedDashboardMetrics(key)
  if (cached) {
    return { value: cached as T, source: "cache_hit", cache_enabled: cacheEnabled }
  }

  const pending = inflight.get(key)
  if (pending) {
    const value = (await pending) as T
    return { value, source: "cache_coalesce", cache_enabled: cacheEnabled }
  }

  const promise = compute()
    .then((value) => {
      setCachedDashboardMetrics(key, value)
      return value
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, promise)
  const value = await promise
  return { value, source: "cache_miss", cache_enabled: cacheEnabled }
}
