/**
 * Disposal gain/loss preview helpers.
 */

export function carryingValue(
  purchaseAmount: number,
  salvageValue: number,
  postedAccumulatedDepreciation: number
): number {
  const cost = Number(purchaseAmount)
  const accum = Number(postedAccumulatedDepreciation)
  const salvage = Number(salvageValue || 0)
  return Math.round(Math.max(salvage, cost - accum) * 100) / 100
}

export function disposalGainLoss(proceeds: number, carrying: number): number {
  return Math.round((Number(proceeds) - Number(carrying)) * 100) / 100
}

export type DisposalType = "cash" | "credit" | "scrap"

export function normalizeDisposalProceeds(type: DisposalType, proceeds: number | null | undefined): number {
  if (type === "scrap") return 0
  return Math.round(Number(proceeds ?? 0) * 100) / 100
}

export function validateDisposalInput(input: {
  disposal_date: string
  disposal_type: DisposalType
  proceeds: number
  payment_account_id?: string | null
}): string | null {
  if (!input.disposal_date) return "Disposal date is required"
  if (!["cash", "credit", "scrap"].includes(input.disposal_type)) return "Invalid disposal type"
  if (input.proceeds < 0) return "Proceeds cannot be negative"
  if (input.disposal_type === "scrap" && input.proceeds !== 0) return "Scrap disposal requires zero proceeds"
  if (input.disposal_type === "cash" && !input.payment_account_id) return "Payment account is required for cash disposal"
  return null
}
