/**
 * Receipt Template Functions (Phase 1 - Canonical Format)
 * 
 * Uses ledger-final data only. No recalculation.
 * All totals come from sale.amount and journal entries.
 */

import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"
import { formatMoney } from "@/lib/money"
import { getCurrencySymbol } from "@/lib/currency"

export type ReceiptData = {
  businessName: string
  receiptNumber: string
  date: string
  time: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  items: Array<{
    name: string
    quantity: number
    unitPrice: number
    total: number
  }>
  subtotal: number
  taxBreakdown: {
    vat?: number
    nhil?: number
    getfund?: number
    covid?: number
  }
  totalTax: number
  totalPaid: number
  paymentMethod: string
  paymentStatus: string
  isRefunded: boolean
  isVoided: boolean
  currencyCode?: string | null
}

/**
 * Generate email receipt HTML
 */
export function generateEmailReceipt(data: ReceiptData): string {
  const currencySymbol = data.currencyCode ? getCurrencySymbol(data.currencyCode) : ""
  const currencyCode = data.currencyCode || ""

  const formatAmount = (amount: number) => formatMoney(amount, data.currencyCode)

  let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
    }
    .receipt-info {
      background: #f5f5f5;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
    }
    .receipt-info p {
      margin: 5px 0;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    .items-table th,
    .items-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    .items-table th {
      background: #f5f5f5;
      font-weight: bold;
    }
    .items-table td:last-child,
    .items-table th:last-child {
      text-align: right;
    }
    .totals {
      margin-top: 20px;
      text-align: right;
    }
    .totals-row {
      display: flex;
      justify-content: flex-end;
      padding: 5px 0;
    }
    .totals-label {
      width: 150px;
      text-align: right;
      padding-right: 20px;
    }
    .totals-value {
      width: 100px;
      text-align: right;
      font-weight: bold;
    }
    .total-row {
      border-top: 2px solid #333;
      padding-top: 10px;
      margin-top: 10px;
      font-size: 18px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #666;
      text-align: center;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      margin-left: 10px;
    }
    .status-paid {
      background: #d4edda;
      color: #155724;
    }
    .status-refunded {
      background: #f8d7da;
      color: #721c24;
    }
    .status-voided {
      background: #fff3cd;
      color: #856404;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(data.businessName)}</h1>
    <p>Receipt</p>
  </div>

  <div class="receipt-info">
    <p><strong>Receipt Number:</strong> ${escapeHtml(data.receiptNumber)}</p>
    <p><strong>Date:</strong> ${escapeHtml(data.date)}</p>
    <p><strong>Time:</strong> ${escapeHtml(data.time)}</p>
    ${data.customerName ? `<p><strong>Customer:</strong> ${escapeHtml(data.customerName)}</p>` : ""}
    <p><strong>Payment Method:</strong> ${escapeHtml(formatPaymentMethod(data.paymentMethod))} 
      <span class="status-badge status-${data.paymentStatus}">${escapeHtml(data.paymentStatus.toUpperCase())}</span>
    </p>
    ${data.isRefunded ? '<p><strong style="color: #721c24;">⚠️ This sale has been refunded</strong></p>' : ""}
    ${data.isVoided ? '<p><strong style="color: #856404;">⚠️ This sale has been voided</strong></p>' : ""}
  </div>

  <table class="items-table">
    <thead>
      <tr>
        <th>Item</th>
        <th>Qty</th>
        <th>Price</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${data.items.map(item => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${item.quantity}</td>
          <td>${formatAmount(item.unitPrice)}</td>
          <td>${formatAmount(item.total)}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row">
      <div class="totals-label">Subtotal:</div>
      <div class="totals-value">${formatAmount(data.subtotal)}</div>
    </div>
    ${data.taxBreakdown.vat ? `
    <div class="totals-row">
      <div class="totals-label">VAT:</div>
      <div class="totals-value">${formatAmount(data.taxBreakdown.vat)}</div>
    </div>
    ` : ""}
    ${data.taxBreakdown.nhil ? `
    <div class="totals-row">
      <div class="totals-label">NHIL:</div>
      <div class="totals-value">${formatAmount(data.taxBreakdown.nhil)}</div>
    </div>
    ` : ""}
    ${data.taxBreakdown.getfund ? `
    <div class="totals-row">
      <div class="totals-label">GETFund:</div>
      <div class="totals-value">${formatAmount(data.taxBreakdown.getfund)}</div>
    </div>
    ` : ""}
    ${data.totalTax > 0 ? `
    <div class="totals-row">
      <div class="totals-label">Total Tax:</div>
      <div class="totals-value">${formatAmount(data.totalTax)}</div>
    </div>
    ` : ""}
    <div class="totals-row total-row">
      <div class="totals-label">Total Paid:</div>
      <div class="totals-value">${formatAmount(data.totalPaid)}</div>
    </div>
  </div>

  <div class="footer">
    <p>This receipt reflects final posted amounts.</p>
    <p>Thank you for your business!</p>
  </div>
</body>
</html>
  `

  return html.trim()
}

/**
 * Generate SMS receipt text (concise format)
 */
export function generateSMSReceipt(data: ReceiptData): string {
  let sms = `${data.businessName}\n`
  sms += `Receipt: ${data.receiptNumber}\n`
  sms += `Date: ${data.date} ${data.time}\n`

  if (data.customerName) {
    sms += `Customer: ${data.customerName}\n`
  }

  sms += `Payment: ${formatPaymentMethod(data.paymentMethod)}\n`

  if (data.isRefunded) {
    sms += `⚠️ REFUNDED\n`
  } else if (data.isVoided) {
    sms += `⚠️ VOIDED\n`
  }

  sms += `\nAmounts are available in your full receipt or sales record.`

  return sms
}

/**
 * Format payment method for display
 */
function formatPaymentMethod(method: string): string {
  const methods: Record<string, string> = {
    cash: "Cash",
    momo: "Mobile Money",
    card: "Card",
  }
  return methods[method.toLowerCase()] || method
}

/**
 * Escape HTML to prevent XSS
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
