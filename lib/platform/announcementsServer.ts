import type { PlatformAnnouncementRow } from "@/lib/platform/announcementsTypes"
import {
  announcementMatchesAudience,
  workspaceSurfaceFromPathname,
} from "@/lib/platform/announcementAudience"

function nowMs(): number {
  return Date.now()
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * If end is on/before start, the row would only be "active" for an instant (or never).
 * Treat that as a data-entry mistake: ignore the upper bound so the banner still shows after start.
 */
function effectiveEndMsForDisplay(start: number | null, end: number | null): number | null {
  if (end === null) return null
  if (start !== null && end <= start) return null
  return end
}

export function isAnnouncementActiveForDisplay(row: PlatformAnnouncementRow, at = nowMs()): boolean {
  if (row.status !== "active") return false
  const start = parseIsoMs(row.start_at)
  const endRaw = parseIsoMs(row.end_at)
  const end = effectiveEndMsForDisplay(start, endRaw)
  if (start !== null && at < start) return false
  if (end !== null && at > end) return false
  return true
}

export function filterAnnouncementsForTenantContext(
  rows: PlatformAnnouncementRow[],
  opts: {
    pathname: string | null | undefined
    businessIndustry: string | null | undefined
    dismissedIds: Set<string>
  }
): PlatformAnnouncementRow[] {
  const surface = workspaceSurfaceFromPathname(opts.pathname)
  const at = nowMs()
  return rows.filter((row) => {
    if (!isAnnouncementActiveForDisplay(row, at)) return false
    if (!announcementMatchesAudience(row.audience_scope, surface, opts.businessIndustry)) return false
    if (row.dismissible && opts.dismissedIds.has(row.id)) return false
    return true
  })
}
