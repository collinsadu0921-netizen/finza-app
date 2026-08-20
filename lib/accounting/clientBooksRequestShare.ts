/**
 * In-flight + short-lived GET coalescing for Practice Client Books.
 *
 * This is not a financial-report cache and not an authorization cache:
 * - identical concurrent GETs share one fetch
 * - optional short TTL only prevents remount/effect double-hits
 * - 4xx/5xx and thrown errors never remain in the store
 * - keys include the full URL (business_id), so clients cannot share
 */

export const PERIODS_TTL_MS = 12_000
export const READINESS_TTL_MS = 8_000
export const FIRMS_TTL_MS = 60_000
export const REPORT_REMOUNT_TTL_MS = 2_500
export const COA_TTL_MS = 15_000

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
let fetchImpl: typeof fetch = fetch

export function setClientBooksRequestShareFetch(next: typeof fetch | null): void {
  fetchImpl = next ?? fetch
}

export function resetClientBooksRequestShareForTests(): void {
  store.clear()
  fetchImpl = fetch
}

function cacheKey(url: string): string {
  return url
}

export function sharedClientBooksJson<T = unknown>(
  url: string,
  opts?: { ttlMs?: number }
): Promise<SharedJsonResult<T>> {
  const ttlMs = opts?.ttlMs ?? 0
  const key = cacheKey(url)
  const now = Date.now()
  const hit = store.get(key)
  if (hit?.value && hit.at != null && ttlMs > 0 && now - hit.at < ttlMs && hit.value.ok) {
    return Promise.resolve(hit.value as SharedJsonResult<T>)
  }
  if (hit?.inflight) {
    return hit.inflight as Promise<SharedJsonResult<T>>
  }

  const inflight = Promise.resolve()
    .then(() => fetchImpl(url, { cache: "no-store" }))
    .then(async (res) => {
      const json = (await res.json().catch(() => ({}))) as T
      const result: SharedJsonResult<T> = { ok: res.ok, status: res.status, json }
      if (res.ok && ttlMs > 0) {
        store.set(key, { value: result, at: Date.now() })
      } else {
        store.delete(key)
      }
      return result
    })
    .catch((err) => {
      store.delete(key)
      throw err
    })

  store.set(key, { inflight, at: now })
  return inflight as Promise<SharedJsonResult<T>>
}

export function invalidateClientBooksRequests(
  match: string | ((url: string) => boolean)
): void {
  for (const key of [...store.keys()]) {
    const hit = typeof match === "string" ? key.includes(match) : match(key)
    if (hit) store.delete(key)
  }
}

export function invalidateClientBooksBusiness(businessId: string): void {
  const id = businessId.trim()
  if (!id) return
  invalidateClientBooksRequests(id)
}

export function invalidateClientBooksPeriods(businessId?: string): void {
  if (businessId?.trim()) {
    invalidateClientBooksRequests(
      (url) => url.includes("/api/accounting/periods") && url.includes(businessId.trim())
    )
    return
  }
  invalidateClientBooksRequests("/api/accounting/periods")
}

export function invalidateClientBooksFirms(): void {
  invalidateClientBooksRequests("/api/accounting/firm/firms")
}

export function invalidateClientBooksReadiness(businessId?: string): void {
  if (businessId?.trim()) {
    invalidateClientBooksRequests(
      (url) => url.includes("/api/accounting/readiness") && url.includes(businessId.trim())
    )
    return
  }
  invalidateClientBooksRequests("/api/accounting/readiness")
}
