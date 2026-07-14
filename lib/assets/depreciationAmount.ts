/**
 * Client-side depreciation amount helpers (straight-line, monthly).
 * Mirrors calculate_monthly_depreciation SQL for UI preview only.
 */

export function calculateMonthlyDepreciation(
  purchaseAmount: number,
  salvageValue: number,
  usefulLifeYears: number
): number {
  if (usefulLifeYears <= 0) return 0
  return Math.round(((purchaseAmount - salvageValue) / (usefulLifeYears * 12)) * 100) / 100
}

export function remainingDepreciableAmount(
  purchaseAmount: number,
  salvageValue: number,
  postedAccumulatedDepreciation: number
): number {
  return Math.max(0, Math.round((purchaseAmount - salvageValue - postedAccumulatedDepreciation) * 100) / 100)
}

export function resolvePostingAmount(
  purchaseAmount: number,
  salvageValue: number,
  usefulLifeYears: number,
  postedAccumulatedDepreciation: number,
  requestedAmount?: number | null
): { amount: number; isAdjusted: boolean; expectedAmount: number } {
  const expectedAmount = calculateMonthlyDepreciation(purchaseAmount, salvageValue, usefulLifeYears)
  const remaining = remainingDepreciableAmount(purchaseAmount, salvageValue, postedAccumulatedDepreciation)

  if (requestedAmount != null && !Number.isNaN(Number(requestedAmount))) {
    const amount = Math.round(Number(requestedAmount) * 100) / 100
    return {
      amount: Math.min(amount, remaining),
      isAdjusted: Math.abs(amount - expectedAmount) > 0.01,
      expectedAmount,
    }
  }

  return {
    amount: Math.min(expectedAmount, remaining),
    isAdjusted: false,
    expectedAmount,
  }
}

/** Normalize to first day of month (matches RPC date_trunc month). */
export function normalizeDepreciationPostingDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00")
  if (Number.isNaN(d.getTime())) return dateStr
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}-01`
}

export type DepreciationPostResult = {
  depreciation_entry_id: string
  journal_entry_id: string
  amount: number
  status: string
  posting_date: string
  depreciation_expense_account_id?: string
  accumulated_depreciation_account_id?: string
  idempotent?: boolean
}

export type DepreciationReverseResult = {
  depreciation_entry_id: string
  reversal_entry_id: string
  journal_entry_id: string
  amount: number
  reversal_date: string
  idempotent?: boolean
}
