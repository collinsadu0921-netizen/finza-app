const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(n)) ? Number(n) : 0)

const dateOnly = (value?: string | null) => {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}
const esc = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

export function buildCustomerStatementPdfHtml(params: {
  business: {
    name?: string | null
    legal_name?: string | null
    trading_name?: string | null
    email?: string | null
    phone?: string | null
    address?: string | null
    logo_url?: string | null
    default_currency?: string | null
  } | null
  customer: {
    id: string
    name: string
    email?: string | null
    phone?: string | null
    whatsapp_phone?: string | null
    address?: string | null
  }
  invoices: any[]
  payments: any[]
  creditNotes: any[]
  summary: {
    openingBalance?: number
    totalInvoiced: number
    totalPaid: number
    totalCredits: number
    totalOutstanding: number
    totalOverdue: number
    closingBalance?: number
  }
  transactions?: Array<{
    date: string | null
    type: "invoice" | "payment" | "credit_note"
    reference: string
    description: string
    debit: number
    credit: number
    balance: number
  }>
  startDate?: string | null
  endDate?: string | null
  generatedAt: Date
}) {
  const {
    business,
    customer,
    invoices,
    payments,
    creditNotes,
    summary,
    startDate,
    endDate,
    generatedAt,
  } = params

  const currency = business?.default_currency || "USD"
  const businessName = business?.trading_name || business?.legal_name || business?.name || "Business"
  const contactLines = [
    business?.email ? `Email: ${business.email}` : null,
    business?.phone ? `Phone: ${business.phone}` : null,
  ].filter(Boolean) as string[]
  const tableRows = (params.transactions || [])
    .map((t) => {
      const typeLabel =
        t.type === "credit_note" ? "Credit Note" : t.type === "payment" ? "Payment" : "Invoice"
      return `
        <tr>
          <td>${esc(dateOnly(t.date))}</td>
          <td>${esc(typeLabel)}</td>
          <td>${esc(t.reference)}</td>
          <td>${esc(t.description)}</td>
          <td class="num">${t.debit > 0 ? esc(money(t.debit, currency)) : "—"}</td>
          <td class="num">${t.credit > 0 ? esc(money(t.credit, currency)) : "—"}</td>
          <td class="num">${esc(money(t.balance, currency))}</td>
        </tr>
      `
    })
    .join("")

  const statementRange =
    startDate || endDate
      ? `${startDate ? dateOnly(startDate) : "Beginning"} to ${endDate ? dateOnly(endDate) : "Present"}`
      : "All dates"

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Customer Statement</title>
    <style>
      body { font-family: Inter, Arial, sans-serif; color: #111827; margin: 0; }
      .page { padding: 22px; }
      .row { display: flex; justify-content: space-between; gap: 16px; }
      .muted { color: #6b7280; font-size: 12px; line-height: 1.45; }
      .title { font-size: 22px; margin: 0; }
      .sub { font-size: 13px; color: #374151; margin-top: 4px; }
      .box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; margin-top: 14px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
      th, td { border-bottom: 1px solid #e5e7eb; padding: 7px 6px; vertical-align: top; text-align: left; }
      th { background: #f9fafb; font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: .03em; }
      .num { text-align: right; white-space: nowrap; }
      .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; font-size: 12px; margin-top: 10px; }
      .summary strong { display: inline-block; min-width: 130px; }
      .logo { max-height: 48px; max-width: 180px; object-fit: contain; margin-bottom: 8px; }
      .foot { margin-top: 12px; font-size: 11px; color: #6b7280; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="row">
        <div>
          ${business?.logo_url ? `<img src="${esc(business.logo_url)}" alt="logo" class="logo" />` : ""}
          <h1 class="title">${esc(businessName)}</h1>
          <div class="muted">${esc(business?.address || "")}</div>
          <div class="muted">${esc(contactLines.join(" • "))}</div>
        </div>
        <div style="text-align:right">
          <h2 class="title">Statement of Account</h2>
          <div class="sub">Generated: ${esc(dateOnly(generatedAt.toISOString()))}</div>
          <div class="sub">Date range: ${esc(statementRange)}</div>
        </div>
      </div>

      <div class="box">
        <div><strong>Customer:</strong> ${esc(customer.name)}</div>
        <div class="muted">${esc(customer.email || "")}${customer.email && (customer.phone || customer.address) ? " • " : ""}${esc(customer.phone || "")}</div>
        <div class="muted">${esc(customer.address || "")}</div>
      </div>

      <div class="box">
        <div><strong>Opening balance:</strong> ${esc(money(summary.openingBalance || 0, currency))}</div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Reference</th>
              <th>Description</th>
              <th class="num">Debit</th>
              <th class="num">Credit</th>
              <th class="num">Running Balance</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || `<tr><td colspan="7" class="muted">No transactions for this date range.</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="box">
        <div><strong>Summary</strong></div>
        <div class="summary">
          <div><strong>Total Invoiced:</strong> ${esc(money(summary.totalInvoiced, currency))}</div>
          <div><strong>Total Paid:</strong> ${esc(money(summary.totalPaid, currency))}</div>
          <div><strong>Credit Notes:</strong> ${esc(money(summary.totalCredits, currency))}</div>
          <div><strong>Outstanding:</strong> ${esc(money(summary.totalOutstanding, currency))}</div>
          <div><strong>Overdue:</strong> ${esc(money(summary.totalOverdue, currency))}</div>
          <div><strong>Closing Balance:</strong> ${esc(money(summary.closingBalance ?? summary.totalOutstanding, currency))}</div>
        </div>
      </div>

      <div class="foot">
        Statements are private. Download the PDF and send it manually if needed.
      </div>
    </div>
  </body>
</html>`
}
