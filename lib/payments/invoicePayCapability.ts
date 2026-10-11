import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Public invoice payment capability.
 * An invoice UUID is not authorization. The caller must present the invoice id
 * and the matching invoices.public_token. Business id is taken from that row.
 */
export type InvoicePayInvoice = {
  id: string
  invoice_number: string
  total: number
  business_id: string
  status: string
  public_token: string
}

export type InvoicePayCapabilityResult =
  | { ok: true; invoice: InvoicePayInvoice }
  | { ok: false; error: string; statusCode: number }

export function isInvoiceHiddenFromPublicPay(status: string | null | undefined): boolean {
  const s = String(status || "")
    .trim()
    .toLowerCase()
  return s === "draft" || s === "cancelled" || s === "void"
}

export async function assertInvoicePayCapability(
  supabase: SupabaseClient,
  invoiceId: string,
  publicToken: string
): Promise<InvoicePayCapabilityResult> {
  const id = invoiceId?.trim()
  const token = publicToken?.trim()
  if (!id || !token) {
    return { ok: false, error: "invoice_id and public_token are required", statusCode: 400 }
  }

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, invoice_number, total, business_id, status, public_token")
    .eq("id", id)
    .eq("public_token", token)
    .is("deleted_at", null)
    .maybeSingle()

  if (error || !invoice?.business_id || !invoice.public_token) {
    return { ok: false, error: "Invoice not found", statusCode: 404 }
  }

  if (isInvoiceHiddenFromPublicPay(invoice.status)) {
    return { ok: false, error: "Invoice not available for payment", statusCode: 404 }
  }

  return { ok: true, invoice: invoice as InvoicePayInvoice }
}
