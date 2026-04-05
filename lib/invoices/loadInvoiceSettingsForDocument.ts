import type { SupabaseClient } from "@supabase/supabase-js"
import type { DocumentPaymentDetails } from "@/components/documents/FinancialDocument"

export type InvoiceSettingsForDocument = {
  payment_details: DocumentPaymentDetails | null
  default_payment_terms: string | null
  default_footer_message: string | null
}

/**
 * Invoice row text falls back to business defaults from invoice_settings (same as create flow).
 */
export function mergeInvoiceTermsFooter(
  invoiceTerms: string | null | undefined,
  invoiceFooter: string | null | undefined,
  defaults: Pick<InvoiceSettingsForDocument, "default_payment_terms" | "default_footer_message">
): { payment_terms: string | null; footer_message: string | null } {
  return {
    payment_terms:
      invoiceTerms?.trim() || defaults.default_payment_terms?.trim() || null,
    footer_message:
      invoiceFooter?.trim() || defaults.default_footer_message?.trim() || null,
  }
}

/**
 * Bank/MoMo plus default payment terms & footer copy for PDFs and public views.
 */
export async function loadInvoiceSettingsForDocument(
  supabase: SupabaseClient,
  businessId: string
): Promise<InvoiceSettingsForDocument> {
  const { data, error } = await supabase
    .from("invoice_settings")
    .select(
      "bank_name, bank_account_name, bank_account_number, momo_provider, momo_name, momo_number, default_payment_terms, default_footer_message"
    )
    .eq("business_id", businessId)
    .maybeSingle()

  if (error || !data) {
    return {
      payment_details: null,
      default_payment_terms: null,
      default_footer_message: null,
    }
  }

  const payment_details: DocumentPaymentDetails = {
    bank_name: data.bank_name,
    bank_account_name: data.bank_account_name,
    bank_account_number: data.bank_account_number,
    momo_provider: data.momo_provider,
    momo_name: data.momo_name,
    momo_number: data.momo_number,
  }

  return {
    payment_details,
    default_payment_terms: data.default_payment_terms ?? null,
    default_footer_message: data.default_footer_message ?? null,
  }
}
