/**
 * Parse staff lookup input for retail sales (receipt ID, scanned QR, amount, date).
 * Used by /api/sales-history/list.
 *
 * payment_lines is jsonb, but rows are stored as JSON strings (double-encoded).
 * Array containment does not match that shape. Search uses payment_lines_search,
 * a stored text copy that unwraps a jsonb string or renders a jsonb array.
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

/** Characters that split or quote a PostgREST `or()` filter. */
const SALES_HISTORY_OR_UNSAFE = /[%_,"()\\]/g

/**
 * Literal embedded in a quoted ilike value.
 * Strips wildcards and PostgREST `or()` metacharacters so a bad search cannot 500.
 */
export function salesHistorySearchLiteral(raw: string): string {
  return raw.trim().replace(SALES_HISTORY_OR_UNSAFE, "")
}

function ilikeOrPart(column: string, literal: string): string {
  return `${column}.ilike."%${literal}%"`
}

/**
 * Text/ilike OR fragments for non-UUID Sales History search.
 * Never includes `id.ilike` (UUID column). Exact UUID lookup is handled separately via `.eq("id", …)`.
 * Never embeds JSON in the filter. Line references use payment_lines_search.
 */
export function buildSalesHistoryTextSearchOrParts(search: string): string[] {
  const literal = salesHistorySearchLiteral(saleLookupIlikePattern(search))
  if (literal.length === 0) return []
  return [
    ilikeOrPart("momo_transaction_id", literal),
    ilikeOrPart("hubtel_transaction_id", literal),
    ilikeOrPart("description", literal),
    ilikeOrPart("payment_reference", literal),
    ilikeOrPart("payment_lines_search", literal),
  ]
}

/**
 * Text actually stored for sales-history line search.
 * A jsonb string is unwrapped once. An array or object is rendered as JSON text.
 */
export function paymentLinesSearchText(lines: unknown): string {
  if (lines == null) return ""
  if (typeof lines === "string") {
    const trimmed = lines.trim()
    if (!trimmed) return ""
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (typeof parsed === "string") return parsed
      return JSON.stringify(parsed)
    } catch {
      return trimmed
    }
  }
  if (typeof lines === "object") {
    try {
      return JSON.stringify(lines)
    } catch {
      return ""
    }
  }
  return ""
}

export type SalesHistoryReferenceSale = {
  id: string
  businessId: string
  storeId: string | null
  paymentReference: string | null
  paymentLines: unknown
}

/**
 * Same match the list route applies after business and store scope:
 * payment_reference or the plain-text payment lines contain the sanitized search.
 * A null store scope is company-wide inside that business. A set store scope is exact.
 */
export function findSalesByPaymentReference(
  sales: SalesHistoryReferenceSale[],
  query: string,
  scope: { businessId: string; storeId: string | null }
): SalesHistoryReferenceSale[] {
  const literal = salesHistorySearchLiteral(saleLookupIlikePattern(query))
  if (!literal) return []
  const needle = literal.toLowerCase()
  return sales.filter((sale) => {
    if (sale.businessId !== scope.businessId) return false
    if (scope.storeId && sale.storeId !== scope.storeId) return false
    const reference = (sale.paymentReference || "").toLowerCase()
    const lines = paymentLinesSearchText(sale.paymentLines).toLowerCase()
    return reference.includes(needle) || lines.includes(needle)
  })
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
