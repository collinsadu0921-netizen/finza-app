/**
 * Order confirmation email HTML — notification only (no amounts or line items).
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

export interface OrderEmailOptions {
  publicViewUrl?: string
}

export function buildOrderEmailHtml(
  order: OrderForEmail,
  businessName: string,
  options: OrderEmailOptions = {}
): string {
  const { publicViewUrl } = options
  const orderNumber = order.id ? `ORD-${order.id.substring(0, 8).toUpperCase()}` : "Order"

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Order ${escapeHtml(orderNumber)} from ${escapeHtml(businessName)}</title>
</head>
<body style="margin:0;padding:24px;font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin-left:auto;margin-right:auto;">
  <p style="margin:0 0 8px;font-size:15px;">Hello,</p>
  <p style="margin:0 0 16px;font-size:15px;">Your order <strong>${escapeHtml(orderNumber)}</strong> from <strong>${escapeHtml(businessName)}</strong> is ready.</p>
  ${publicViewUrl ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(publicViewUrl)}" style="display:inline-block;padding:12px 24px;background:#1d4ed8;color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">View order</a></p>` : ""}
  <p style="margin:0;font-size:15px;">Thank you,<br />${escapeHtml(businessName)}</p>
  <p style="margin:24px 0 0;font-size:12px;color:#666;">Please contact ${escapeHtml(businessName)} with any questions about this order.</p>
</body>
</html>
  `.trim()
}
