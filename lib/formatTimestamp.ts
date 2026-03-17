/**
 * Reliable timestamp formatter for audit logs and activity feeds.
 *
 * Problems solved:
 * 1. Postgres returns space-separated ISO strings ("2024-01-15 10:30:00+00:00")
 *    — Safari and older browsers can't parse these with new Date(); we normalize
 *    the space to "T" first.
 * 2. "en-GH" locale is not supported in all browsers and can fall back to
 *    unexpected formats. We use "en-GB" which is universally supported and
 *    gives a familiar day-month-year order appropriate for Ghana.
 * 3. Invalid/null values return a safe fallback rather than "Invalid Date".
 */
export function formatTimestamp(s: string | null | undefined): string {
  if (!s) return "—"

  // Normalize Postgres space-separated ISO to standard T-separated
  const normalized = typeof s === "string" ? s.replace(" ", "T") : s
  const d = new Date(normalized)

  if (isNaN(d.getTime())) return "—"

  return d.toLocaleString("en-GB", {
    day:    "2-digit",
    month:  "short",
    year:   "numeric",
    hour:   "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  // Produces: "15 Jan 2024, 10:30"
}

/** Date-only version — "15 Jan 2024" */
export function formatDate(s: string | null | undefined): string {
  if (!s) return "—"
  const normalized = typeof s === "string" ? s.replace(" ", "T") : s
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

/** Relative time — "2 hours ago", "just now", etc. */
export function formatRelative(s: string | null | undefined): string {
  if (!s) return "—"
  const normalized = typeof s === "string" ? s.replace(" ", "T") : s
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return "—"

  const diffMs  = Date.now() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr  = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr  / 24)

  if (diffSec < 60)   return "just now"
  if (diffMin < 60)   return `${diffMin}m ago`
  if (diffHr  < 24)   return `${diffHr}h ago`
  if (diffDay < 7)    return `${diffDay}d ago`
  return formatDate(s)
}
