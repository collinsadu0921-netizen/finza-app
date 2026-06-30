/**
 * Optional in-process cache for dashboard metrics (staging/load-test only).
 * Enable: FINZA_DASHBOARD_METRICS_CACHE_TTL_SEC=30 on preview/staging.
 * Disabled when unset or 0.
 */

type CacheEntry = { expiresAt: number; payload: unknown }

const store = new Map<string, CacheEntry>()

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

export function isDashboardMetricsCacheEnabled(): boolean {
  return ttlMs() > 0
}
