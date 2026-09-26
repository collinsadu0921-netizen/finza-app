import { z } from "zod"

const clarity = z.enum(["high", "medium", "low"]).nullable()

export const receiptExtractionSchema = z.object({
  document_type: z.enum(["receipt", "invoice", "unknown"]),
  supplier_name: z.string().nullable(),
  document_date: z.string().nullable(),
  total_amount: z.number().nullable(),
  currency: z.string().nullable(),
  subtotal: z.number().nullable(),
  tax_amount: z.number().nullable(),
  receipt_number: z.string().nullable(),
  supplier_tax_id: z.string().nullable(),
  evidence: z.object({
    supplier: z.string().nullable(),
    date: z.string().nullable(),
    total: z.string().nullable(),
    currency: z.string().nullable(),
  }),
  warnings: z.array(z.string()),
  clarity: z.object({
    supplier: clarity,
    date: clarity,
    total: clarity,
    currency: clarity,
  }),
})

export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>

export const RECEIPT_EXTRACTION_PROMPT = `You are extracting bookkeeping fields from a receipt or supplier invoice.

Read the DOCUMENT ITSELF. Do not guess. Return null when a field is not clearly supported by the receipt. Do not invent missing values. Do not substitute today's date. Do not silently infer a date or total when the print is unreadable.

document_date must be ISO YYYY-MM-DD when the transaction or document date is confidently readable. Ghana commonly prints day-month-year. Do not reinterpret an obviously printed date. If the date is unreadable or ambiguous, return null.

total_amount is the final amount payable or paid for the document. Prefer labels such as TOTAL, GRAND TOTAL, AMOUNT DUE, TOTAL DUE, NET TOTAL, and BALANCE DUE. Do not use SUBTOTAL, VAT, TAX, NHIL, GETFund, discount, cash tendered, change, or line-item values as the total.

For Ghana receipts, recognize currency forms such as GHS, GH₵, GH¢, GHC, and ₵. Return the currency only when it is printed.

evidence must be the SHORT source text that supports supplier, date, total, and currency. Do not return the entire receipt transcript.

clarity is only a qualitative reading of how clear that field was on the page: high, medium, or low. It is not a probability. Use null when the field itself is null.

warnings should name specific problems such as faded print, cropped total, or ambiguous date. Use an empty array when there is nothing to warn about.`

const EVIDENCE_MAX = 180
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function blankToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function clip(value: string | null): string | null {
  if (!value) return null
  return value.length > EVIDENCE_MAX ? value.slice(0, EVIDENCE_MAX) : value
}

function finiteAmount(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return value
}

export function normalizeCurrencyCode(value: string | null): string | null {
  const raw = blankToNull(value)
  if (!raw) return null
  const compact = raw.replace(/\s+/g, "").toUpperCase()
  if (compact === "GHS" || compact === "GHC" || compact === "GH₵" || compact === "GH¢" || raw.trim() === "₵" || raw.includes("₵") || raw.includes("GH¢")) {
    return "GHS"
  }
  if (/^[A-Z]{3}$/.test(compact)) return compact
  return null
}

function isoDateOrNull(value: string | null): string | null {
  const raw = blankToNull(value)
  if (!raw) return null
  const match = ISO_DATE.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return raw
}

export function normalizeReceiptExtraction(input: ReceiptExtraction): ReceiptExtraction {
  const warnings = input.warnings
    .map((item) => blankToNull(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 8)
    .map((item) => (item.length > 200 ? item.slice(0, 200) : item))

  const documentDate = isoDateOrNull(input.document_date)
  if (blankToNull(input.document_date) && !documentDate && !warnings.includes("date_not_iso")) {
    warnings.push("date_not_iso")
  }

  return {
    document_type: input.document_type,
    supplier_name: blankToNull(input.supplier_name),
    document_date: documentDate,
    total_amount: finiteAmount(input.total_amount),
    currency: normalizeCurrencyCode(input.currency),
    subtotal: finiteAmount(input.subtotal),
    tax_amount: finiteAmount(input.tax_amount),
    receipt_number: blankToNull(input.receipt_number),
    supplier_tax_id: blankToNull(input.supplier_tax_id),
    evidence: {
      supplier: clip(blankToNull(input.evidence.supplier)),
      date: clip(blankToNull(input.evidence.date)),
      total: clip(blankToNull(input.evidence.total)),
      currency: clip(blankToNull(input.evidence.currency)),
    },
    warnings,
    clarity: input.clarity,
  }
}
