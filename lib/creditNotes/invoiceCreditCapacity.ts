/**
 * Invoice credit note capacity — only applied credit notes count toward the cap.
 * Payments do not reduce how much can be credited (accounting rule).
 */

export type InvoiceCreditCapacity = {
  invoiceId: string
  invoiceGross: number
  appliedCreditsTotal: number
  remainingCreditable: number
  isFullyCredited: boolean
}

const round2 = (value: number): number => Math.round((value || 0) * 100) / 100

export function computeInvoiceGross(invoice: {
  total?: unknown
  subtotal?: unknown
  total_tax?: unknown
}): number {
  const rawTotal = Number(invoice.total || 0)
  const derivedGross = round2(Number(invoice.subtotal || 0) + Number(invoice.total_tax || 0))
  return rawTotal > 0 ? round2(rawTotal) : derivedGross
}

export function computeInvoiceCreditCapacity(
  invoiceId: string,
  invoice: { total?: unknown; subtotal?: unknown; total_tax?: unknown },
  appliedCreditTotals: number[]
): InvoiceCreditCapacity {
  const invoiceGross = computeInvoiceGross(invoice)
  const appliedCreditsTotal = round2(
    appliedCreditTotals.reduce((sum, t) => sum + (Number.isFinite(Number(t)) ? Number(t) : 0), 0)
  )
  const remainingCreditable = round2(Math.max(0, invoiceGross - appliedCreditsTotal))
  const isFullyCredited = remainingCreditable <= 0.01

  return {
    invoiceId,
    invoiceGross,
    appliedCreditsTotal,
    remainingCreditable,
    isFullyCredited,
  }
}

export function formatCreditCapacityExceededError(
  creditAmount: number,
  remainingCreditable: number,
  currencySymbol = "₵"
): string {
  return (
    `Credit note amount (${currencySymbol}${round2(creditAmount).toFixed(2)}) exceeds remaining creditable amount. ` +
    `Remaining creditable amount: ${currencySymbol}${round2(remainingCreditable).toFixed(2)}.`
  )
}

export function formatFullyCreditedError(currencySymbol = "₵"): string {
  return `This invoice has already been fully credited. Remaining creditable amount: ${currencySymbol}0.00.`
}
