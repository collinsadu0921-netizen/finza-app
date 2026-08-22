/**
 * In-flight + optional short remount GET coalescing for identical browser requests.
 *
 * Not an authorization cache and not a long-lived data cache:
 * - concurrent identical GETs share one fetch
 * - optional short TTL only absorbs proven remount/effect double-hits
 * - 4xx/5xx and thrown errors never remain in the store
 * - keys include the full URL (and optional tenant suffix), so businesses cannot share
 * - auth-boundary clear increments a generation so pre-clear inflight results cannot
 *   repopulate the store for a later identity
 */

export const SERVICE_LIST_REMOUNT_TTL_MS = 2_500
export const SERVICE_WALKTHROUGH_REMOUNT_TTL_MS = 2_500

export type SharedJsonResult<T = unknown> = {
  ok: boolean
  status: number
  json: T
}

type CacheEntry = {
  inflight?: Promise<SharedJsonResult<unknown>>
  value?: SharedJsonResult<unknown>
  at?: number
}

const store = new Map<string, CacheEntry>()
let fetchImpl: typeof fetch | null = null
let generation = 0

function runtimeFetch(): typeof fetch {
  return fetchImpl ?? fetch
}

export function setSharedJsonGetFetch(next: typeof fetch | null): void {
  fetchImpl = next
}

/**
 * Drop every cached value and inflight handle, and bump the cache generation.
 * In-flight requests started before this call may still resolve to their callers,
 * but they must not write a reusable entry for the new generation.
 */
export function clearSharedJsonGet(): void {
  generation += 1
  store.clear()
}

export function resetSharedJsonGetForTests(): void {
  store.clear()
  generation = 0
  fetchImpl = null
}

function resolveKey(url: string, cacheKey?: string): string {
  return cacheKey || url
}

export function sharedJsonGet<T = unknown>(
  url: string,
  opts?: { ttlMs?: number; fresh?: boolean; cacheKey?: string }
): Promise<SharedJsonResult<T>> {
  const ttlMs = opts?.ttlMs ?? 0
  const key = resolveKey(url, opts?.cacheKey)
  if (opts?.fresh) {
    store.delete(key)
  }
  const now = Date.now()
  const hit = store.get(key)
  if (hit?.value && hit.at != null && ttlMs > 0 && now - hit.at < ttlMs && hit.value.ok) {
    return Promise.resolve(hit.value as SharedJsonResult<T>)
  }
  if (hit?.inflight) {
    return hit.inflight as Promise<SharedJsonResult<T>>
  }

  const startedGeneration = generation
  const inflight = Promise.resolve()
    .then(() => runtimeFetch()(url, { cache: "no-store", credentials: "same-origin" }))
    .then(async (res) => {
      const json = (await res.json().catch(() => ({}))) as T
      const result: SharedJsonResult<T> = { ok: res.ok, status: res.status, json }
      if (startedGeneration !== generation) {
        return result
      }
      if (res.ok && ttlMs > 0) {
        store.set(key, { value: result, at: Date.now() })
      } else {
        store.delete(key)
      }
      return result
    })
    .catch((err) => {
      if (startedGeneration === generation) {
        store.delete(key)
      }
      throw err
    })

  store.set(key, { inflight, at: now })
  return inflight as Promise<SharedJsonResult<T>>
}

export function invalidateSharedJsonGet(
  match: string | ((url: string) => boolean)
): void {
  for (const key of [...store.keys()]) {
    const hit = typeof match === "string" ? key.includes(match) : match(key)
    if (hit) store.delete(key)
  }
}

export function invalidateSharedJsonGetBusiness(businessId: string): void {
  const id = businessId.trim()
  if (!id) return
  invalidateSharedJsonGet(id)
}
