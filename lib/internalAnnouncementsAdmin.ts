/**
 * Internal announcement tooling — NOT a general platform admin role.
 * Allowlist via INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS (comma-separated, case-insensitive).
 */

const CACHE = { parsed: null as Set<string> | null, raw: "" as string }

function parseAllowlist(): Set<string> {
  const raw = process.env.INTERNAL_ANNOUNCEMENT_ADMIN_EMAILS?.trim() ?? ""
  if (CACHE.parsed && CACHE.raw === raw) return CACHE.parsed
  const set = new Set<string>()
  for (const part of raw.split(",")) {
    const e = part.trim().toLowerCase()
    if (e) set.add(e)
  }
  CACHE.parsed = set
  CACHE.raw = raw
  return set
}

export function getInternalAnnouncementAdminAllowlist(): Set<string> {
  return parseAllowlist()
}

export function isInternalAnnouncementAdminEmail(email: string | null | undefined): boolean {
  const e = (email || "").trim().toLowerCase()
  if (!e) return false
  return parseAllowlist().has(e)
}
