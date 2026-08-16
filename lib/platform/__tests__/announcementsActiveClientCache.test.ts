import {
  ANNOUNCEMENTS_ACTIVE_CACHE_TTL_MS,
  announcementsFetchCacheKey,
  clearAnnouncementsClientCache,
  readFreshAnnouncementsCache,
  removeAnnouncementFromCacheEntries,
  writeAnnouncementsCache,
} from "../announcementsActiveClientCache"
import type { PlatformAnnouncementRow } from "../announcementsTypes"

const row = (id: string): PlatformAnnouncementRow =>
  ({
    id,
    title: "T",
    body: "B",
    placement: "global_banner",
    severity: "info",
    status: "active",
    dismissible: true,
    created_at: "2026-01-01",
  }) as PlatformAnnouncementRow

describe("announcementsActiveClientCache", () => {
  it("builds stable cache keys from session scope, pathname, and industry", () => {
    const key = announcementsFetchCacheKey({
      sessionScope: "user-1",
      pathname: "/service/invoices",
      businessIndustry: "service",
    })
    expect(key).toBe("user-1|/service/invoices|service")
  })

  it("returns fresh cache within TTL and expires after TTL", () => {
    const cache = new Map()
    const key = "k1"
    const now = 1_000_000
    writeAnnouncementsCache(cache, key, [row("a")], now)
    expect(readFreshAnnouncementsCache(cache, key, now + 1000)).toHaveLength(1)
    expect(
      readFreshAnnouncementsCache(
        cache,
        key,
        now + ANNOUNCEMENTS_ACTIVE_CACHE_TTL_MS + 1
      )
    ).toBeNull()
  })

  it("removes dismissed announcement from all cache entries", () => {
    const cache = new Map()
    writeAnnouncementsCache(cache, "k1", [row("a"), row("b")])
    writeAnnouncementsCache(cache, "k2", [row("a")])
    removeAnnouncementFromCacheEntries(cache, "a")
    expect(readFreshAnnouncementsCache(cache, "k1")).toEqual([row("b")])
    expect(readFreshAnnouncementsCache(cache, "k2")).toEqual([])
  })

  it("clears entire cache on logout scope change", () => {
    const cache = new Map()
    writeAnnouncementsCache(cache, "k1", [row("a")])
    clearAnnouncementsClientCache(cache)
    expect(cache.size).toBe(0)
  })
})
