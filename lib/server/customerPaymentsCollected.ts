import type { SupabaseClient } from "@supabase/supabase-js"

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Sum operational customer invoice payments in an inclusive date range.
 * Authoritative for dashboard "Cash collected" and Payments page totals.
 */
export async function loadCustomerPaymentsCollectedTotal(
  supabase: SupabaseClient,
  businessId: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  options?: { throwOnError?: boolean; invoiceId?: string | null }
): Promise<number> {
  let query = supabase
    .from("payments")
    .select("amount")
    .eq("business_id", businessId)
    .is("deleted_at", null)

  if (options?.invoiceId) {
    query = query.eq("invoice_id", options.invoiceId)
  }
  if (startDate) {
    query = query.gte("date", startDate)
  }
  if (endDate) {
    query = query.lte("date", endDate)
  }

  const { data, error } = await query

  if (error) {
    if (options?.throwOnError === false) {
      console.warn("[customer-payments-collected] read failed:", error.message)
      return 0
    }
    throw error
  }

  const total = (data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
  return roundMoney(total)
}
