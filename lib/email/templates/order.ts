/**
 * Order confirmation email HTML template.
 * Same structure as invoice: business name, order number, line items table, total, contact note.
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

export interface OrderEmailItem {
  description?: string | null
  quantity?: number | null
  unit_price?: number | null
  line_total?: number | null
}

export interface OrderForEmail {
  id?: string | null
  total_amount?: number | null
  currency_code?: string | null
  order_items?: OrderEmailItem[] | null
}

export function buildOrderEmailHtml(order: OrderForEmail, businessName: string): string {
  const items = order.order_items ?? []
  const currencyCode = order.currency_code ?? null
  const formatAmount = (amount: number) => formatMoney(amount, currencyCode)
  const total = Number(order.total_amount ?? 0)
  const orderNumber = order.id ? `ORD-${order.id.substring(0, 8).toUpperCase()}` : "Order"

  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;color:#333;">${escapeHtml(String(item.description ?? "Item"))}</td>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;text-align:center;">${Number(item.quantity ?? 0)}</td>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;text-align:right;">${formatAmount(Number(item.unit_price ?? 0))}</td>
          <td style="padding:10px;border-bottom:1px solid #ddd;font-size:14px;text-align:right;font-weight:500;">${formatAmount(Number(item.line_total ?? 0))}</td>
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
    <p>Order confirmation ${escapeHtml(orderNumber)}</p>
  </div>
  <div class="doc-info">
    <p><strong>Order:</strong> ${escapeHtml(orderNumber)}</p>
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
    <p>Please contact ${escapeHtml(businessName)} with any questions about this order.</p>
  </div>
</body>
</html>
  `.trim()
}
