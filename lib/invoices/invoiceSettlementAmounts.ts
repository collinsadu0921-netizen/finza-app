/**
 * Loads payment and applied-credit sums for settlement presentation.
 * Does not write payments, credit notes, or invoice status.
 */

import { sumRecordedPaymentAmounts } from "@/lib/invoices/invoiceSettlementPresentation"

type Row = Record<string, unknown>

type QueryResult = { data: Row[] | null; error: { message?: string } | null }

export type SettlementQueryClient = {
  from: (table: string) => {
    select: (columns: string) => any
  }
}

export type InvoiceSettlementAmountLoad = {
  payments: number | null
  appliedCredits: number | null
  amountsUnavailable: boolean
}

export type InvoiceWithSettlementSums<T> = T & {
  payments_total: number | null
  applied_credits_total: number | null
  settlement_amounts_unavailable: boolean
}

function unavailableLoad(): InvoiceSettlementAmountLoad {
  return { payments: null, appliedCredits: null, amountsUnavailable: true }
}

export async function loadInvoiceSettlementAmounts(
  supabase: SettlementQueryClient,
  invoiceId: string
): Promise<InvoiceSettlementAmountLoad> {
  try {
    const [paymentsResult, creditsResult] = await Promise.all([
      supabase
        .from("payments")
        .select("amount")
        .eq("invoice_id", invoiceId)
        .is("deleted_at", null),
      supabase
        .from("credit_notes")
        .select("total")
        .eq("invoice_id", invoiceId)
        .eq("status", "applied")
        .is("deleted_at", null),
    ])

    const payments = paymentsResult as QueryResult
    const credits = creditsResult as QueryResult
    if (payments.error || credits.error || !payments.data || !credits.data) {
      return unavailableLoad()
    }

    return {
      payments: sumRecordedPaymentAmounts(payments.data.map((row) => Number(row.amount))),
      appliedCredits: sumRecordedPaymentAmounts(credits.data.map((row) => Number(row.total))),
      amountsUnavailable: false,
    }
  } catch {
    return unavailableLoad()
  }
}

export async function attachInvoiceSettlementSums<T extends { id: string }>(
  supabase: SettlementQueryClient,
  invoices: T[],
  businessId: string
): Promise<Array<InvoiceWithSettlementSums<T>>> {
  const markUnavailable = () =>
    invoices.map((invoice) => ({
      ...invoice,
      payments_total: null,
      applied_credits_total: null,
      settlement_amounts_unavailable: true,
    }))

  if (invoices.length === 0) return []

  const ids = invoices.map((invoice) => invoice.id).filter((id) => Boolean(id))
  if (ids.length === 0) return markUnavailable()

  try {
    const [paymentsResult, creditsResult] = await Promise.all([
      supabase
        .from("payments")
        .select("invoice_id, amount")
        .eq("business_id", businessId)
        .in("invoice_id", ids)
        .is("deleted_at", null),
      supabase
        .from("credit_notes")
        .select("invoice_id, total")
        .eq("business_id", businessId)
        .in("invoice_id", ids)
        .eq("status", "applied")
        .is("deleted_at", null),
    ])

    const payments = paymentsResult as QueryResult
    const credits = creditsResult as QueryResult
    if (payments.error || credits.error || !payments.data || !credits.data) {
      return markUnavailable()
    }

    const paymentsByInvoice = new Map<string, number[]>()
    for (const row of payments.data) {
      const invoiceId = String(row.invoice_id || "")
      const amounts = paymentsByInvoice.get(invoiceId) ?? []
      amounts.push(Number(row.amount))
      paymentsByInvoice.set(invoiceId, amounts)
    }

    const creditsByInvoice = new Map<string, number[]>()
    for (const row of credits.data) {
      const invoiceId = String(row.invoice_id || "")
      const amounts = creditsByInvoice.get(invoiceId) ?? []
      amounts.push(Number(row.total))
      creditsByInvoice.set(invoiceId, amounts)
    }

    return invoices.map((invoice) => ({
      ...invoice,
      payments_total: sumRecordedPaymentAmounts(paymentsByInvoice.get(invoice.id) ?? []),
      applied_credits_total: sumRecordedPaymentAmounts(creditsByInvoice.get(invoice.id) ?? []),
      settlement_amounts_unavailable: false,
    }))
  } catch {
    return markUnavailable()
  }
}
