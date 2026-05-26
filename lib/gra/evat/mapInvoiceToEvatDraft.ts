/**
 * Pure mapper: Finza invoice-shaped input → internal GRA E-VAT outbound draft (preview).
 * No HTTP, no Supabase, no secrets. Submission eligibility: `submittable` when enrollment is approved and `blockingIssues` is empty.
 */

import type { BusinessGraEvatEnrollmentRow } from "./enrollment"

export type EvatDraftTaxMeta = Record<string, unknown>

export type EvatMappedTaxLine = {
  code: string
  name?: string
  amount: number
  rate?: number
  meta: EvatDraftTaxMeta
}

export type EvatDraftProductTaxCategory = string | { code?: string; name?: string }

export type EvatDraftInvoiceItemInput = {
  id: string
  product_id?: string | null
  sku?: string | null
  code?: string | null
  description?: string | null
  name?: string | null
  quantity: number
  unit_price: number
  line_total: number
  product_tax_category?: EvatDraftProductTaxCategory | null
  gra_item_category?: string | null
}

export type EvatDraftSellerInput = {
  business_id: string
  name?: string | null
  tin?: string | null
  tax_id?: string | null
  country?: string | null
}

export type EvatDraftBuyerInput = {
  name?: string | null
  tin?: string | null
  tax_id?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

export type EvatDraftInvoiceInput = {
  id: string
  invoice_number?: string | null
  reference?: string | null
  issue_date?: string | null
  created_at?: string | null
  currency: string
  subtotal: number
  total_tax: number
  total: number
  tax_lines: unknown
  seller: EvatDraftSellerInput
  buyer: EvatDraftBuyerInput
  items: EvatDraftInvoiceItemInput[]
  /** When provided, drives `submittable` together with `blockingIssues`. */
  enrollment?: Pick<BusinessGraEvatEnrollmentRow, "enrollment_status"> | null
}

export type EvatDraftWarningCode =
  | "evat_not_approved"
  | "missing_seller_tin"
  | "missing_buyer_tin"
  | "missing_gra_field_name_for_levy"
  | "missing_vat_schedule_metadata"
  | "missing_item_code"
  | "missing_item_category"
  | "tax_total_mismatch"
  | "unclassified_tax_line"
  | "no_tax_lines"

/** @deprecated Use EvatDraftWarningCode */
export type EvatInvoiceDraftWarning = EvatDraftWarningCode

/** Codes that prevent E-VAT submission when present (subset of `warnings`). */
export const EVAT_DRAFT_BLOCKING_ISSUE_CODES: readonly EvatDraftWarningCode[] = [
  "evat_not_approved",
  "missing_seller_tin",
  "tax_total_mismatch",
  "unclassified_tax_line",
  "no_tax_lines",
] as const

const BLOCKING_ISSUE_SET = new Set<string>(EVAT_DRAFT_BLOCKING_ISSUE_CODES)

export type EvatInvoiceDraft = {
  source: "finza_invoice"
  submittable: boolean
  invoice: {
    id: string
    number: string | null
    date: string | null
    currency: string
  }
  seller: {
    business_id: string
    name: string | null
    tin: string | null
    country: string | null
  }
  buyer: {
    name: string | null
    tin: string | null
    address: string | null
    phone: string | null
    email: string | null
  }
  items: Array<{
    id: string
    internalItemCode: string | null
    description: string | null
    quantity: number
    unit_price: number
    line_total: number
    gra_item_category: string | null
    product_tax_category: string | null
  }>
  taxes: {
    levies: EvatMappedTaxLine[]
    vat: EvatMappedTaxLine[]
    totalLevies: number
    totalVat: number
    totalTax: number
  }
  totals: {
    subtotal: number
    invoiceTotal: number
    storedTotalTax: number
    mappedTotalTax: number
    taxDifference: number
  }
  /** All issue codes (blocking + non-blocking), deduped. */
  warnings: EvatDraftWarningCode[]
  /** Blocking subset of `warnings`; `submittable` requires this to be empty when enrolled. */
  blockingIssues: EvatDraftWarningCode[]
}

const LEVY_CODES = new Set(["NHIL", "GETFUND", "GETFUND_LEVY", "COVID", "CST", "TOURISM"])

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function parseJsonbRoot(jsonb: unknown): unknown {
  if (jsonb == null) return null
  if (typeof jsonb === "string") {
    try {
      return JSON.parse(jsonb)
    } catch {
      return null
    }
  }
  return jsonb
}

/**
 * Same line-array resolution priority as jsonbToTaxResult, but returns raw rows (preserves meta).
 */
export function extractRawInvoiceTaxLinesForEvat(tax_lines: unknown): any[] {
  const root = parseJsonbRoot(tax_lines)
  if (root == null) return []
  if (Array.isArray(root)) return root
  if (typeof root !== "object") return []

  const o = root as Record<string, unknown>
  const linesArr = Array.isArray(o.lines) ? (o.lines as any[]) : null
  const taxLinesArr = Array.isArray(o.tax_lines) ? (o.tax_lines as any[]) : null

  if (linesArr && linesArr.length > 0) return linesArr
  if (taxLinesArr && taxLinesArr.length > 0) return taxLinesArr
  if (taxLinesArr && taxLinesArr.length === 0) return taxLinesArr
  if (linesArr && linesArr.length === 0) {
    return []
  }
  return []
}

function normalizeMeta(raw: unknown): EvatDraftTaxMeta {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) }
  }
  return {}
}

