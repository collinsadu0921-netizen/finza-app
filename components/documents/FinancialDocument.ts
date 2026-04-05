/**
 * Shared Financial Document Component
 * 
 * Renders a unified HTML template for:
 * - Estimates
 * - Orders
 * - Invoices
 * - Credit Notes
 * 
 * All documents use the same layout, branding, fonts, and structure.
 * Only the title text and labels change based on documentType.
 */

import { calculateTaxesFromAmount } from "@/lib/taxEngine"
import type { TaxLine } from "@/lib/taxEngine/types"
import {
  invoiceFooterSingleLine,
  invoiceTermsSingleSentence,
} from "@/lib/invoices/compactInvoiceDocumentText"
import { formatMoneyWithSymbol } from "@/lib/money"

export type DocumentType = "estimate" | "order" | "invoice" | "credit_note"

export interface BusinessInfo {
  name?: string | null
  legal_name?: string | null
  trading_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  website?: string | null
  whatsapp_phone?: string | null
  logo_url?: string | null
  tax_id?: string | null
  registration_number?: string | null
}

export interface CustomerInfo {
  id?: string
  name?: string | null
  email?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
  address?: string | null
}

export interface DocumentItem {
  id?: string
  description: string
  qty?: number
  quantity?: number
  unit_price?: number
  price?: number
  discount_amount?: number
  line_subtotal?: number
  line_total?: number
  total?: number
}

export interface DocumentMeta {
  document_number: string
  issue_date: string
  expiry_date?: string | null
  due_date?: string | null
  status?: string | null
  public_token?: string | null
}

export interface DocumentTotals {
  subtotal: number
  total_tax?: number
  total_tax_amount?: number
  total: number
  total_amount?: number
  // Legacy fields for backward compatibility (deprecated - use tax_lines instead)
  nhil_amount?: number
  getfund_amount?: number
  covid_amount?: number
  vat_amount?: number
  // Generic tax lines (source of truth)
  tax_lines?: TaxLine[]
  // WHT deduction — shown on invoice when customer will withhold tax at source
  wht_applicable?: boolean
  wht_rate?: number      // decimal e.g. 0.05 for 5%
  wht_amount?: number    // amount to be withheld (applied on pre-tax base, not on VAT)
  net_payable?: number   // total - wht_amount (what client actually pays)
}

/** Bank / mobile money lines from invoice_settings (client-facing documents). */
export interface DocumentPaymentDetails {
  bank_name?: string | null
  bank_account_name?: string | null
  bank_account_number?: string | null
  momo_provider?: string | null
  momo_name?: string | null
  momo_number?: string | null
}

