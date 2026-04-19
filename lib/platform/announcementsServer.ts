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

export function isAnnouncementActiveForDisplay(row: PlatformAnnouncementRow, at = nowMs()): boolean {
  if (row.status !== "active") return false
  const start = parseIsoMs(row.start_at)
  const end = parseIsoMs(row.end_at)
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
