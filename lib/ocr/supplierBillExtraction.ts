import { z } from "zod"
import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { normalizeCurrencyCode } from "@/lib/ocr/openaiReceiptSchema"

const clarity = z.enum(["high", "medium", "low"]).nullable()

export const supplierBillLineSchema = z.object({
  description: z.string().nullable(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  discount_amount: z.number().nullable(),
  line_total: z.number().nullable(),
})

export const supplierBillExtractionSchema = z.object({
  document_type: z.enum(["invoice", "receipt", "unknown"]),
  supplier_name: z.string().nullable(),
  supplier_tax_id: z.string().nullable(),
  invoice_number: z.string().nullable(),
  document_date: z.string().nullable(),
  due_date: z.string().nullable(),
  currency: z.string().nullable(),
  line_items: z.array(supplierBillLineSchema),
  subtotal: z.number().nullable(),
  tax_amount: z.number().nullable(),
  total_amount: z.number().nullable(),
  evidence: z.object({
    supplier: z.string().nullable(),
    invoice_number: z.string().nullable(),
    date: z.string().nullable(),
    due_date: z.string().nullable(),
    total: z.string().nullable(),
    currency: z.string().nullable(),
  }),
  warnings: z.array(z.string()),
  clarity: z.object({
    supplier: clarity,
    invoice_number: clarity,
    date: clarity,
    total: clarity,
    currency: clarity,
    line_items: clarity,
  }),
})

export type SupplierBillExtraction = z.infer<typeof supplierBillExtractionSchema>

export const SUPPLIER_BILL_EXTRACTION_PROMPT = `You are extracting a supplier invoice into structured bookkeeping fields.

Read the DOCUMENT ITSELF. Do not guess. Return null when a value is not clearly printed. Do not invent products, quantities, prices, discounts, descriptions, dates, or tax.

Read the invoice line table. Return one line_items entry for each printed row. Do not merge rows. Do not replace the table with a single summary row. Keep the printed description, quantity, unit price, discount, and line total. If a column is blank or unreadable, return null for that field only.

If quantity is not printed but the row has a clear line total, return quantity null. Do not invent a quantity. Do not calculate a missing unit price.

subtotal, tax_amount, and total_amount are the printed summary figures. total_amount is the final amount payable. Do not use a line total as the invoice total. If tax is not printed, return tax_amount null. Do not invent Ghana VAT.

document_date and due_date must be ISO YYYY-MM-DD or null. Ghana commonly prints day-month-year. Do not substitute today's date.

due_date is null unless the document prints a due date or an explicit payment term that states when payment is due, such as "Due Date", "Date due", "Payable by", or "Net 30". Do not copy the issue date, sale date, or receipt date into due_date. A receipt that only shows the sale date has due_date null. The same calendar day is allowed only when a due date is itself printed. evidence.due_date is the short printed phrase that supports due_date, or null when there is no due date.

currency is the printed ISO code when shown. Ghana forms GHS, GHC, GH₵, GH¢, and ₵ mean GHS. Return null when no currency is printed.

evidence is short source text, not the whole invoice. warnings name specific reading problems. Use an empty array when there is nothing to warn about. clarity is high, medium, low, or null. It is not a probability.`

const EVIDENCE_MAX = 180
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONEY_TOLERANCE = 0.05
const MAX_LINES = 40

function blankToNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || /^(null|undefined|>null<)$/i.test(trimmed)) return null
  return trimmed
}

function clip(value: string | null): string | null {
  if (!value) return null
  return value.length > EVIDENCE_MAX ? value.slice(0, EVIDENCE_MAX) : value
}

function finiteAmount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null
  return value
}

function dueDateWasDenied(warnings: string[]): boolean {
  return warnings.some((warning) =>
    /due date/i.test(warning) && /not printed|no due|omitted|not shown|not found|unreadable|missing/i.test(warning)
  )
}

function evidenceSupportsDueDate(evidence: string | null): boolean {
  if (!evidence) return false
  return /\b(due|payable by|pay by|net\s*\d+|within\s+\d+\s+days)\b/i.test(evidence)
}

function acceptedDueDate(dueDate: string | null, evidence: string | null, warnings: string[]): string | null {
  if (!dueDate) return null
  if (dueDateWasDenied(warnings)) return null
  if (!evidenceSupportsDueDate(evidence)) return null
  return dueDate
}

