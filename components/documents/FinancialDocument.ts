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

export interface FinancialDocumentProps {
  documentType: DocumentType
  business: BusinessInfo
  customer: CustomerInfo
  items: DocumentItem[]
  totals: DocumentTotals
  meta: DocumentMeta
  notes?: string | null
  footer_message?: string | null
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

  // Format items for display (discount column + correct net line total)
  const formattedItems = items.map((item) => {
    const qty = item.qty || item.quantity || 0
    const unitPrice = item.unit_price || item.price || 0
    const discount = Number(item.discount_amount) || 0
    const lineTotal = item.line_subtotal || item.line_total || item.total || qty * unitPrice - discount
    return {
      description: item.description || "Item",
      qty,
      unitPrice,
      discount: Math.round(discount * 100) / 100,
      lineTotal: Math.round(Number(lineTotal) * 100) / 100,
    }
  })

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

  // Slate palette (matches create invoice page): slate-50 #f8fafc, slate-100 #f1f5f9, slate-200 #e2e8f0, slate-500 #64748b, slate-600 #475569, slate-700 #334155, slate-900 #0f172a
  const statusBadgeHtml =
    documentType === "invoice" && meta.status
      ? (() => {
          const s = (meta.status || "").toLowerCase()
          const label = s === "paid" ? "Paid" : s === "overdue" ? "Overdue" : s === "sent" ? "Sent" : "Unpaid"
          const bg =
            s === "paid"
              ? "#d1fae9"
              : s === "overdue"
                ? "#ffe4e6"
                : s === "sent"
                  ? "#dbeafe"
                  : "#fef3c7"
          const text =
            s === "paid"
              ? "#065f46"
              : s === "overdue"
                ? "#9f1239"
                : s === "sent"
                  ? "#1e40af"
                  : "#92400e"
          return `<span style="display:inline-block;padding:4px 12px;border-radius:9999px;font-size:12px;font-weight:600;background:${bg};color:${text}">${label}</span>`
        })()
      : ""

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
        margin-bottom: 32px;
        font-size: 14px;
      }
      .meta-label { color: #64748b; }
      .meta-value { color: #0f172a; font-weight: 500; }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 24px;
      }
      thead {
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }
      th {
        text-align: left;
        padding: 12px 24px;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #64748b;
        font-weight: 600;
      }
      th.text-right { text-align: right; }
      td {
        padding: 12px 24px;
        border-bottom: 1px solid #f1f5f9;
        font-size: 14px;
        color: #334155;
        word-break: break-word;
        overflow-wrap: break-word;
      }
      td.text-right { text-align: right; }
      td.desc-col { max-width: 0; } /* forces break-word to kick in within colgroup width */
      .totals-wrap {
        margin-left: auto;
        width: 320px;
        padding-top: 16px;
        border-top: 1px solid #f1f5f9;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        font-size: 14px;
        color: #475569;
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
      @media print {
        body { background: #fff; padding: 0; }
        .document-container { box-shadow: none; border: 0; border-radius: 0; padding: 16px; }
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

      <div style="margin-bottom: 24px;">
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

      <table>
        <colgroup>
          <col style="width:44%" />
          <col style="width:9%" />
          <col style="width:15%" />
          <col style="width:14%" />
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
              <td class="text-right">${item.qty}</td>
              <td class="text-right">${currency_symbol} ${item.unitPrice.toFixed(2)}</td>
              <td class="text-right">${item.discount > 0 ? `${currency_symbol} ${item.discount.toFixed(2)}` : "—"}</td>
              <td class="text-right">${currency_symbol} ${item.lineTotal.toFixed(2)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <div class="totals-wrap">
        <div class="total-row">
          <span>Subtotal</span>
          <span>${currency_symbol} ${showTaxBreakdown ? baseAmount.toFixed(2) : subtotal.toFixed(2)}</span>
        </div>
        ${showTaxBreakdown
          ? taxLines
              .map(
                (line) => `
        <div class="total-row">
          <span>${line.name || line.code}</span>
          <span>${currency_symbol} ${Number(line.amount).toFixed(2)}</span>
        </div>
        `
              )
              .join("") + `
        <div class="total-row">
          <span>Total tax</span>
          <span>${currency_symbol} ${calculatedTotalTax.toFixed(2)}</span>
        </div>
        `
          : ""}
        <div class="total-row final">
          <span>Total</span>
          <span>${currency_symbol} ${total.toFixed(2)}</span>
        </div>
        ${totals.wht_applicable && totals.wht_amount ? `
        <div class="total-row" style="color:#92400e;margin-top:4px">
          <span>Less WHT (${((totals.wht_rate ?? 0) * 100).toFixed(0)}% withheld by customer)</span>
          <span>(${currency_symbol} ${totals.wht_amount.toFixed(2)})</span>
        </div>
        <div class="total-row final" style="border-top:2px solid #1e40af;margin-top:4px;color:#1e40af">
          <span>Net Payable to Us</span>
          <span>${currency_symbol} ${(totals.net_payable ?? (total - totals.wht_amount)).toFixed(2)}</span>
        </div>
        ` : ""}
        ${isFxDocument ? `
        <div class="total-row" style="margin-top:8px;padding-top:8px;border-top:1px dashed #e2e8f0;font-size:11px;color:#64748b">
          <span>Exchange Rate</span>
          <span>1 ${currency_code} = ${fx_rate!.toFixed(4)} ${home_currency_code}</span>
        </div>
        <div class="total-row" style="font-size:11px;color:#64748b">
          <span>${home_currency_code} Equivalent</span>
          <span>${home_currency_total!.toFixed(2)} ${home_currency_code}</span>
        </div>
        ` : ""}
      </div>

      ${notes ? `
      <div class="footer">
        <h4>Notes</h4>
        <p style="color:#475569;white-space:pre-wrap">${notes.replace(/\n/g, "<br>")}</p>
      </div>
      ` : ""}

      ${footer_message ? `
      <div class="footer">
        <p>${footer_message.replace(/\n/g, "<br>")}</p>
      </div>
      ` : ""}
    </div>
  </body>
</html>
  `.trim()
}

