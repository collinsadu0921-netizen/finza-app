import type { SupabaseClient } from "@supabase/supabase-js"
import {
  generateFinancialDocumentHTML,
  type BusinessInfo,
  type CustomerInfo,
  type DocumentItem,
  type DocumentMeta,
  type DocumentTotals,
} from "@/components/documents/FinancialDocument"
import { jsonbToTaxResult } from "@/lib/taxEngine/helpers"
import {
  loadInvoiceSettingsForDocument,
  mergeInvoiceTermsFooter,
} from "@/lib/invoices/loadInvoiceSettingsForDocument"

export type InvoicePreviewLoadResult =
  | { ok: true; html: string; invoiceNumber: string | null; invoiceId: string }
  | { ok: false; status: number; error: string }

const INVOICE_PREVIEW_SELECT = `
        *,
        customers (
          id,
          name,
          email,
          phone,
          whatsapp_phone,
          address
        ),
        businesses (
          id,
          name,
          legal_name,
          trading_name,
          phone,
          email,
          address,
          logo_url,
          tax_id,
          registration_number,
          address_country
        ),
        invoice_items (
          id,
          description,
          qty,
          unit_price,
          discount_amount,
          line_subtotal
        )
      `

/**
 * Builds invoice PDF/preview HTML from an invoice row that already includes
 * `customers`, `businesses`, and `invoice_items` (same shape as preview queries).
 */
async function buildInvoicePreviewHtmlFromLoadedInvoice(
  supabase: SupabaseClient,
  inv: Record<string, any>
): Promise<InvoicePreviewLoadResult> {
  const business: BusinessInfo = {
    name: inv.businesses?.name,
    legal_name: inv.businesses?.legal_name,
    trading_name: inv.businesses?.trading_name,
    phone: inv.businesses?.phone,
    email: inv.businesses?.email,
    address: inv.businesses?.address,
    logo_url: inv.businesses?.logo_url,
    tax_id: inv.businesses?.tax_id,
    registration_number: inv.businesses?.registration_number,
  }

  const customer: CustomerInfo = {
    id: inv.customers?.id,
    name: inv.customers?.name,
    email: inv.customers?.email,
    phone: inv.customers?.phone,
    whatsapp_phone: inv.customers?.whatsapp_phone,
    address: inv.customers?.address,
  }

  const documentItems: DocumentItem[] = (inv.invoice_items || []).map((item: any) => {
    const qty = Number(item.qty) || 0
    const unitPrice = Number(item.unit_price) || 0
    const discount = Number(item.discount_amount) || 0
    const stored = item.line_subtotal != null ? Number(item.line_subtotal) : undefined
    return {
      id: item.id,
      description: item.description || "Item",
      qty,
      unit_price: unitPrice,
      discount_amount: discount,
      ...(stored !== undefined ? { line_subtotal: stored } : {}),
    }
  })

  const storedTaxResult = inv.tax_lines ? jsonbToTaxResult(inv.tax_lines) : null
  const taxLines = storedTaxResult?.taxLines || []

  const invoiceTotal = Number(inv.total || 0)
  const whtApplicable = Boolean(inv.wht_receivable_applicable)
  const whtRate = Number(inv.wht_receivable_rate || 0)
  const whtAmount = Number(inv.wht_receivable_amount || 0)

  const documentTotals: DocumentTotals = {
    subtotal: Number(inv.subtotal || 0),
    total_tax: Number(inv.total_tax || 0),
    total: invoiceTotal,
    tax_lines: taxLines,
    nhil_amount: Number(inv.nhil || 0),
    getfund_amount: Number(inv.getfund || 0),
    covid_amount: Number(inv.covid || 0),
    vat_amount: Number(inv.vat || 0),
    ...(whtApplicable && whtAmount > 0
      ? {
          wht_applicable: true,
          wht_rate: whtRate,
          wht_amount: whtAmount,
          net_payable: Math.round((invoiceTotal - whtAmount) * 100) / 100,
        }
      : {}),
  }

  const documentMeta: DocumentMeta = {
    document_number: inv.invoice_number || "DRAFT",
    issue_date: inv.issue_date,
    due_date: inv.due_date || null,
    public_token: inv.public_token || null,
  }

  if (!inv.currency_code) {
    return {
      ok: false,
      status: 400,
      error:
        "Invoice currency code is required for PDF generation. This invoice appears to be missing currency information.",
    }
  }

  if (!inv.currency_symbol) {
    return {
      ok: false,
      status: 400,
      error:
        "Invoice currency symbol is required for PDF generation. This invoice appears to be missing currency information.",
    }
  }

  const invSettings = await loadInvoiceSettingsForDocument(supabase, inv.business_id)
  const { payment_terms: termsForDoc, footer_message: footerForDoc } = mergeInvoiceTermsFooter(
    inv.payment_terms,
    inv.footer_message,
    invSettings
  )

  const htmlPreview = generateFinancialDocumentHTML({
    documentType: "invoice",
    business,
    customer,
    items: documentItems,
    totals: documentTotals,
    meta: documentMeta,
    notes: inv.notes || null,
    footer_message: footerForDoc,
    payment_terms: termsForDoc,
    payment_details: invSettings.payment_details,
    apply_taxes: inv.apply_taxes || false,
    currency_symbol: inv.currency_symbol,
    currency_code: inv.currency_code,
    tax_lines: taxLines.length > 0 ? taxLines : undefined,
    business_country: inv.businesses?.address_country || null,
    fx_rate: inv.fx_rate ?? null,
    home_currency_code: inv.home_currency_code ?? null,
    home_currency_total: inv.home_currency_total ?? null,
  })

  return {
    ok: true,
    html: htmlPreview,
    invoiceNumber: inv.invoice_number ?? null,
    invoiceId: inv.id,
  }
}

/**
 * Loads invoice + relations and returns the same HTML as GET /api/invoices/[id]/pdf-preview.
 * Used by pdf-preview and export-pdf routes.
 */
export async function buildInvoicePreviewHtmlForId(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<InvoicePreviewLoadResult> {
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select(INVOICE_PREVIEW_SELECT)
    .eq("id", invoiceId)
    .single()

  if (invoiceError || !invoice) {
    return { ok: false, status: 404, error: "Invoice not found" }
  }

  return buildInvoicePreviewHtmlFromLoadedInvoice(supabase, invoice as Record<string, any>)
}

/**
 * Same HTML pipeline as authenticated export-pdf, resolved by `invoices.public_token`.
 * Used by GET /api/invoices/public/[token]/pdf (service role / admin client).
 */
export async function buildInvoicePreviewHtmlForPublicToken(
  supabase: SupabaseClient,
  rawToken: string
): Promise<InvoicePreviewLoadResult> {
  const token = decodeURIComponent((rawToken || "").trim())
  if (!token) {
    return { ok: false, status: 400, error: "Public token is required" }
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select(INVOICE_PREVIEW_SELECT)
    .eq("public_token", token)
    .is("deleted_at", null)
    .maybeSingle()

  if (invoiceError || !invoice) {
    return { ok: false, status: 404, error: "Invoice not found" }
  }

  if ((invoice as { status?: string }).status === "cancelled") {
    return { ok: false, status: 404, error: "Invoice not found" }
  }

  return buildInvoicePreviewHtmlFromLoadedInvoice(supabase, invoice as Record<string, any>)
}
