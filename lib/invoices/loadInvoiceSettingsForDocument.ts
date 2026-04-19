import type { SupabaseClient } from "@supabase/supabase-js"
import type { DocumentPaymentDetails } from "@/components/documents/FinancialDocument"

export type InvoiceSettingsForDocument = {
  payment_details: DocumentPaymentDetails | null
  default_payment_terms: string | null
  default_footer_message: string | null
  /** Shown on quote / proforma PDFs (invoice_settings.quote_terms_and_conditions). */
  quote_terms_and_conditions: string | null
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

/** Quote / proforma PDFs: payment + footer from row with business defaults, plus global quote T&Cs. */
export function mergeQuotePdfTerms(
  settings: InvoiceSettingsForDocument,
  row?: { payment_terms?: string | null; footer_message?: string | null } | null
): {
  payment_terms: string | null
  footer_message: string | null
  quote_terms: string | null
} {
  const { payment_terms, footer_message } = mergeInvoiceTermsFooter(
    row?.payment_terms,
    row?.footer_message,
    settings
  )
  return {
    payment_terms,
    footer_message,
    quote_terms: settings.quote_terms_and_conditions?.trim() || null,
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
      "bank_name, bank_branch, bank_swift, bank_iban, bank_account_name, bank_account_number, momo_provider, momo_name, momo_number, default_payment_terms, default_footer_message, quote_terms_and_conditions"
    )
    .eq("business_id", businessId)
    .maybeSingle()

  if (error) {
    console.error("[loadInvoiceSettingsForDocument] invoice_settings query failed:", businessId, error.message)
  }
  if (error || !data) {
    return {
      payment_details: null,
      default_payment_terms: null,
      default_footer_message: null,
      quote_terms_and_conditions: null,
    }
  }

  const row = data as typeof data & {
    bank_branch?: string | null
    bank_swift?: string | null
    bank_iban?: string | null
  }

  const payment_details: DocumentPaymentDetails = {
    bank_name: row.bank_name,
    bank_branch: row.bank_branch ?? null,
    bank_swift: row.bank_swift ?? null,
    bank_iban: row.bank_iban ?? null,
    bank_account_name: row.bank_account_name,
    bank_account_number: row.bank_account_number,
    momo_provider: row.momo_provider,
    momo_name: row.momo_name,
    momo_number: row.momo_number,
  }

  return {
    payment_details,
    default_payment_terms: row.default_payment_terms ?? null,
    default_footer_message: row.default_footer_message ?? null,
    quote_terms_and_conditions: row.quote_terms_and_conditions ?? null,
  }
}
