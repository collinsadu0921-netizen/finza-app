/**
 * Invoice email HTML — notification only (no amounts or line items).
 * Full details appear on the public invoice page after the recipient opens the link.
 */

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
  /** Link to pay the invoice online (no amounts shown in this email) */
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
  const docNumber = invoice.invoice_number ? `#${invoice.invoice_number}` : "invoice"
  const greetingName = customerName ? escapeHtml(customerName) : "there"
  const dueLine =
    formatDate(invoice.due_date) || (invoice.payment_terms?.trim() ? escapeHtml(invoice.payment_terms) : "—")

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
          <tr>
            <td style="background:#1d4ed8;border-radius:12px 12px 0 0;padding:0;height:6px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px 36px 28px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#6b7280;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(businessName)}</p>
              <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#111827;letter-spacing:-.3px;">Invoice ${escapeHtml(docNumber)}</h1>
              <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">Hello ${greetingName},</p>
              <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Your invoice ${escapeHtml(docNumber)} from ${escapeHtml(businessName)} is ready.</p>
              <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;"><strong style="color:#374151;">Due date:</strong> ${dueLine}</p>
              ${publicViewUrl || payUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
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
              </table>` : ""}
              <p style="margin:28px 0 0;font-size:15px;color:#374151;line-height:1.6;">Thank you,<br />${escapeHtml(businessName)}</p>
            </td>
          </tr>
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