function isoDateOrNull(value: string | null | undefined): string | null {
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

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function supplierBillAmountsClose(left: number, right: number): boolean {
  return Math.abs(roundMoney(left) - roundMoney(right)) <= MONEY_TOLERANCE
}

function pushWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning) && warnings.length < 12) warnings.push(warning)
}

export function normalizeSupplierBillExtraction(input: SupplierBillExtraction): SupplierBillExtraction {
  const warnings = input.warnings
    .map((item) => blankToNull(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 8)
    .map((item) => (item.length > 200 ? item.slice(0, 200) : item))

  const documentDate = isoDateOrNull(input.document_date)
  if (blankToNull(input.document_date) && !documentDate) pushWarning(warnings, "date_not_iso")
  const parsedDueDate = isoDateOrNull(input.due_date)
  if (blankToNull(input.due_date) && !parsedDueDate) pushWarning(warnings, "due_date_not_iso")
  const dueEvidence = clip(blankToNull(input.evidence.due_date))
  const dueDate = acceptedDueDate(parsedDueDate, dueEvidence, warnings)
  if (parsedDueDate && !dueDate) pushWarning(warnings, "due_date_unsupported")

  const lineItems = input.line_items.slice(0, MAX_LINES).map((line, index) => {
    const description = blankToNull(line.description)
    const quantity = finiteAmount(line.quantity)
    const unitPrice = finiteAmount(line.unit_price)
    const discount = finiteAmount(line.discount_amount)
    const lineTotal = finiteAmount(line.line_total)
    if (quantity != null && unitPrice != null && lineTotal != null) {
      const expected = roundMoney(quantity * unitPrice - (discount ?? 0))
      if (!supplierBillAmountsClose(expected, lineTotal)) {
        pushWarning(warnings, `line_${index + 1}_arithmetic`)
      }
    }
    return {
      description,
      quantity: quantity != null && quantity > 0 ? quantity : null,
      unit_price: unitPrice,
      discount_amount: discount,
      line_total: lineTotal,
    }
  })

  const printedLineSum = roundMoney(
    lineItems.reduce((sum, line) => sum + (line.line_total ?? 0), 0)
  )
  const linesWithTotals = lineItems.filter((line) => line.line_total != null).length
  const subtotal = finiteAmount(input.subtotal)
  const taxAmount = finiteAmount(input.tax_amount)
  const totalAmount = finiteAmount(input.total_amount)
  if (linesWithTotals > 0 && subtotal != null && !supplierBillAmountsClose(printedLineSum, subtotal) && !supplierBillAmountsClose(printedLineSum, totalAmount ?? printedLineSum)) {
    pushWarning(warnings, "line_sum_differs_from_subtotal")
  }
  if (subtotal != null && taxAmount != null && totalAmount != null && !supplierBillAmountsClose(subtotal + taxAmount, totalAmount)) {
    pushWarning(warnings, "subtotal_tax_differs_from_total")
  }

  return {
    document_type: input.document_type,
    supplier_name: blankToNull(input.supplier_name),
    supplier_tax_id: blankToNull(input.supplier_tax_id),
    invoice_number: blankToNull(input.invoice_number),
    document_date: documentDate,
    due_date: dueDate,
    currency: normalizeCurrencyCode(input.currency),
    line_items: lineItems,
    subtotal,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    evidence: {
      supplier: clip(blankToNull(input.evidence.supplier)),
      invoice_number: clip(blankToNull(input.evidence.invoice_number)),
      date: clip(blankToNull(input.evidence.date)),
      due_date: dueEvidence,
      total: clip(blankToNull(input.evidence.total)),
      currency: clip(blankToNull(input.evidence.currency)),
    },
    warnings,
    clarity: input.clarity,
  }
}

export type PlannedSupplierBillLine = {
  description: string
  qty: number
  unit_price: number
  discount_amount: number
}

export type SupplierBillDraft = {
  lines: PlannedSupplierBillLine[]
  fallback: boolean
  applyTaxes: boolean
  taxNote: string | null
  itemWarning: string | null
  printedTotal: number | null
  calculatedTotal: number
  blocksSave: boolean
}

export function supplierBillLineSum(
  lines: Array<{ qty: number; unit_price: number; discount_amount?: number | null }>
): number {
  return roundMoney(
    lines.reduce((sum, line) => sum + (Number(line.qty) || 0) * (Number(line.unit_price) || 0) - (Number(line.discount_amount) || 0), 0)
  )
}

export function supplierBillMismatchMessage(args: { currency: string; calculated: number; printed: number }): string {
  const code = args.currency || "GHS"
  return `Extracted line items total ${code} ${roundMoney(args.calculated).toFixed(2)}, but the invoice total is ${code} ${roundMoney(args.printed).toFixed(2)}. Review tax, discounts or missing items before saving.`
}

function priceLine(line: SupplierBillExtraction["line_items"][number]): PlannedSupplierBillLine | null {
  const description = line.description
  if (!description) return null
  const discount = line.discount_amount ?? 0
  let qty = line.quantity
  if (qty == null && line.line_total != null) qty = 1
  if (qty == null || qty <= 0) return null
  let unitPrice = line.unit_price
  if (unitPrice == null && line.line_total != null) {
    const derived = roundMoney((line.line_total + discount) / qty)
    if (supplierBillAmountsClose(qty * derived - discount, line.line_total)) unitPrice = derived
  }
  if (unitPrice == null) return null
  return { description, qty, unit_price: unitPrice, discount_amount: discount }
}

export function planSupplierBillDraft(extraction: SupplierBillExtraction, homeCurrency: string | null | undefined): SupplierBillDraft {
  const home = normalizeCurrencyCode(homeCurrency ?? null)
  const currency = extraction.currency
  const foreign = Boolean(currency && home && currency !== home)
  const readable = extraction.line_items.map(priceLine)
  const skipped = extraction.line_items.filter((line) => line.description).length - readable.filter(Boolean).length
  let lines = readable.filter((line): line is PlannedSupplierBillLine => line != null)
  let fallback = false
  let itemWarning: string | null = skipped > 0 ? "Some invoice items could not be read. Review the bill before saving." : null

  const lineSum = supplierBillLineSum(lines)
  const tax = extraction.tax_amount
  const subtotal = extraction.subtotal
  const total = extraction.total_amount
  const taxIsSeparate =
    lines.length > 0 &&
    subtotal != null &&
    tax != null &&
    tax > 0 &&
    total != null &&
    supplierBillAmountsClose(lineSum, subtotal) &&
    supplierBillAmountsClose(subtotal + tax, total) &&
    !supplierBillAmountsClose(lineSum, total)

  if (taxIsSeparate && tax != null) {
    lines = [...lines, { description: "Tax", qty: 1, unit_price: tax, discount_amount: 0 }]
  }

  if (lines.length === 0 && total != null && total > 0) {
    lines = [{ description: "Invoice total", qty: 1, unit_price: total, discount_amount: 0 }]
    fallback = true
    itemWarning = "Some invoice items could not be read. Review the bill before saving."
  }

  let applyTaxes = false
  let taxNote: string | null = null
  if (foreign) {
    applyTaxes = false
    taxNote = `${currency} is a foreign invoice currency. Ghana taxes were left off. Line amounts stay in ${currency}, and the exchange rate is still entered separately.`
  } else if (taxIsSeparate) {
    applyTaxes = false
    taxNote = "Printed tax was kept as its own line so the bill total matches the invoice. Apply Taxes is off so Finza does not reverse-calculate a second Ghana VAT from that total."
  } else if (tax == null || tax === 0) {
    applyTaxes = false
    taxNote = "No tax was printed, so Ghana taxes were left off."
  } else if (total != null) {
    const reversed = calculateBaseFromTotalIncludingTaxes(total, true, extraction.document_date || undefined)
    if (supplierBillAmountsClose(reversed.taxBreakdown.totalTax, tax)) {
      applyTaxes = true
      taxNote = "These line amounts already add up to the invoice total. Ghana taxes stay on and are reverse-calculated from that total, which does not change the amount payable."
    } else {
      applyTaxes = false
      taxNote = "Printed tax does not match Ghana's inclusive tax split, so Apply Taxes was turned off. The amount payable still follows the invoice. Finza cannot post a custom printed VAT amount to input VAT without changing ledger rules."
    }
  }

  const calculatedTotal = supplierBillLineSum(lines)
  const blocksSave = total != null && lines.length > 0 && !supplierBillAmountsClose(calculatedTotal, total)

  return {
    lines,
    fallback,
    applyTaxes,
    taxNote,
    itemWarning,
    printedTotal: total,
    calculatedTotal,
    blocksSave,
  }
}