export interface FinancialDocumentProps {
  documentType: DocumentType
  business: BusinessInfo
  customer: CustomerInfo
  items: DocumentItem[]
  totals: DocumentTotals
  meta: DocumentMeta
  notes?: string | null
  footer_message?: string | null
  /** Shown in the date/meta grid (invoices). */
  payment_terms?: string | null
  /** Shown after totals when bank account and/or MoMo number exist. */
  payment_details?: DocumentPaymentDetails | null
  apply_taxes?: boolean
  currency_symbol?: string
  currency_code?: string
  // Optional: provide tax_lines directly (preferred) or let component calculate
  tax_lines?: TaxLine[]
  // Optional: business country for tax calculation if tax_lines not provided
  business_country?: string | null
  // FX fields: present when document is issued in a foreign currency
  fx_rate?: number | null
  home_currency_code?: string | null
  home_currency_total?: number | null
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Get document-specific labels and titles
 */
function getDocumentLabels(documentType: DocumentType) {
  switch (documentType) {
    case "estimate":
      return {
        title: "ESTIMATE",
        numberLabel: "Estimate No.",
        dateLabel: "Issue Date",
        secondaryDateLabel: "Expiry Date",
      }
    case "order":
      return {
        title: "ORDER",
        numberLabel: "Order No.",
        dateLabel: "Created Date",
        secondaryDateLabel: null,
      }
    case "invoice":
      return {
        title: "INVOICE",
        numberLabel: "Invoice No.",
        dateLabel: "Invoice Date",
        secondaryDateLabel: "Due Date",
      }
    case "credit_note":
      return {
        title: "CREDIT NOTE",
        numberLabel: "Credit Note No.",
        dateLabel: "Issue Date",
        secondaryDateLabel: null,
      }
  }
}

/**
 * Generate HTML for a financial document
 */
export function generateFinancialDocumentHTML(props: FinancialDocumentProps): string {
  const {
    documentType,
    business,
    customer,
    items,
    totals,
    meta,
    notes,
    footer_message,
    payment_terms,
    payment_details,
    apply_taxes = false,
    currency_symbol,
    currency_code,
    fx_rate,
    home_currency_code,
    home_currency_total,
  } = props

  const isFxDocument = !!(fx_rate && home_currency_code && home_currency_total != null)

  // Require currencyCode for PDF/print templates - no fallbacks allowed
  if (!currency_code) {
    throw new Error(
      `Currency code is required for ${documentType} document generation. ` +
      `Please ensure the document has a valid currency_code before generating PDF/print output.`
    )
  }

  // Require currency_symbol for PDF/print templates - no fallbacks allowed
  if (!currency_symbol) {
    throw new Error(
      `Currency symbol is required for ${documentType} document generation. ` +
      `Please ensure the document has a valid currency_symbol before generating PDF/print output.`
    )
  }

  const labels = getDocumentLabels(documentType)

  // Normalize totals
  const subtotal = totals.subtotal || 0
  const totalTax = totals.total_tax || totals.total_tax_amount || 0
  const total = totals.total || totals.total_amount || 0

  // Tax lines: prefer stored tax_lines (e.g. quotes with apply_taxes false but persisted JSONB),
  // else compute when apply_taxes is true.
  let taxLines: TaxLine[] = []
  let baseAmount = subtotal
  let calculatedTotalTax = totalTax

  const hasStoredTaxLines = !!(props.tax_lines && props.tax_lines.length > 0)

  if (total > 0) {
    if (hasStoredTaxLines) {
      taxLines = props.tax_lines!.filter(
        (line) => Number(line.amount) !== 0 && line.code.toUpperCase() !== "COVID"
      )
      calculatedTotalTax = taxLines.reduce((sum, line) => sum + Number(line.amount), 0)
      baseAmount = total - calculatedTotalTax
    } else if (apply_taxes) {
      try {
        const effectiveDate = meta.issue_date || new Date().toISOString().split("T")[0]
        const country = props.business_country || "GH"

        const taxCalculationResult = calculateTaxesFromAmount(
          total,
          country,
          effectiveDate,
          true // tax-inclusive pricing
        )

        taxLines = taxCalculationResult.taxLines.filter(
          (line) => Number(line.amount) !== 0 && line.code.toUpperCase() !== "COVID"
        )
        baseAmount = taxCalculationResult.subtotal_excl_tax
        calculatedTotalTax = taxCalculationResult.tax_total
      } catch (error) {
        console.error("Error calculating tax breakdown:", error)
        taxLines = []
      }
    }
  }

  const showTaxBreakdown = taxLines.length > 0

  // Format items for display (discount column + correct net line total).
  // Use nullish coalescing so line_subtotal of 0 (fully discounted line) is preserved.
  const formattedItems = items.map((item) => {
    const qty = item.qty || item.quantity || 0
    const unitPrice = item.unit_price || item.price || 0
    const discount = Number(item.discount_amount) || 0
    const computedNet = qty * unitPrice - discount
    const lineTotal =
      item.line_subtotal != null
        ? Number(item.line_subtotal)
        : item.line_total != null
          ? Number(item.line_total)
          : item.total != null
            ? Number(item.total)
            : computedNet
    return {
      description: item.description || "Item",
      qty,
      unitPrice,
      discount: Math.round(discount * 100) / 100,
      lineTotal: Math.round(Number(lineTotal) * 100) / 100,
    }
  })

  const totalDiscountSum = formattedItems.reduce((s, i) => s + i.discount, 0)
  const grossExtended = formattedItems.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  const showDiscountSummary = totalDiscountSum >= 0.005

  // Format dates
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  }

  const businessName = business.trading_name || business.legal_name || business.name || "Business"
  const customerName = customer.name || "Customer"

  const termsTrimmed = payment_terms?.trim() ?? ""
  /** Shown only below How to pay (invoices); not in the date grid above the line table. */
  const paymentTermsBottom =
    documentType === "invoice" && termsTrimmed
      ? invoiceTermsSingleSentence(termsTrimmed)
      : ""
  const hasPaymentTermsBottom = paymentTermsBottom.length > 0

