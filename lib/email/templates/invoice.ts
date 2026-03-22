/**
 * Invoice email HTML template.
 * Professional layout: branded header, document details, line items, amount due, CTAs.
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
  issue_date?: string | null
  due_date?: string | null
  payment_terms?: string | null
}

export interface InvoiceEmailOptions {
  /** Public link to view the invoice */
  publicViewUrl?: string
  /** Link to pay the invoice online */
  payUrl?: string
  /** Customer name for greeting */
  customerName?: string
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ""
  try {
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  } catch {
    return dateStr
  }
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
  const docNumber = invoice.invoice_number ? `#${invoice.invoice_number}` : ""
  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : "Hi,"

  const issueDate = formatDate(invoice.issue_date)
  const dueDate = formatDate(invoice.due_date) || invoice.payment_terms || ""

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;line-height:1.4;">${escapeHtml(String(item.description ?? "Item"))}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;white-space:nowrap;">${Number(item.qty ?? 0)}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:right;white-space:nowrap;">${formatAmount(Number(item.unit_price ?? 0))}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;font-weight:600;color:#111827;text-align:right;white-space:nowrap;">${formatAmount(Number(item.line_subtotal ?? 0))}</td>
        </tr>
      `
    )
    .join("")

  const metaRow = (label: string, value: string) =>
    value
      ? `<tr>
          <td style="padding:4px 0;font-size:13px;color:#6b7280;width:40%;">${label}</td>
          <td style="padding:4px 0;font-size:13px;color:#111827;font-weight:500;text-align:right;">${escapeHtml(value)}</td>
        </tr>`
      : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Invoice ${escapeHtml(docNumber)} from ${escapeHtml(businessName)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

          <!-- Top accent bar -->
          <tr>
            <td style="background:#1d4ed8;border-radius:12px 12px 0 0;padding:0;height:6px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#ffffff;padding:32px 36px 28px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">

              <!-- Business name + Document header -->
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#6b7280;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(businessName)}</p>
              <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#111827;letter-spacing:-.3px;">Invoice ${escapeHtml(docNumber)}</h1>

              <!-- Meta info (dates) -->
              ${issueDate || dueDate ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f3f4f6;">
                <tbody>
                  ${metaRow("Issue date", issueDate)}
                  ${metaRow("Due date", dueDate)}
                </tbody>
              </table>` : ""}

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">${greeting}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">Please find your invoice details below. We appreciate your business.</p>

              <!-- Line items -->
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:12px 16px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Item</th>
                    <th style="padding:12px 16px;text-align:center;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Qty</th>
                    <th style="padding:12px 16px;text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Unit price</th>
                    <th style="padding:12px 16px;text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;">Total</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>

              <!-- Amount due box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                <tr>
                  <td align="right">
                    <table cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px 20px;display:inline-table;">
                      <tr>
                        <td style="font-size:13px;color:#1d4ed8;font-weight:500;padding-right:24px;">Amount due</td>
                        <td style="font-size:22px;font-weight:800;color:#1d4ed8;text-align:right;">${formatAmount(total)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTAs -->
              ${publicViewUrl || payUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        ${publicViewUrl ? `
                        <td style="padding:4px;">
                          <a href="${escapeHtml(publicViewUrl)}" style="display:inline-block;padding:13px 24px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:.01em;">View invoice</a>
                        </td>` : ""}
                        ${payUrl ? `
                        <td style="padding:4px;">
                          <a href="${escapeHtml(payUrl)}" style="display:inline-block;padding:13px 24px;background:#059669;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:.01em;">Pay now</a>
                        </td>` : ""}
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:13px;color:#9ca3af;text-align:center;">You can view, download, and pay your invoice online using the buttons above.</p>
              ` : ""}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 36px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12px;color:#9ca3af;">
                    Questions? Contact <strong style="color:#6b7280;">${escapeHtml(businessName)}</strong> directly.
                  </td>
                  <td style="font-size:12px;color:#d1d5db;text-align:right;">
                    Sent via <strong style="color:#6b7280;">Finza</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()
}
