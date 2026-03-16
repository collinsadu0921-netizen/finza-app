/**
 * Invoice email HTML template.
 * Simple layout: business name, document number, line items table, total, contact note.
 */

import { formatMoney } from "@/lib/money"

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

export interface InvoiceEmailItem {
  description?: string | null
  qty?: number | null
  unit_price?: number | null
  line_subtotal?: number | null
}

export interface InvoiceForEmail {
  invoice_number?: string | null
  total?: number | null
  currency_code?: string | null
  invoice_items?: InvoiceEmailItem[] | null
}

export interface InvoiceEmailOptions {
  /** Public link to view the invoice (client page) */
  publicViewUrl?: string
  /** Link to pay the invoice online */
  payUrl?: string
  /** Customer name for greeting */
  customerName?: string
}

export function buildInvoiceEmailHtml(
  invoice: InvoiceForEmail,
  businessName: string,
  options: InvoiceEmailOptions = {}
): string {
  const { publicViewUrl, payUrl, customerName } = options
  const items = invoice.invoice_items ?? []
  const currencyCode = invoice.currency_code ?? null
  const formatAmount = (amount: number) => formatMoney(amount, currencyCode)
  const total = Number(invoice.total ?? 0)
  const docNumber = invoice.invoice_number ? `#${invoice.invoice_number}` : "Invoice"
  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : "Hi,"

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#374151;">${escapeHtml(String(item.description ?? "Item"))}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:center;">${Number(item.qty ?? 0)}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:right;">${formatAmount(Number(item.unit_price ?? 0))}</td>
          <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:right;font-weight:600;">${formatAmount(Number(item.line_subtotal ?? 0))}</td>
        </tr>
      `
    )
    .join("")

  const ctaSection =
    publicViewUrl || payUrl
      ? `
  <div style="margin:28px 0;text-align:center;">
    ${publicViewUrl ? `
    <a href="${escapeHtml(publicViewUrl)}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;margin:4px;">View invoice online</a>
    ` : ""}
    ${payUrl ? `
    <a href="${escapeHtml(payUrl)}" style="display:inline-block;padding:12px 24px;background:#059669;color:#fff;text-decoration:none;border-radius:8px;font-size:16px;font-weight:600;margin:4px;">Pay online</a>
    ` : ""}
  </div>
  <p style="font-size:13px;color:#6b7280;margin:0 0 20px;">You can view the full invoice, download a copy, and pay online using the links above.</p>
  `
      : ""

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${escapeHtml(docNumber)} from ${escapeHtml(businessName)}</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="padding:28px 24px 20px;border-bottom:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;font-size:14px;color:#6b7280;">${escapeHtml(businessName)}</p>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;">Invoice ${escapeHtml(docNumber)}</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 20px;font-size:15px;color:#374151;">${greeting}</p>
      <p style="margin:0 0 20px;font-size:15px;color:#374151;">Please find your invoice details below.</p>

      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <thead>
          <tr>
            <th style="padding:10px;text-align:left;background:#f9fafb;font-weight:600;color:#374151;">Item</th>
            <th style="padding:10px;text-align:center;background:#f9fafb;font-weight:600;color:#374151;">Qty</th>
            <th style="padding:10px;text-align:right;background:#f9fafb;font-weight:600;color:#374151;">Unit price</th>
            <th style="padding:10px;text-align:right;background:#f9fafb;font-weight:600;color:#374151;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="text-align:right;margin:16px 0 0;padding-top:16px;border-top:2px solid #111827;font-size:18px;font-weight:700;color:#111827;">Total: ${formatAmount(total)}</p>
      ${ctaSection}
    </div>
    <div style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280;">
      <p style="margin:0;">Questions? Contact ${escapeHtml(businessName)}.</p>
    </div>
  </div>
</body>
</html>
  `.trim()
}
