/**
 * Cash collected for the deprecated sales-summary formula.
 * Credits, invoice totals, invoice status, paid_at, and journals are not cash.
 */

export type SalesSummaryPaymentRow = {
  amount: number | null
  date: string
  deleted_at?: string | null
  invoice_id: string
  /** Present on the row. Never added to paidRevenue. */
  wht_amount?: number | null
}

export type SalesSummaryInvoiceRef = {
  id: string
  business_id: string
  deleted_at?: string | null
  status: string | null
}

export type SalesSummaryPaidRevenueInput = {
  businessId: string
  startDate?: string | null
  endDate?: string | null
  payments: SalesSummaryPaymentRow[]
  invoices: SalesSummaryInvoiceRef[]
}

function dateOnly(value: string): string {
  return String(value).slice(0, 10)
}

function inPeriod(date: string, startDate?: string | null, endDate?: string | null): boolean {
  const day = dateOnly(date)
  if (startDate && day < dateOnly(startDate)) return false
  if (endDate && day > dateOnly(endDate)) return false
  return true
}

export function salesSummaryPaidRevenue(input: SalesSummaryPaidRevenueInput): number {
  const eligibleInvoiceIds = new Set(
    input.invoices
      .filter((invoice) => {
        if (invoice.business_id !== input.businessId) return false
        if (invoice.deleted_at) return false
        return String(invoice.status || "").toLowerCase() !== "draft"
      })
      .map((invoice) => invoice.id)
  )

  const total = input.payments.reduce((sum, payment) => {
    if (payment.deleted_at) return sum
    if (!eligibleInvoiceIds.has(payment.invoice_id)) return sum
    if (!inPeriod(payment.date, input.startDate, input.endDate)) return sum
    const amount = Number(payment.amount)
    if (!Number.isFinite(amount)) return sum
    return sum + amount
  }, 0)

  return Math.round(total * 100) / 100
}
