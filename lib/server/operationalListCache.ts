/**
 * Short-TTL cache + singleflight for operational list routes (510).
 * Enable on staging preview: FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC=30
 */

type CacheEntry = { expiresAt: number; payload: unknown }

const store = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()

function ttlMs(): number {
  const sec = Number(process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC ?? 0)
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.min(Math.max(sec, 15), 30) * 1000
}

export function isOperationalListCacheEnabled(): boolean {
  return ttlMs() > 0
}

export type OperationalListCacheResult<T> = {
  value: T
  source: "cache_hit" | "cache_miss" | "cache_coalesce"
  cache_enabled: boolean
}

/** Do not cache payloads that represent errors or explicit non-cacheable states. */
export function shouldCacheOperationalListPayload(payload: unknown): boolean {
  if (payload == null || typeof payload !== "object") return true
  if ("error" in payload && (payload as { error?: unknown }).error) return false
  if ("cacheable" in payload && (payload as { cacheable?: boolean }).cacheable === false) {
    return false
  }
  return true
}

export async function loadOrComputeOperationalListCache<T>(
  key: string,
  compute: () => Promise<T>,
  options?: { shouldStore?: (value: T) => boolean }
): Promise<OperationalListCacheResult<T>> {
  const cacheEnabled = isOperationalListCacheEnabled()
  const ms = ttlMs()
  const shouldStore = options?.shouldStore ?? shouldCacheOperationalListPayload

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
      if (ms > 0 && shouldStore(value)) {
        store.set(key, { expiresAt: Date.now() + ms, payload: value })
        if (store.size > 300) {
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
