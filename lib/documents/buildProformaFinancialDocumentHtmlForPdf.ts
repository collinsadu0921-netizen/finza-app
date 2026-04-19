import {
  generateFinancialDocumentHTML,
  type BusinessInfo,
  type CustomerInfo,
  type DocumentItem,
  type DocumentMeta,
  type DocumentPaymentDetails,
  type DocumentTotals,
} from "@/components/documents/FinancialDocument"
import { getCurrencySymbol } from "@/lib/currency"
import { taxLinesFromEstimateRow } from "@/lib/documents/estimateTaxLinesForDocument"

export type ProformaPdfBusinessRow = {
  name?: string | null
  legal_name?: string | null
  trading_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  logo_url?: string | null
  tax_id?: string | null
  registration_number?: string | null
  default_currency?: string | null
}

export type ProformaPdfCustomerRow = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
  address?: string | null
}

/**
 * Same visual as public proforma PDF — used by token route and authenticated export-pdf.
 */
export function buildProformaFinancialDocumentHtmlForPdf(params: {
  proforma: Record<string, unknown>
  business: ProformaPdfBusinessRow | null | undefined
  customer: ProformaPdfCustomerRow | null | undefined
  items: unknown[]
  /** Merged proforma row + invoice_settings (mergeQuotePdfTerms). */
  payment_terms?: string | null
  footer_message?: string | null
  quote_terms?: string | null
  /** Bank / MoMo — same visibility as invoice PDF when provided. */
  payment_details?: DocumentPaymentDetails | null
}): string {
  const { proforma, business, customer, items, payment_terms, footer_message, quote_terms, payment_details } =
    params
  const p = proforma as Record<string, any>

  const currencyCode = p.currency_code || business?.default_currency
  if (!currencyCode || typeof currencyCode !== "string") {
    throw new Error("Proforma currency is missing")
  }
  const currencySymbol = p.currency_symbol || getCurrencySymbol(currencyCode)

  const businessInfo: BusinessInfo = {
    name: business?.name,
    legal_name: business?.legal_name,
    trading_name: business?.trading_name,
    phone: business?.phone,
    email: business?.email,
    address: business?.address,
    logo_url: business?.logo_url,
    tax_id: business?.tax_id,
    registration_number: business?.registration_number,
  }

  const customerInfo: CustomerInfo = customer
    ? {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        whatsapp_phone: customer.whatsapp_phone,
        address: customer.address,
      }
    : { name: "Customer" }

  const documentItems: DocumentItem[] = (items || []).map((item: any) => {
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

  const totals: DocumentTotals = {
    subtotal: Number(p.subtotal || 0),
    total_tax: Number(p.total_tax || 0),
    total: Number(p.total || 0),
    nhil_amount: Number(p.nhil || 0),
    getfund_amount: Number(p.getfund || 0),
    covid_amount: Number(p.covid || 0),
    vat_amount: Number(p.vat || 0),
  }

  const acceptedNote =
    p.status === "accepted" && p.client_name_signed
      ? `\n\nAccepted by ${p.client_name_signed}${p.signed_at ? ` on ${new Date(p.signed_at).toLocaleDateString("en-GB")}` : ""}.`
      : ""

  const parsedTaxLines = taxLinesFromEstimateRow(p)

  return generateFinancialDocumentHTML({
    documentType: "proforma",
    business: businessInfo,
    customer: customerInfo,
    items: documentItems,
    totals,
    tax_lines: parsedTaxLines.length > 0 ? parsedTaxLines : undefined,
    meta: {
      document_number: p.proforma_number || "PROFORMA",
      issue_date: p.issue_date,
      expiry_date: p.validity_date || null,
      status: p.status || null,
      public_token: p.public_token || null,
    } as DocumentMeta,
    notes: `${p.notes || ""}${acceptedNote}`.trim() || null,
    payment_terms: payment_terms ?? null,
    footer_message: footer_message ?? null,
    quote_terms: quote_terms ?? null,
    payment_details: payment_details ?? null,
    apply_taxes: Boolean(p.apply_taxes),
    currency_code: currencyCode,
    currency_symbol: currencySymbol,
    fx_rate: p.fx_rate ?? null,
    home_currency_code: p.home_currency_code ?? null,
    home_currency_total: p.home_currency_total ?? null,
  })
}
