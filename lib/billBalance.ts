/**
 * Supplier bill: amount owed to the supplier before payments (gross total minus WHT when applicable).
 * WHT is a liability to GRA, not part of supplier cash settlement.
 */
export function billNetPayableToSupplier(
  total: number,
  whtApplicable: boolean | null | undefined,
  whtAmount: number | null | undefined
): number {
  const t = Number(total) || 0
  const wht = whtApplicable && Number(whtAmount) > 0 ? Number(whtAmount) : 0
  return Math.max(0, t - wht)
}

/** Unpaid supplier portion after bill_payments (never negative). */
export function billSupplierBalanceRemaining(
  total: number,
  whtApplicable: boolean | null | undefined,
  whtAmount: number | null | undefined,
  totalPaid: number
): number {
  const net = billNetPayableToSupplier(total, whtApplicable, whtAmount)
  return Math.max(0, net - (Number(totalPaid) || 0))
}