  const rawFooter = footer_message?.trim() ?? ""
  const footerBottomPlain =
    documentType === "invoice" && rawFooter
      ? invoiceFooterSingleLine(rawFooter)
      : rawFooter
  const hasFooterBottom = footerBottomPlain.length > 0

  const pd = payment_details
  const hasBank = Boolean(pd?.bank_account_number && String(pd.bank_account_number).trim())
  const hasMomo = Boolean(pd?.momo_number && String(pd.momo_number).trim())
  const hasPaymentHowTo = documentType === "invoice" && (hasBank || hasMomo)

  // Slate palette (matches create invoice page): slate-50 #f8fafc, slate-100 #f1f5f9, slate-200 #e2e8f0, slate-500 #64748b, slate-600 #475569, slate-700 #334155, slate-900 #0f172a
  // Invoice PDFs omit workflow status (Sent/Paid/etc.); the app UI shows payment state.
  const statusBadgeHtml = ""

  /** Grouped thousands + always 2 decimals; NBSP after symbol for PDF wrap. */
  const fmtMoney = (amount: number) =>
    formatMoneyWithSymbol(amount, currency_symbol, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
      symbolNumberGlue: "\u00A0",
    })

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${labels.title} - ${meta.document_number}</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        margin: 0;
        padding: 24px;
        background: #f8fafc;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .document-container {
        max-width: 896px;
        margin: 0 auto;
        background: #fff;
        padding: 32px;
        border-radius: 8px;
        box-shadow: 0 1px 2px 0 rgba(0,0,0,0.05);
        border: 1px solid #e2e8f0;
      }
      .doc-top-grid { margin-bottom: 24px; }
      .bill-to-block { margin-bottom: 0; }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 32px;
        padding-bottom: 24px;
        border-bottom: 1px solid #e2e8f0;
      }
      .header-brand { flex-shrink: 0; }
      .header-info { flex: 1; min-width: 0; overflow-wrap: break-word; word-break: break-word; }
      .header-doc { text-align: right; flex-shrink: 0; }
      .logo {
        max-width: 200px;
        max-height: 100px;
        object-fit: contain;
      }
      .logo-initials {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 56px;
        height: 56px;
        border-radius: 8px;
        background: #0f172a;
        color: #fff;
        font-size: 24px;
        font-weight: 600;
      }
      .business-name {
        font-size: 24px;
        font-weight: 700;
        color: #0f172a;
        margin: 0 0 8px 0;
      }
      .business-contact {
        font-size: 14px;
        color: #475569;
        line-height: 1.5;
      }
      .business-contact p { margin: 2px 0; }
      .doc-title {
        font-size: 24px;
        font-weight: 700;
        color: #0f172a;
        margin-bottom: 4px;
      }
      .doc-number { font-size: 14px; color: #64748b; }
      .section-label {
        font-size: 12px;
        font-weight: 700;
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
      }
      .bill-to-name { font-size: 16px; font-weight: 600; color: #0f172a; margin: 0 0 4px 0; }
      .bill-to-detail { font-size: 14px; color: #475569; margin: 2px 0; }
      .meta-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px 24px;
        margin-bottom: 0;
        font-size: 14px;
      }
      .meta-label { color: #64748b; }
      .meta-value { color: #0f172a; font-weight: 500; }
      table.line-items {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 24px;
        table-layout: fixed;
      }
      thead {
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }
      table.line-items th {
        text-align: left;
        padding: 10px 12px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
        font-weight: 600;
        vertical-align: bottom;
      }
      table.line-items th.text-right { text-align: right; }
      table.line-items td {
        padding: 10px 12px;
        border-bottom: 1px solid #f1f5f9;
        font-size: 14px;
        color: #334155;
        vertical-align: top;
      }
      /* Do not use max-width:0 here — Chromium PDF breaks table columns badly. */
      table.line-items td.desc-col {
        width: 40%;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      table.line-items td.td-num {
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      td.text-right { text-align: right; }
      .totals-wrap {
        margin-left: auto;
        width: 320px;
        padding-top: 16px;
        border-top: 1px solid #f1f5f9;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 6px 0;
        font-size: 14px;
        color: #475569;
      }
      .total-row-discount span:last-child {
        color: #be123c;
      }
      .total-row span:last-child {
        white-space: nowrap;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .total-row.final {
        margin-top: 8px;
        padding-top: 12px;
        border-top: 1px solid #e2e8f0;
        font-size: 20px;
        font-weight: 700;
        color: #0f172a;
      }
      .footer {
        margin-top: 32px;
        padding-top: 24px;
        border-top: 1px solid #e2e8f0;
        font-size: 14px;
        color: #64748b;
      }
      .footer h4 {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
        margin-bottom: 8px;
      }
      .doc-notes {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid #e2e8f0;
        font-size: 14px;
        color: #64748b;
      }
      .doc-notes h4 {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
        margin: 0 0 6px 0;
      }
      .doc-section-how-to-pay {
        margin-top: 18px;
        padding-top: 14px;
        border-top: 1px solid #e2e8f0;
      }
      .doc-section-how-to-pay h4 {
        margin-top: 0;
      }
      .doc-payment-terms {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid #f1f5f9;
        font-size: 12px;
        color: #475569;
        line-height: 1.45;
      }
      .doc-payment-terms__title {
        margin: 0 0 4px 0;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
      }
      .doc-payment-terms__body {
        margin: 0;
        color: #334155;
      }
      .doc-footer-message {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid #f1f5f9;
        font-size: 11px;
        line-height: 1.4;
        color: #94a3b8;
        text-align: center;
      }
      .payment-cards {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-top: 12px;
      }
      .payment-card {
        flex: 1;
        min-width: 200px;
        max-width: 340px;
        background: #fff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 14px 16px;
      }
      .payment-card__label {
        margin: 0 0 6px 0;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #64748b;
      }
      .payment-card__title {
        margin: 0 0 4px 0;
        font-size: 13px;
        font-weight: 600;
        color: #0f172a;
      }
      .payment-card__sub {
        margin: 0 0 6px 0;
        font-size: 11px;
        color: #475569;
      }
      .payment-card__mono {
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 12px;
        font-weight: 700;
        color: #0f172a;
        letter-spacing: 0.03em;
      }
      @page {
        size: A4 portrait;
      }
      @media print {
        body {
          background: #fff;
          padding: 0;
          font-size: 10pt;
        }
        .document-container {
          box-shadow: none;
          border: 0;
          border-radius: 0;
          padding: 0;
          max-width: none;
        }
        .header {
          break-inside: avoid;
          margin-bottom: 10px;
          padding-bottom: 10px;
          gap: 12px;
        }
        .logo { max-height: 44px; max-width: 120px; }
        .logo-initials { width: 40px; height: 40px; font-size: 16px; border-radius: 6px; }
        .business-name { font-size: 15pt; margin: 0 0 3px 0; }
        .business-contact { font-size: 8.5pt; line-height: 1.35; }
        .business-contact p { margin: 1px 0; }
        .doc-title { font-size: 15pt; margin-bottom: 2px; }
        .doc-number { font-size: 9pt; }
        .doc-top-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(130px, 0.85fr);
          gap: 8px 16px;
          align-items: start;
          margin-bottom: 10px;
        }
        .section-label { font-size: 8pt; margin-bottom: 4px; }
        .bill-to-name { font-size: 10pt; }
        .bill-to-detail { font-size: 8.5pt; margin: 1px 0; }
        .meta-grid {
          gap: 3px 12px;
          font-size: 8.5pt;
          break-inside: avoid;
        }
        table.line-items {
          margin-bottom: 8px;
          break-inside: auto;
        }
        table.line-items th {
          padding: 5px 6px;
          font-size: 7.5pt;
        }
        table.line-items td {
          padding: 5px 6px;
          font-size: 9pt;
        }
        table.line-items tr { break-inside: avoid; }
        .totals-wrap {
          width: 240px;
          padding-top: 8px;
          break-inside: avoid;
        }
        .total-row {
          padding: 2px 0;
          font-size: 9pt;
        }
        .total-row.final {
          font-size: 12pt;
          margin-top: 4px;
          padding-top: 6px;
        }
        .footer {
          margin-top: 10px;
          padding-top: 10px;
          font-size: 8.5pt;
        }
        .footer h4 { font-size: 8pt; margin-bottom: 4px; }
        .doc-notes {
          margin-top: 8px;
          padding-top: 8px;
          font-size: 8pt;
        }
        .doc-notes h4 { font-size: 7.5pt; margin-bottom: 3px; }
        .doc-section-how-to-pay {
          margin-top: 6px;
          padding-top: 6px;
        }
        .doc-payment-terms {
          margin-top: 5px;
          padding-top: 5px;
          font-size: 7.5pt;
        }
        .doc-payment-terms__title { font-size: 7pt; margin-bottom: 2px; }
        .doc-payment-terms__body { font-size: 7.5pt; line-height: 1.35; }
        .doc-footer-message {
          margin-top: 4px;
          padding-top: 4px;
          font-size: 6.5pt;
          line-height: 1.35;
        }
        .payment-cards { gap: 6px; margin-top: 4px; }
        .payment-card {
          min-width: 0;
          max-width: none;
          flex: 1 1 calc(50% - 6px);
          padding: 8px 10px;
          border-radius: 6px;
        }
        .payment-card__label { font-size: 7pt; margin-bottom: 4px; }
        .payment-card__title { font-size: 9pt; }
        .payment-card__sub { font-size: 8pt; margin-bottom: 4px; }
        .payment-card__mono { font-size: 9pt; }
      }
    </style>
  </head>
  <body>
    <div class="document-container">
      <div class="header">
        <div class="header-brand">
          ${business.logo_url
            ? `<img src="${business.logo_url}" alt="Logo" class="logo" />`
            : `<span class="logo-initials">${(businessName || business.name || "B").charAt(0).toUpperCase()}</span>`}
        </div>
        <div class="header-info">
          <p class="business-name">${businessName}</p>
          <div class="business-contact">
            ${business.address ? `<p>${business.address}</p>` : ""}
            ${business.phone ? `<p>${business.phone}</p>` : ""}
            ${business.whatsapp_phone ? `<p>${business.whatsapp_phone}</p>` : ""}
            ${business.email ? `<p>${business.email}</p>` : ""}
            ${business.website ? `<p>${business.website}</p>` : ""}
            ${business.tax_id ? `<p>${business.tax_id}</p>` : ""}
            ${business.registration_number ? `<p>${business.registration_number}</p>` : ""}
          </div>
        </div>
        <div class="header-doc">
          <div class="doc-title">${labels.title}</div>
          <div class="doc-number">#${meta.document_number}</div>
          ${statusBadgeHtml ? `<div style="margin-top:8px">${statusBadgeHtml}</div>` : ""}
        </div>
      </div>

      <div class="doc-top-grid">
        <div class="bill-to-block">
          <div class="section-label">Bill to</div>
          <p class="bill-to-name">${customerName}</p>
          ${customer.address ? `<p class="bill-to-detail">${customer.address}</p>` : ""}
          ${customer.email ? `<p class="bill-to-detail">${customer.email}</p>` : ""}
          ${customer.phone ? `<p class="bill-to-detail">${customer.phone}</p>` : ""}
        </div>
        <div class="meta-grid">
          <span class="meta-label">${labels.dateLabel}</span>
          <span class="meta-value">${formatDate(meta.issue_date)}</span>
          ${meta.expiry_date && labels.secondaryDateLabel === "Expiry Date" ? `
          <span class="meta-label">${labels.secondaryDateLabel}</span>
          <span class="meta-value">${formatDate(meta.expiry_date)}</span>
          ` : ""}
          ${meta.due_date && labels.secondaryDateLabel === "Due Date" ? `
          <span class="meta-label">${labels.secondaryDateLabel}</span>
          <span class="meta-value">${formatDate(meta.due_date)}</span>
          ` : ""}
        </div>
      </div>

      <table class="line-items">
        <colgroup>
          <col style="width:40%" />
          <col style="width:10%" />
          <col style="width:17%" />
          <col style="width:15%" />
          <col style="width:18%" />
        </colgroup>
        <thead>
          <tr>
            <th>Description</th>
            <th class="text-right">Qty</th>
            <th class="text-right">Unit Price</th>
            <th class="text-right">Discount</th>
            <th class="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${formattedItems
            .map(
              (item) => `
            <tr>
              <td class="desc-col">${item.description}</td>
              <td class="td-num">${item.qty}</td>
              <td class="td-num">${fmtMoney(item.unitPrice)}</td>
              <td class="td-num">${item.discount >= 0.005 ? fmtMoney(item.discount) : "—"}</td>
              <td class="td-num">${fmtMoney(item.lineTotal)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <div class="totals-wrap">
        ${showDiscountSummary
          ? `
        <div class="total-row">
          <span>Gross amount</span>
          <span>${fmtMoney(grossExtended)}</span>
        </div>
        <div class="total-row total-row-discount">
          <span>Discount</span>
          <span>−${fmtMoney(totalDiscountSum)}</span>
        </div>
        `
          : ""}
        ${showTaxBreakdown
          ? `
        <div class="total-row">
          <span>${showDiscountSummary ? "Subtotal (excl. tax)" : "Subtotal"}</span>
          <span>${fmtMoney(baseAmount)}</span>
        </div>
        ` +
            taxLines
              .map(
                (line) => `
        <div class="total-row">
          <span>${line.name || line.code}</span>
          <span>${fmtMoney(Number(line.amount))}</span>
        </div>
        `
              )
              .join("") +
            `
        <div class="total-row">
          <span>Total tax</span>
          <span>${fmtMoney(calculatedTotalTax)}</span>
        </div>
        `
          : !showDiscountSummary
            ? `
        <div class="total-row">
          <span>Subtotal</span>
          <span>${fmtMoney(subtotal)}</span>
        </div>
        `
            : ""}
        <div class="total-row final">
          <span>Total</span>
          <span>${fmtMoney(total)}</span>
        </div>
        ${totals.wht_applicable && totals.wht_amount ? `
        <div class="total-row" style="color:#92400e;margin-top:4px">
          <span>Less WHT (${((totals.wht_rate ?? 0) * 100).toFixed(0)}% withheld by customer)</span>
          <span>(${fmtMoney(totals.wht_amount)})</span>
        </div>
        <div class="total-row final" style="border-top:2px solid #1e40af;margin-top:4px;color:#1e40af">
          <span>Net Payable to Us</span>
          <span>${fmtMoney(totals.net_payable ?? (total - totals.wht_amount))}</span>
        </div>
        ` : ""}
        ${isFxDocument ? `
        <div class="total-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;font-size:11px;color:#64748b">
          <span>Exchange Rate</span>
          <span>1 ${currency_code} = ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: true }).format(fx_rate!)} ${home_currency_code}</span>
        </div>
        <div class="total-row" style="font-size:11px;color:#64748b">
          <span>${home_currency_code} Equivalent</span>
          <span>${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true }).format(home_currency_total!)} ${home_currency_code}</span>
        </div>
        ` : ""}
      </div>

      ${notes ? `
      <div class="doc-notes">
        <h4>Notes</h4>
        <p style="color:#475569;white-space:pre-wrap;margin:0">${notes.replace(/\n/g, "<br>")}</p>
      </div>
      ` : ""}

      ${hasPaymentHowTo ? `
      <div class="footer doc-section-how-to-pay">
        <h4>How to pay</h4>
        <div class="payment-cards">
          ${hasBank ? `
          <div class="payment-card">
            <p class="payment-card__label">Bank transfer</p>
            ${pd?.bank_name ? `<p class="payment-card__title">${escapeHtml(String(pd.bank_name))}</p>` : ""}
            ${pd?.bank_account_name ? `<p class="payment-card__sub">Account name: <strong style="font-weight:600;color:#334155">${escapeHtml(String(pd.bank_account_name))}</strong></p>` : ""}
            <p class="payment-card__mono">${escapeHtml(String(pd?.bank_account_number ?? ""))}</p>
          </div>
          ` : ""}
          ${hasMomo ? `
          <div class="payment-card">
            <p class="payment-card__label">${pd?.momo_provider ? `${escapeHtml(String(pd.momo_provider))} MoMo` : "Mobile money"}</p>
            ${pd?.momo_name ? `<p class="payment-card__sub">Name: <strong style="font-weight:600;color:#334155">${escapeHtml(String(pd.momo_name))}</strong></p>` : ""}
            <p class="payment-card__mono">${escapeHtml(String(pd?.momo_number ?? ""))}</p>
          </div>
          ` : ""}
        </div>
      </div>
      ` : ""}

      ${hasPaymentTermsBottom ? `
      <div class="doc-payment-terms">
        <p class="doc-payment-terms__title">Payment terms</p>
        <p class="doc-payment-terms__body">${escapeHtml(paymentTermsBottom)}</p>
      </div>
      ` : ""}

      ${documentType === "invoice" && hasFooterBottom ? `
      <div class="doc-footer-message">${escapeHtml(footerBottomPlain)}</div>
      ` : documentType !== "invoice" && rawFooter ? `
      <div class="footer">
        <p>${escapeHtml(rawFooter).replace(/\n/g, "<br>")}</p>
      </div>
      ` : ""}
    </div>
  </body>
</html>
  `.trim()
}

