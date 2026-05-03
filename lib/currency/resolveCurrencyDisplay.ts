import { DEFAULT_PLATFORM_CURRENCY_CODE, getCurrencySymbol } from "@/lib/currency"

export type CurrencyContext = {
  currency_symbol?: string | null
  currency_code?: string | null
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
