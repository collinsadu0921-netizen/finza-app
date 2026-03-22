/**
 * Estimate/Quote email HTML template.
 * Professional layout: branded header, validity info, line items, total, CTAs.
 * Uses inline CSS only — no <style> tags (Gmail strips them).
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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ""
  try {
    return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  } catch {
    return dateStr
  }
}

export function buildEstimateEmailHtml(
  estimate: EstimateForEmail,
  businessName: string,
  options: EstimateEmailOptions = {}
): string {
  const { customerName, publicViewUrl } = options
  const items = estimate.estimate_items ?? []
  const currencyCode = estimate.currency_code ?? null
  const formatAmount = (amount: number) => formatMoney(amount, currencyCode)
  const total = Number(estimate.total_amount ?? 0)
  const docNumber = estimate.estimate_number ? `#${estimate.estimate_number}` : ""
  const validUntil = formatDate(estimate.expiry_date)
  const greeting = customerName ? `Hi ${escapeHtml(customerName)},` : "Hi,"

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#374151;line-height:1.4;">${escapeHtml(String(item.description ?? "Item"))}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:center;white-space:nowrap;">${Number(item.quantity ?? 0)}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;text-align:right;white-space:nowrap;">${formatAmount(Number(item.price ?? 0))}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;font-size:14px;font-weight:600;color:#111827;text-align:right;white-space:nowrap;">${formatAmount(Number(item.total ?? 0))}</td>
        </tr>
      `
    )
    .join("")

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

          <!-- Top accent bar (amber — signals awaiting approval) -->
          <tr>
            <td style="background:#b45309;border-radius:12px 12px 0 0;padding:0;height:6px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#ffffff;padding:32px 36px 28px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">

              <!-- Business name + Document header -->
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#6b7280;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(businessName)}</p>
              <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#111827;letter-spacing:-.3px;">Quote ${escapeHtml(docNumber)}</h1>

              ${validUntil ? `
              <!-- Validity badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:8px 14px;font-size:13px;color:#92400e;font-weight:500;">
                    Valid until ${escapeHtml(validUntil)}
                  </td>
                </tr>
              </table>` : ""}

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">${greeting}</p>
              <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">We've prepared a quote for you. Please review the details below and let us know if you'd like to proceed.</p>

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

              <!-- Total box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                <tr>
                  <td align="right">
                    <table cellpadding="0" cellspacing="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px;display:inline-table;">
                      <tr>
                        <td style="font-size:13px;color:#92400e;font-weight:500;padding-right:24px;">Quote total</td>
                        <td style="font-size:22px;font-weight:800;color:#92400e;text-align:right;">${formatAmount(total)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              ${publicViewUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(publicViewUrl)}" style="display:inline-block;padding:13px 32px;background:#b45309;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:.01em;">View &amp; accept quote</a>
                  </td>
                </tr>
              </table>
              <p style="margin:16px 0 0;font-size:13px;color:#9ca3af;text-align:center;">Click the button to view the full quote and accept it online.</p>
              ` : ""}

            </td>
          </tr>

          <!-- Footer -->
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