function normalizeTaxLine(raw: any): EvatMappedTaxLine | null {
  const code = raw?.code != null ? String(raw.code).trim() : ""
  if (!code) return null
  const amount = Number(raw?.amount)
  const amt = Number.isFinite(amount) ? round2(amount) : 0
  const rateRaw = Number(raw?.rate)
  const rate = Number.isFinite(rateRaw) ? rateRaw : undefined
  const name = raw?.name != null ? String(raw.name) : undefined
  const meta = normalizeMeta(raw?.meta)
  const out: EvatMappedTaxLine = { code, amount: amt, meta }
  if (rate !== undefined) out.rate = rate
  if (name !== undefined) out.name = name
  return out
}

function graFieldName(meta: EvatDraftTaxMeta): string | null {
  const v = meta.gra_field_name
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null
}

function graLevySlot(meta: EvatDraftTaxMeta): string | null {
  const v = meta.gra_levy_slot
  if (v == null) return null
  const s = String(v).trim()
  return s !== "" ? s : null
}

function isLevyLine(line: EvatMappedTaxLine): boolean {
  const code = line.code.toUpperCase()
  if (LEVY_CODES.has(code)) return true
  const gfn = graFieldName(line.meta)
  if (gfn && gfn.toLowerCase().startsWith("levy")) return true
  if (graLevySlot(line.meta) != null) return true
  return false
}

function isVatLine(line: EvatMappedTaxLine): boolean {
  return line.code.toUpperCase() === "VAT"
}

function hasVatScheduleMetadata(meta: EvatDraftTaxMeta): boolean {
  if (graFieldName(meta) != null) return true
  const tlid = meta.tax_schedule_line_id
  if (typeof tlid === "string" && tlid.trim() !== "") return true
  const tsid = meta.tax_schedule_id
  if (typeof tsid === "string" && tsid.trim() !== "") return true
  return false
}

function resolveSellerTin(s: EvatDraftSellerInput): string | null {
  const a = s.tin?.trim()
  const b = s.tax_id?.trim()
  return (a || b || null) as string | null
}

function resolveBuyerTin(b: EvatDraftBuyerInput): string | null {
  const x = b.tin?.trim()
  const y = b.tax_id?.trim()
  return (x || y || null) as string | null
}

function formatProductTaxCategory(c: EvatDraftProductTaxCategory | null | undefined): string | null {
  if (c == null) return null
  if (typeof c === "string") return c.trim() || null
  const code = c.code?.trim()
  const name = c.name?.trim()
  return (code || name || null) as string | null
}

function resolveInternalItemCode(item: EvatDraftInvoiceItemInput): {
  code: string | null
  warning: boolean
} {
  const sku = item.sku?.trim()
  const code = item.code?.trim()
  const pid = item.product_id?.trim()
  const id = item.id?.trim()
  if (sku) return { code: sku, warning: false }
  if (code) return { code, warning: false }
  if (pid) return { code: pid, warning: false }
  if (id) return { code: id, warning: false }
  return { code: null, warning: true }
}

function resolveItemCategory(item: EvatDraftInvoiceItemInput): {
  gra: string | null
  productTax: string | null
  warnCategory: boolean
} {
  const gra = item.gra_item_category?.trim() || null
  const ptc = formatProductTaxCategory(item.product_tax_category ?? null)
  if (gra) return { gra, productTax: ptc, warnCategory: false }
  if (ptc) return { gra: null, productTax: ptc, warnCategory: false }
  return { gra: null, productTax: null, warnCategory: true }
}

