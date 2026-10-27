import { DEFAULT_PLATFORM_CURRENCY_CODE, getCurrencySymbol } from "@/lib/currency"
import { repairMojibake } from "@/lib/text/repairMojibake"

/** UTF-8 Ghana cedi (U+20B5) misread as Latin-1/Windows-1252. */
export const MOJIBAKE_GHS_CEDI = "\u00E2\u201A\u00B5"

/** UTF-8 Ghana cedi (U+20B5) misread as CP850/DOS Latin-1. */
export const MOJIBAKE_GHS_CEDI_CP850 = "\u00D4\u00E9\u00C1"

const CANONICAL_GHS_CEDI = "\u20B5"

/**
 * True when `symbol` is a known mis-decoding of the Ghana cedi sign.
 * Does not flag valid symbols such as `$`, `€`, or plain `GHS`.
 */
export function isCorruptedGhsSymbol(symbol: string | null | undefined): boolean {
  const s = symbol?.trim()
  if (!s) return false
  if (s === MOJIBAKE_GHS_CEDI || s === MOJIBAKE_GHS_CEDI_CP850) return true
  if (s === "\u00C2\u20B5") return true
  if (/^GH[\u00E2\u201A]?[\u00B5\u20B5]?$/i.test(s)) return true
  if (s.includes("\u00E2") && s.includes("\u00B5") && !s.includes(CANONICAL_GHS_CEDI)) return true
  const repaired = repairMojibake(s)
  if (repaired !== s && repaired.includes(CANONICAL_GHS_CEDI)) return true
  return false
}

/**
 * Repair a stored currency symbol. Never returns mojibake cedi text.
 */
export function normalizeCurrencySymbol(
  symbol: string | null | undefined,
  currencyCode?: string | null
): string {
  const stored = symbol?.trim()
  const code = currencyCode?.trim()

  if (stored && isCorruptedGhsSymbol(stored)) {
    return getCurrencySymbol(code || DEFAULT_PLATFORM_CURRENCY_CODE) || CANONICAL_GHS_CEDI
  }

  if (code) {
    const mapped = getCurrencySymbol(code)
    const upper = code.toUpperCase()
    if (mapped && mapped !== upper) {
      return mapped
    }
  }

  if (stored) {
    return repairMojibake(stored)
  }

  if (code) {
    return getCurrencySymbol(code) || upperOrSelf(code)
  }

  return getCurrencySymbol(DEFAULT_PLATFORM_CURRENCY_CODE) || CANONICAL_GHS_CEDI
}

function upperOrSelf(code: string): string {
  return code.toUpperCase()
}

/**
 * Symbol for PDF/HTML document templates and other server-rendered output.
 * Prefers canonical mapping from ISO code; repairs corrupted stored values.
 */
export function resolveDocumentCurrencySymbol(
  currencyCode: string | null | undefined,
  storedSymbol?: string | null
): string {
  return normalizeCurrencySymbol(storedSymbol, currencyCode)
}
