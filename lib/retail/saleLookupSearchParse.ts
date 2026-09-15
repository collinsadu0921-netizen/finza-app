/**
 * Parse staff lookup input for retail sales (receipt ID, scanned QR, amount, date).
 * Used by /api/sales-history/list — no DB migrations; operates on existing columns.
 */

const UUID_STANDARD =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Debounce for ordinary Sales History typing; full UUID scans flush immediately. */
export const SALE_HISTORY_SEARCH_DEBOUNCE_MS = 300

/** Normalize full UUID with or without hyphens; returns lowercase canonical UUID or null. */
export function normalizeSaleUuidFromLookupInput(raw: string): string | null {
  const t = raw.trim()
  if (UUID_STANDARD.test(t)) return t.toLowerCase()
  const compact = t.replace(/-/g, "")
  if (/^[0-9a-f]{32}$/i.test(compact)) {
    return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`.toLowerCase()
  }
  return null
}

/**
 * True when input is a complete sale UUID (hyphenated or compact).
 * Keyboard-wedge QR scans should flush the API search immediately in this case.
 */
export function shouldFlushSaleHistorySearchImmediately(raw: string): boolean {
  return normalizeSaleUuidFromLookupInput(raw) != null
}

/**
 * Partial hyphenated hex that looks like a mid-scan UUID.
 * Must NOT be applied as `id.ilike` — `sales.id` is UUID-typed.
 */
export function isPartialHyphenatedUuidLookup(raw: string): boolean {
  const s = raw.trim().toLowerCase()
  if (normalizeSaleUuidFromLookupInput(s)) return false
  return /^[0-9a-f-]+$/.test(s) && s.includes("-") && s.length >= 8 && s.length < 36
}

/**
 * Text/ilike OR fragments for non-UUID Sales History search.
 * Never includes `id.ilike` (UUID column). Exact UUID lookup is handled separately via `.eq("id", …)`.
 */
export function buildSalesHistoryTextSearchOrParts(search: string): string[] {
  const pat = saleLookupIlikePattern(search)
  if (pat.length === 0) return []
  const safe = pat.replace(/,/g, "")
  const like = `%${safe}%`
  return [
    `momo_transaction_id.ilike.${like}`,
    `hubtel_transaction_id.ilike.${like}`,
    `description.ilike.${like}`,
  ]
}

/** YYYY-MM-DD calendar date (UTC day bounds for DB filter). */
export function parseSaleHistoryDateSearch(raw: string): { start: string; end: string } | null {
  const t = raw.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null
  const start = `${t}T00:00:00.000Z`
  const d = new Date(`${t}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + 1)
  return { start, end: d.toISOString() }
}

/** Strict positive amount when the whole string is numeric (receipt total lookup). */
export function parseSaleAmountSearch(raw: string): number | null {
  const t = raw.trim().replace(/,/g, ".")
  if (!/^\d+(\.\d{1,4})?$/.test(t)) return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export function saleLookupIlikePattern(raw: string): string {
  return raw.trim().replace(/%/g, "").replace(/_/g, "").trim()
}
