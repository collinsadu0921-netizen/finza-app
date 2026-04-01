/**
 * Estimate/Quote email HTML — notification only (no amounts or line items).
 * Full details appear on the public quote page after the recipient opens the link.
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

export interface EstimateEmailItem {
  description?: string | null
  quantity?: number | null
  price?: number | null
  total?: number | null
}

export interface EstimateForEmail {
  estimate_number?: string | null
  total_amount?: number | null
  currency_code?: string | null
  expiry_date?: string | null
  estimate_items?: EstimateEmailItem[] | null
}

export interface EstimateEmailOptions {
  /** Customer name for greeting */
  customerName?: string
  /** Public link to view/accept the estimate */
  publicViewUrl?: string
}

export function buildEstimateEmailHtml(
  estimate: EstimateForEmail,
  businessName: string,
  options: EstimateEmailOptions = {}
): string {
  const { customerName, publicViewUrl } = options
  const docNumber = estimate.estimate_number ? `#${estimate.estimate_number}` : "estimate"
  const greetingName = customerName ? escapeHtml(customerName) : "there"

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Quote ${escapeHtml(docNumber)} from ${escapeHtml(businessName)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
          <tr>
            <td style="background:#b45309;border-radius:12px 12px 0 0;padding:0;height:6px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px 36px 28px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#6b7280;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(businessName)}</p>
              <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#111827;letter-spacing:-.3px;">Quote ${escapeHtml(docNumber)}</h1>
              <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">Hello ${greetingName},</p>
              <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.6;">Your estimate ${escapeHtml(docNumber)} from ${escapeHtml(businessName)} is ready.</p>
              ${publicViewUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(publicViewUrl)}" style="display:inline-block;padding:13px 32px;background:#b45309;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:.01em;">View estimate</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:13px;color:#9ca3af;text-align:center;">Open the link to review the full quote and respond online.</p>` : ""}
              <p style="margin:24px 0 0;font-size:15px;color:#374151;line-height:1.6;">Please review it and let us know if you would like to proceed.</p>
              <p style="margin:16px 0 0;font-size:15px;color:#374151;line-height:1.6;">Thank you,<br />${escapeHtml(businessName)}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:16px 36px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12px;color:#9ca3af;">
                    Questions about this quote? Contact <strong style="color:#6b7280;">${escapeHtml(businessName)}</strong> directly.
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
