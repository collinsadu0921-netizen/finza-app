/**
 * Estimate email HTML template.
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

export function buildEstimateEmailHtml(estimate: EstimateForEmail, businessName: string): string {
  const items = estimate.estimate_items ?? []
  const currencyCode = estimate.currency_code ?? null
  const formatAmount = (amount: number) => formatMoney(amount, currencyCode)
  const total = Number(estimate.total_amount ?? 0)
  const docNumber = estimate.estimate_number ? `#${estimate.estimate_number}` : "Estimate"
  const validUntil = estimate.expiry_date
    ? new Date(estimate.expiry_date).toLocaleDateString()
    : ""

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;color:#333;">${escapeHtml(String(item.description ?? "Item"))}</td>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;text-align:center;">${Number(item.quantity ?? 0)}</td>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;text-align:right;">${formatAmount(Number(item.price ?? 0))}</td>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;text-align:right;font-weight:500;">${formatAmount(Number(item.total ?? 0))}</td>
        </tr>
      `
    )
    .join("")

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 20px; }
    .header h1 { margin: 0; font-size: 24px; }
    .doc-info { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
    td:last-child, th:last-child { text-align: right; }
    .total-row { border-top: 2px solid #333; padding-top: 10px; margin-top: 10px; font-size: 18px; font-weight: bold; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(businessName)}</h1>
    <p>Estimate ${escapeHtml(docNumber)}</p>
  </div>
  <div class="doc-info">
    <p><strong>Document:</strong> Estimate ${escapeHtml(docNumber)}</p>
    ${validUntil ? `<p><strong>Valid until:</strong> ${escapeHtml(validUntil)}</p>` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:right;">Unit price</th>
        <th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total-row" style="text-align:right;">Total: ${formatAmount(total)}</p>
  <div class="footer">
    <p>Please contact ${escapeHtml(businessName)} with any questions about this estimate.</p>
  </div>
</body>
</html>
  `.trim()
}
