export type ReceiptCurrencyDecision =
  | { action: "ignore" }
  | { action: "home" }
  | { action: "foreign"; currency: string }

/** Decide whether an extracted receipt currency should turn on foreign-currency mode. */
export function decideReceiptCurrency(
  extracted: string | null | undefined,
  home: string | null | undefined
): ReceiptCurrencyDecision {
  const code = extracted?.trim().toUpperCase() || ""
  const homeCode = home?.trim().toUpperCase() || ""
  if (!code || !/^[A-Z]{3}$/.test(code)) return { action: "ignore" }
  if (!homeCode || code === homeCode) return { action: "home" }
  return { action: "foreign", currency: code }
}
