import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Read-only balance for public invoice + PDF copy (payments + applied credits).
 */
export async function fetchInvoiceBalanceDuePublic(
  supabase: SupabaseClient,
  invoiceId: string,
  invoiceTotal: number
): Promise<number> {
  const [{ data: pays }, { data: credits }] = await Promise.all([
    supabase.from("payments").select("amount").eq("invoice_id", invoiceId).is("deleted_at", null),
    supabase
      .from("credit_notes")
      .select("total")
      .eq("invoice_id", invoiceId)
      .eq("status", "applied")
      .is("deleted_at", null),
  ])

  const totalPaid = pays?.reduce((s, p) => s + Number((p as { amount?: unknown }).amount ?? 0), 0) ?? 0
  const totalCredits =
    credits?.reduce((s, c) => s + Number((c as { total?: unknown }).total ?? 0), 0) ?? 0

  return Math.max(0, Number(invoiceTotal) - totalPaid - totalCredits)
}
