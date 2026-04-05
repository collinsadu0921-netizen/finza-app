import {
  generateFinancialDocumentHTML,
  type BusinessInfo,
  type CustomerInfo,
  type DocumentItem,
  type DocumentMeta,
  type DocumentTotals,
} from "@/components/documents/FinancialDocument"
import { getCurrencySymbol } from "@/lib/currency"
import { estimateLineItemDiscount } from "@/lib/documents/estimateLineItemDiscount"
import { taxLinesFromEstimateRow } from "@/lib/documents/estimateTaxLinesForDocument"

export type EstimatePdfBusinessRow = {
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

export type EstimatePdfCustomerRow = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
  address?: string | null
}

/**
 * Same visual as public quote PDF — used by token route and authenticated export-pdf.
 */
export function buildEstimateFinancialDocumentHtmlForPdf(params: {
  estimate: Record<string, unknown>
  business: EstimatePdfBusinessRow | null | undefined
  customer: EstimatePdfCustomerRow | null | undefined
  items: unknown[]
}): string {
  const { estimate, business, customer, items } = params
  const est = estimate as Record<string, any>

  const currencyCode = est.currency_code || business?.default_currency
  if (!currencyCode || typeof currencyCode !== "string") {
    throw new Error("Quote currency is missing")
  }
  const currencySymbol = est.currency_symbol || getCurrencySymbol(currencyCode)

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
    const qty = Number(item.quantity ?? item.qty ?? 0)
    const unitPrice = Number(item.price ?? item.unit_price ?? 0)
    const lineNet = Number(item.total ?? item.line_total ?? 0)
    return {
      id: item.id,
      description: item.description || "Item",
      qty,
      unit_price: unitPrice,
      discount_amount: estimateLineItemDiscount(item),
      line_subtotal: lineNet,
    }
  })

  const totals: DocumentTotals = {
    subtotal: Number(est.subtotal || 0),
    total_tax: Number(est.total_tax_amount ?? est.total_tax ?? 0),
    total: Number(est.total_amount ?? est.total ?? 0),
    nhil_amount: Number(est.nhil_amount ?? est.nhil ?? 0),
    getfund_amount: Number(est.getfund_amount ?? est.getfund ?? 0),
    covid_amount: Number(est.covid_amount ?? est.covid ?? 0),
    vat_amount: Number(est.vat_amount ?? est.vat ?? 0),
  }

  const acceptedNote =
    est.status === "accepted" && est.client_name_signed
      ? `\n\nAccepted by ${est.client_name_signed}${est.signed_at ? ` on ${new Date(est.signed_at).toLocaleDateString("en-GB")}` : ""}.`
      : ""

  const parsedTaxLines = taxLinesFromEstimateRow(estimate)

  return generateFinancialDocumentHTML({
    documentType: "estimate",
    business: businessInfo,
    customer: customerInfo,
    items: documentItems,
    totals,
    tax_lines: parsedTaxLines.length > 0 ? parsedTaxLines : undefined,
    meta: {
      document_number: est.estimate_number || "QUOTE",
      issue_date: est.issue_date,
      expiry_date: est.expiry_date || est.validity_date || null,
      status: est.status || null,
      public_token: est.public_token || null,
    } as DocumentMeta,
    notes: `${est.notes || ""}${acceptedNote}`.trim() || null,
    apply_taxes: Boolean(est.apply_taxes),
    currency_code: currencyCode,
    currency_symbol: currencySymbol,
    fx_rate: est.fx_rate ?? null,
    home_currency_code: est.home_currency_code ?? null,
    home_currency_total: est.home_currency_total ?? null,
  })
}
