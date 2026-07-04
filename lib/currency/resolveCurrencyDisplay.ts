import { DEFAULT_PLATFORM_CURRENCY_CODE, getCurrencySymbol } from "@/lib/currency"

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

    if (ctx.currency_symbol && ctx.currency_symbol.trim() !== "") {
      return ctx.currency_symbol
    }

    if (ctx.currency_code && ctx.currency_code.trim() !== "") {
      return ctx.currency_code
    }
  }

  return getCurrencySymbol(DEFAULT_PLATFORM_CURRENCY_CODE) || DEFAULT_PLATFORM_CURRENCY_CODE
}
