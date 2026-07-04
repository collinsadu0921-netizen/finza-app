import { DEFAULT_PLATFORM_CURRENCY_CODE, getCurrencySymbol } from "@/lib/currency"
import { normalizeCurrencySymbol } from "./normalizeCurrencySymbol"

export type CurrencyContext = {
  currency_symbol?: string | null
  currency_code?: string | null
  /** Business profile field — same role as currency_code when resolving display. */
  default_currency?: string | null
}

function pickCurrencyCode(ctx: CurrencyContext): string | null {
  const fromDocument = ctx.currency_code?.trim()
  if (fromDocument) return fromDocument
  const fromBusiness = ctx.default_currency?.trim()
  if (fromBusiness) return fromBusiness
  return null
}

/**
 * Canonical ISO currency code resolver. Safe for SSR and loading states.
 * Falls back to platform default (GHS) when no context provides a code.
 */
export function resolveCurrencyCode(
  ...contexts: (CurrencyContext | null | undefined)[]
): string {
  for (const ctx of contexts) {
    if (!ctx) continue
    const code = pickCurrencyCode(ctx)
    if (code) return code
  }

  return DEFAULT_PLATFORM_CURRENCY_CODE
}

/**
 * Canonical currency display resolver. Safe for SSR and loading states.
 * Never throws. Use for all UI currency rendering.
 */
export function resolveCurrencyDisplay(
  ...contexts: (CurrencyContext | null | undefined)[]
): string {
  for (const ctx of contexts) {
    if (!ctx) continue

    const code = pickCurrencyCode(ctx)
    const stored = ctx.currency_symbol?.trim()
    if (code || stored) {
      return normalizeCurrencySymbol(stored, code)
    }
  }

  return normalizeCurrencySymbol(null, DEFAULT_PLATFORM_CURRENCY_CODE)
}

export {
  isCorruptedGhsSymbol,
  MOJIBAKE_GHS_CEDI,
  normalizeCurrencySymbol,
  resolveDocumentCurrencySymbol,
} from "./normalizeCurrencySymbol"
