import {
  showTenantBankPaymentCard,
  showTenantMomoPaymentCard,
  type TenantPaymentDetailFields,
} from "@/lib/invoices/invoicePaymentDetailsDisplay"

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

/** Same merged payload as invoice email — bank/MoMo from settings + merged terms/footer. */
export type ManualPaymentEmailPayload = TenantPaymentDetailFields & {
  payment_terms?: string | null
  footer_message?: string | null
}

const BOX_STYLE =
  "margin-top:24px;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;"

/**
 * Professional “Payment details” block + optional instructions/footer for transactional emails.
 * No /pay links, no amounts. Omits bank/MoMo subsections unless display rules pass.
 */
export function buildManualPaymentDetailsEmailHtml(m: ManualPaymentEmailPayload): string {
  const hasBank = showTenantBankPaymentCard(m)
  const hasMomo = showTenantMomoPaymentCard(m)
  const terms = m.payment_terms?.trim()
  const foot = m.footer_message?.trim()
  const lines: string[] = []

  if (hasBank || hasMomo) {
    lines.push(
      `<p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#111827;">Payment details</p>`,
      `<p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.55;">Please use the payment details below when making payment.</p>`
    )
  }

  if (hasBank) {
    const bankRows: string[] = []
    if (m.bank_name?.trim()) bankRows.push(`<strong>Bank:</strong> ${escapeHtml(m.bank_name.trim())}`)
    if (m.bank_account_name?.trim()) {
      bankRows.push(`<strong>Account name:</strong> ${escapeHtml(m.bank_account_name.trim())}`)
    }
    if (m.bank_account_number?.trim()) {
      bankRows.push(`<strong>Account number:</strong> ${escapeHtml(m.bank_account_number.trim())}`)
    }
    if (m.bank_branch?.trim()) bankRows.push(`<strong>Branch:</strong> ${escapeHtml(m.bank_branch.trim())}`)
    if (m.bank_swift?.trim()) bankRows.push(`<strong>SWIFT:</strong> ${escapeHtml(m.bank_swift.trim())}`)
    if (m.bank_iban?.trim()) bankRows.push(`<strong>IBAN:</strong> ${escapeHtml(m.bank_iban.trim())}`)
    lines.push(
      `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Bank transfer</p>`,
      `<p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">${bankRows.join("<br />")}</p>`
    )
  }

  if (hasMomo) {
    const prov = m.momo_provider?.trim()
    const providerLine = prov
      ? `<strong>${escapeHtml(prov)}</strong>`
      : "<strong>Mobile money</strong>"
    const moRows = [providerLine]
    if (m.momo_name?.trim()) {
      moRows.push(`Account name: ${escapeHtml(m.momo_name.trim())}`)
    }
    moRows.push(`Number: ${escapeHtml(String(m.momo_number).trim())}`)
    lines.push(
      `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">Mobile money</p>`,
      `<p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;">${moRows.join("<br />")}</p>`
    )
  }

  if (terms) {
    lines.push(
      `<p style="margin:${hasBank || hasMomo ? "16px 0 8px" : "0 0 8px"};font-size:13px;font-weight:600;color:#374151;">Payment instructions</p>`,
      `<p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.6;white-space:pre-line;">${escapeHtml(
        terms
      )}</p>`
    )
  }

  if (foot) {
    lines.push(
      `<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;white-space:pre-line;border-top:${hasBank || hasMomo || terms ? "1px solid #e5e7eb" : "none"};padding-top:${hasBank || hasMomo || terms ? "12px" : "0"}">${escapeHtml(foot)}</p>`
    )
  }

  if (!lines.length) return ""
  return `<div style="${BOX_STYLE}">${lines.join("")}</div>`
}
