import type { PlatformAnnouncementRow } from "@/lib/platform/announcementsTypes"

/** Short TTL for display-only announcement payloads (milliseconds). */
export const ANNOUNCEMENTS_ACTIVE_CACHE_TTL_MS = 60_000

export type AnnouncementsCacheKey = string

export type AnnouncementsCacheEntry = {
  rows: PlatformAnnouncementRow[]
  fetchedAt: number
}

export type AnnouncementsFetchKeyInput = {
  pathname: string
  businessIndustry: string
  /** Session-scoped user id when known — prevents cross-user cache leakage. */
  sessionScope: string
}

export function announcementsFetchCacheKey(input: AnnouncementsFetchKeyInput): AnnouncementsCacheKey {
  return [input.sessionScope, input.pathname, input.businessIndustry].join("|")
}

export function readFreshAnnouncementsCache(
  cache: Map<AnnouncementsCacheKey, AnnouncementsCacheEntry>,
  key: AnnouncementsCacheKey,
  now = Date.now()
): PlatformAnnouncementRow[] | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (now - hit.fetchedAt > ANNOUNCEMENTS_ACTIVE_CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.rows
}

export function writeAnnouncementsCache(
  cache: Map<AnnouncementsCacheKey, AnnouncementsCacheEntry>,
  key: AnnouncementsCacheKey,
  rows: PlatformAnnouncementRow[],
  now = Date.now()
): void {
  cache.set(key, { rows, fetchedAt: now })
}

export function removeAnnouncementFromCacheEntries(
  cache: Map<AnnouncementsCacheKey, AnnouncementsCacheEntry>,
  announcementId: string
): void {
  for (const [key, entry] of cache.entries()) {
    const next = entry.rows.filter((r) => r.id !== announcementId)
    if (next.length !== entry.rows.length) {
      cache.set(key, { ...entry, rows: next })
    }
  }
}

export function clearAnnouncementsClientCache(
  cache: Map<AnnouncementsCacheKey, AnnouncementsCacheEntry>
): void {
  cache.clear()
}