function invoiceNumber(input: EvatDraftInvoiceInput): string | null {
  const n = input.invoice_number?.trim()
  const r = input.reference?.trim()
  return n || r || null
}

function invoiceDate(input: EvatDraftInvoiceInput): string | null {
  const i = input.issue_date?.trim()
  const c = input.created_at?.trim()
  return i || c || null
}

export function mapInvoiceToEvatDraft(input: EvatDraftInvoiceInput): EvatInvoiceDraft {
  const warnings: EvatDraftWarningCode[] = []

  const enrollmentStatus = input.enrollment?.enrollment_status
  if (!enrollmentStatus || enrollmentStatus !== "approved") {
    warnings.push("evat_not_approved")
  }

  const sellerTin = resolveSellerTin(input.seller)
  if (!sellerTin) warnings.push("missing_seller_tin")

  const buyerTin = resolveBuyerTin(input.buyer)
  if (!buyerTin) warnings.push("missing_buyer_tin")

  const rawLines = extractRawInvoiceTaxLinesForEvat(input.tax_lines)
  if (rawLines.length === 0 && input.tax_lines != null && input.total_tax > 0.005) {
    warnings.push("no_tax_lines")
  }

  const normalized: EvatMappedTaxLine[] = []
  for (const raw of rawLines) {
    const n = normalizeTaxLine(raw)
    if (n) normalized.push(n)
  }

  const levies: EvatMappedTaxLine[] = []
  const vatLines: EvatMappedTaxLine[] = []

  for (const line of normalized) {
    if (isVatLine(line)) {
      if (!hasVatScheduleMetadata(line.meta)) {
        warnings.push("missing_vat_schedule_metadata")
      }
      vatLines.push(line)
      continue
    }
    if (isLevyLine(line)) {
      if (!graFieldName(line.meta)) {
        warnings.push("missing_gra_field_name_for_levy")
      }
      levies.push(line)
      continue
    }
    warnings.push("unclassified_tax_line")
  }

  const totalLevies = round2(levies.reduce((s, l) => s + l.amount, 0))
  const totalVat = round2(vatLines.reduce((s, l) => s + l.amount, 0))
  const mappedTotalTax = round2(totalLevies + totalVat)

  const storedTotalTax = round2(Number(input.total_tax) || 0)
  const taxDifference = round2(storedTotalTax - mappedTotalTax)
  if (Math.abs(taxDifference) > 0.01) {
    warnings.push("tax_total_mismatch")
  }

  const mappedItems: EvatInvoiceDraft["items"] = []
  for (const it of input.items) {
    const { code: internalItemCode, warning: missCode } = resolveInternalItemCode(it)
    if (missCode) warnings.push("missing_item_code")

    const cat = resolveItemCategory(it)
    if (cat.warnCategory) warnings.push("missing_item_category")

    const desc = it.description?.trim() || it.name?.trim() || null
    mappedItems.push({
      id: it.id,
      internalItemCode,
      description: desc,
      quantity: it.quantity,
      unit_price: round2(it.unit_price),
      line_total: round2(it.line_total),
      gra_item_category: cat.gra,
      product_tax_category: cat.productTax,
    })
  }

  const uniqueWarnings = Array.from(new Set(warnings))
  const blockingIssues = uniqueWarnings.filter((w) => BLOCKING_ISSUE_SET.has(w))

  const submittable = enrollmentStatus === "approved" && blockingIssues.length === 0

  return {
    source: "finza_invoice",
    submittable,
    invoice: {
      id: input.id,
      number: invoiceNumber(input),
      date: invoiceDate(input),
      currency: input.currency.trim() || "GHS",
    },
    seller: {
      business_id: input.seller.business_id,
      name: input.seller.name?.trim() ?? null,
      tin: sellerTin,
      country: input.seller.country?.trim() ?? null,
    },
    buyer: {
      name: input.buyer.name?.trim() ?? null,
      tin: buyerTin,
      address: input.buyer.address?.trim() ?? null,
      phone: input.buyer.phone?.trim() ?? null,
      email: input.buyer.email?.trim() ?? null,
    },
    items: mappedItems,
    taxes: {
      levies,
      vat: vatLines,
      totalLevies,
      totalVat,
      totalTax: mappedTotalTax,
    },
    totals: {
      subtotal: round2(input.subtotal),
      invoiceTotal: round2(input.total),
      storedTotalTax,
      mappedTotalTax,
      taxDifference,
    },
    warnings: uniqueWarnings,
    blockingIssues,
  }
}
