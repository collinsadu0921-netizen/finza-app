/**
 * Canonical RPC wrapper: get_ar_balances_by_invoice.
 * Use when periodId exists; avoids client-side grouping of get_general_ledger.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface ArBalanceRow {
  invoice_id: string
  balance: number
}

export interface GetArBalancesByInvoiceParams {
  businessId: string
  periodId: string
  invoiceId?: string | null
  customerId?: string | null
}

/**
 * Calls get_ar_balances_by_invoice(p_business_id, p_period_id, p_invoice_id, p_customer_id).
 * Returns NUMERIC balances (no rounding in SQL); cast to number for JS.
 */
export async function getArBalancesByInvoice(
  supabase: SupabaseClient,
  params: GetArBalancesByInvoiceParams
): Promise<ArBalanceRow[]> {
  const { data, error } = await supabase.rpc("get_ar_balances_by_invoice", {
    p_business_id: params.businessId,
    p_period_id: params.periodId,
    p_invoice_id: params.invoiceId ?? null,
    p_customer_id: params.customerId ?? null,
  })
  if (error) throw error
  const rows = (data as Array<{ invoice_id: string; balance: string }>) ?? []
  return rows.map((r) => ({
    invoice_id: r.invoice_id,
    balance: Number(r.balance),
  }))
}
