/**
 * Plain-text buy lists for WhatsApp / email — retail supplier order flow (no HTML dependency).
 */

export type BuyListLine = { productName: string; quantity: number; note?: string | null }

export type BuyListPayload = {
  businessName: string
  storeLabel?: string | null
  supplierName: string
  reference?: string | null
  /** ISO date string (YYYY-MM-DD) shown in detailed template */
  orderDate?: string | null
  expectedDate?: string | null
  lines: BuyListLine[]
  supplierNote?: string | null
}

export const BUY_LIST_TEMPLATE_IDS = ["default", "short", "detailed"] as const
export type BuyListTemplateId = (typeof BUY_LIST_TEMPLATE_IDS)[number]

export const buyListTemplateLabel = (id: BuyListTemplateId): string => {
  switch (id) {
    case "short":
      return "Short (compact)"
    case "detailed":
      return "Detailed (with dates)"
    default:
      return "Standard (polite)"
  }
}

function formatLines(lines: BuyListLine[]): string {
  return lines
    .map((l, i) => {
      const nm = l.productName.trim() || `Item ${i + 1}`
      const bits = [`• ${nm}`, `qty ${Number(l.quantity) || 0}`]
      if (l.note?.trim()) bits.push(`(${l.note.trim()})`)
      return bits.join(" — ")
    })
    .join("\n")
}

export function buildBuyListPlainText(p: BuyListPayload): string {
  const ref = p.reference?.trim()
  return [
    `Order for: ${p.supplierName}`,
    `From: ${p.businessName.trim()}${p.storeLabel?.trim() ? ` (${p.storeLabel.trim()})` : ""}`,
    ref ? `Ref: ${ref}` : null,
    "",
    "Please supply:",
    formatLines(p.lines),
    "",
    p.supplierNote?.trim() ? `Note: ${p.supplierNote.trim()}` : null,
    "",
    "Thank you.",
  ]
    .filter((x): x is string => x != null && x !== "")
    .join("\n")
}

function buildBuyListShortText(p: BuyListPayload): string {
  const ref = p.reference?.trim()
  const head = [`${p.supplierName} — ${p.businessName.trim()}`, ref ? `Ref: ${ref}` : null]
    .filter((x): x is string => Boolean(x))
    .join("\n")
  const body = p.lines
    .map((l, i) => {
      const nm = l.productName.trim() || `Item ${i + 1}`
      return `${Number(l.quantity) || 0}× ${nm}`
    })
    .join("\n")
  const note = p.supplierNote?.trim() ? `\n\nNote: ${p.supplierNote.trim()}` : ""
  return `${head}\n\n${body}${note}`
}

function buildBuyListDetailedText(p: BuyListPayload): string {
  const ref = p.reference?.trim()
  const od = p.orderDate?.trim() || null
  const ed = p.expectedDate?.trim() || null
  return [
    `Order for: ${p.supplierName}`,
    `From: ${p.businessName.trim()}${p.storeLabel?.trim() ? ` (${p.storeLabel.trim()})` : ""}`,
    ref ? `Reference: ${ref}` : null,
    od ? `Order date: ${od}` : null,
    ed ? `Expected by: ${ed}` : null,
    "",
    "Please supply:",
    formatLines(p.lines),
    "",
    p.supplierNote?.trim() ? `Note: ${p.supplierNote.trim()}` : null,
    "",
    "Thank you.",
  ]
    .filter((x): x is string => x != null && x !== "")
    .join("\n")
}

/** Plain-text body for the selected list template (WhatsApp, email, copy). */
export function buildBuyListMessage(template: BuyListTemplateId, p: BuyListPayload): string {
  switch (template) {
    case "short":
      return buildBuyListShortText(p)
    case "detailed":
      return buildBuyListDetailedText(p)
    default:
      return buildBuyListPlainText(p)
  }
}

/** E.164-ish digits for wa.me (Ghana +233 common). */
export function normalizePhoneForWa(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  let d = raw.replace(/[^\d+]/g, "")
  if (d.startsWith("0") && d.length >= 10) {
    d = "+233" + d.slice(1)
  }
  if (!d.startsWith("+")) {
    d = "+" + d.replace(/^\+/, "")
  }
  const digits = d.replace(/\D/g, "")
  return digits.length >= 9 ? digits : null
}

export function buildWhatsAppBuyListUrl(phoneDigits: string, text: string): string {
  const enc = encodeURIComponent(text)
  return `https://wa.me/${phoneDigits}?text=${enc}`
}

export function buildMailtoBuyListUrl(email: string, subject: string, body: string): string {
  const q = new URLSearchParams()
  q.set("subject", subject.slice(0, 200))
  q.set("body", body)
  return `mailto:${email.trim()}?${q.toString()}`
}
