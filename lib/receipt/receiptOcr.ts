/**
 * Shared receipt OCR — Africa-ready heuristics, suggestion-only.
 * No DB writes, no ledger, no account decisions.
 * Provider abstraction allows plugging real OCR/Vision later.
 */

export type DocumentType = "expense" | "supplier_bill"

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW"

export type ReceiptOcrSuggestions = {
  supplier_name?: string
  document_number?: string
  document_date?: string
  currency_code?: string
  subtotal?: number
  vat_amount?: number
  nhil_amount?: number
  getfund_amount?: number
  covid_amount?: number
  total?: number
  line_items?: Array<{
    description?: string
    qty?: number
    unit_price?: number
    amount?: number
  }>
}

export type ReceiptOcrConfidence = {
  supplier_name?: ConfidenceLevel
  document_date?: ConfidenceLevel
  total?: ConfidenceLevel
}

export type ReceiptOcrResult = {
  suggestions: ReceiptOcrSuggestions
  confidence: ReceiptOcrConfidence
}

export interface ReceiptOcrProvider {
  extractText(imageDataUrl: string): Promise<string>
}

const NOISE_WORDS = /^(receipt|invoice|bill|tel|tin|vat|v\.a\.t|nhil|getfund|covid|total|subtotal|amount|due|paid|change|tendered|cash)$/i
const SUPPLIER_NOISE = /^(official\s+receipt|customer\s+particulars|date\s*:?|amount\s*:?|receipt\s*#|invoice\s*#|bill\s*#|mobile\s*money|ref\s*:?|reference)$/i

const CURRENCY_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /GH[S¢₵]|GHS|₵|Cedi/i, code: "GHS" },
  { re: /₦|NGN/i, code: "NGN" },
  { re: /KES|KSh/i, code: "KES" },
  { re: /UGX/i, code: "UGX" },
  { re: /TZS|TSh/i, code: "TZS" },
  { re: /ZAR|R\s/i, code: "ZAR" },
  { re: /CFA|XOF|XAF/i, code: "XOF" },
]

const ALL_CCY = `(?:GH[S¢₵]|GHS|₵|Cedi|₦|NGN|KES|KSh|UGX|TZS|TSh|ZAR|CFA|XOF|XAF)`
// (?<!SUB-) avoids matching "TOTAL" inside "SUB-TOTAL" (prefer GRAND TOTAL / real final total).
const TOTAL_LABELS = new RegExp(
  `\\b(Grand Total|(?<!SUB-)TOTAL|Amount Due|Balance Due|Net Total|Amount Payable|AMOUNT)\\s*[:]?\\s*${ALL_CCY}?\\s*([\\d,]+\\.?\\d*)`,
  "gi"
)
const AMOUNT_LINE = new RegExp(`\\bAMOUNT\\s*:\\s*${ALL_CCY}?\\s*([\\d,]+\\.?\\d*)`, "gi")
const CURRENCY_AMOUNT = new RegExp(`${ALL_CCY}\\s*([\\d,]+\\.?\\d*)|([\\d,]+\\.?\\d*)\\s*${ALL_CCY}`, "gi")
const TENDERED_LABELS = /\b(Tendered|Cash|Change)\s*[:]?\s*([\d,]+\.?\d*)/gi

const MONTH_NAMES: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
}

const DATE_PATTERNS: Array<{ re: RegExp; fn: (m: RegExpMatchArray) => string | null }> = [
  { re: /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/, fn: (m) => `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` },
  { re: /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, fn: (m) => `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` },
  { re: /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i, fn: (m) => { const mon = MONTH_NAMES[m[2]!.toLowerCase().slice(0, 3)]; return mon ? `${m[3]}-${mon}-${m[1]!.padStart(2, "0")}` : null } },
  { re: /(?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\s*,?\s*(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s*,?\s*(\d{4})/i, fn: (m) => { const mon = MONTH_NAMES[m[2]!.toLowerCase()]; return mon ? `${m[3]}-${mon}-${m[1]!.padStart(2, "0")}` : null } },
  { re: /(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s*,?\s*(\d{4})/i, fn: (m) => { const mon = MONTH_NAMES[m[2]!.toLowerCase()]; return mon ? `${m[3]}-${mon}-${m[1]!.padStart(2, "0")}` : null } },
  { re: /DATE\s*:\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\s*,?\s*(\d{1,2})\s+(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s*,?\s*(\d{4})/i, fn: (m) => { const mon = MONTH_NAMES[m[2]!.toLowerCase()]; return mon ? `${m[3]}-${mon}-${m[1]!.padStart(2, "0")}` : null } },
]

const DOC_NUMBER_PATTERNS = [
  /(?:OFFICIAL\s+)?RECEIPT\s*#\s*:\s*([0-9]+)/i,
  /#\s*:\s*([0-9]+)/,
  /(?:Invoice|Receipt|Bill)\s*No\.?\s*[:]?\s*([A-Z0-9\-]+)/i,
  /No\.?\s*[:]?\s*([A-Z0-9\-]+)/i,
]

// Optional "(15%)" / "(2.5%)" and optional GHS/₵ before amount (thermal receipts).
const VAT_PATTERN =
  /\b(?:VAT|V\.A\.T|Tax)(?:\s*\([^)]*\))?\s*[:]?\s*(?:GHS|GH¢|₵|[A-Z]{3})?\s*([\d,]+\.?\d*)/gi
const NHIL_PATTERN =
  /\bNHIL(?:\s*\([^)]*\))?\s*[:]?\s*(?:GHS|GH¢|₵)?\s*([\d,]+\.?\d*)/gi
const GETFUND_PATTERN =
  /\b(?:GETFund|GET\s+Fund)\s*(?:\([^)]*\))?\s*[:]?\s*(?:GHS|GH¢|₵)?\s*([\d,]+\.?\d*)/gi
const COVID_PATTERN = /\bCOVID\s*(?:Levy)?\s*[:]?\s*([\d,]+\.?\d*)/gi

function parseNumber(s: string): number | undefined {
  const n = parseFloat(s.replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : undefined
}

function isPlausibleDate(iso: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  const future = new Date(now)
  future.setDate(future.getDate() + 7)
  return d <= future
}

function parseDate(text: string): { value: string; confidence: ConfidenceLevel } | undefined {
  const hasExplicitDateLine = /\bDATE\s*:/i.test(text)
  for (const { re, fn } of DATE_PATTERNS) {
    const m = text.match(re)
    if (m) {
      const iso = fn(m)
      if (iso && isPlausibleDate(iso)) {
        const confidence = hasExplicitDateLine ? "HIGH" : "MEDIUM"
        return { value: iso, confidence }
      }
      if (iso) return { value: iso, confidence: "LOW" }
    }
  }
  return undefined
}

function detectCurrency(text: string, businessCurrency?: string): string | undefined {
  for (const { re, code } of CURRENCY_PATTERNS) {
    if (re.test(text)) return code
  }
  return businessCurrency || "GHS"
}

function extractTotal(text: string): { value: number; confidence: ConfidenceLevel } | undefined {
  const candidates: Array<{ value: number; label: string; isAmountLine: boolean }> = []
  let m: RegExpExecArray | null
  const totalRe = new RegExp(TOTAL_LABELS.source, "gi")
  while ((m = totalRe.exec(text)) !== null) {
    const value = parseNumber(m[2] ?? m[3] ?? "")
    if (value != null && value > 0) candidates.push({ value, label: (m[1] || "").toUpperCase(), isAmountLine: /AMOUNT/i.test(m[1] || "") })
  }
  const amountRe = new RegExp(AMOUNT_LINE.source, "gi")
  while ((m = amountRe.exec(text)) !== null) {
    const value = parseNumber(m[1]!)
    if (value != null && value > 0) candidates.push({ value, label: "AMOUNT", isAmountLine: true })
  }
  // Multi-line totals: label on one line, amount (optionally prefixed with currency) on the next
  if (candidates.length === 0) {
    const labelOnlyRe =
      /^\s*(Grand\s+Total|(?<!SUB-)TOTAL|Amount\s+Due|Balance\s+Due|Net\s+Total|Amount\s+Payable|AMOUNT)\s*[:]?\s*$/i
    const amountOnlyRe = new RegExp(`^${ALL_CCY}?\\s*([\\d,]+\\.?\\d*)\\s*${ALL_CCY}?$`)
    const splitLines = text.split(/\r?\n/)
    for (let i = 0; i < splitLines.length - 1; i++) {
      if (labelOnlyRe.test(splitLines[i]!)) {
        const next = (splitLines[i + 1] ?? "").trim()
        const nm = next.match(amountOnlyRe)
        if (nm && nm[1]) {
          const value = parseNumber(nm[1])
          if (value != null && value > 0) candidates.push({ value, label: "TOTAL", isAmountLine: false })
        }
      }
    }
  }
  if (candidates.length === 0) {
    const currencyAmountRe = new RegExp(CURRENCY_AMOUNT.source, "gi")
    while ((m = currencyAmountRe.exec(text)) !== null) {
      const value = parseNumber(m[1] || m[2] || "")
      if (value != null && value > 0) candidates.push({ value, label: "CURRENCY", isAmountLine: false })
    }
  }
  if (candidates.length === 0) {
    const tenderedRe = new RegExp(TENDERED_LABELS.source, "gi")
    while ((m = tenderedRe.exec(text)) !== null) {
      const value = parseNumber(m[2]!)
      if (value != null && value > 0) candidates.push({ value, label: m[1]!, isAmountLine: false })
    }
  }
  const preferred = candidates.find((c) => c.isAmountLine || /TOTAL|Grand|Amount Due|Balance|Net|Payable|AMOUNT/.test(c.label))
  const fallback = candidates.filter((c) => !/Change|Tendered|Cash/.test(c.label))
  const pick = preferred ?? (fallback.length ? fallback.reduce((a, b) => (a.value > b.value ? a : b)) : null) ?? candidates[0]
  if (!pick) return undefined
  const confidence = pick.isAmountLine || /TOTAL|AMOUNT|Amount Due/.test(pick.label) ? "HIGH" : fallback.length ? "MEDIUM" : "LOW"
  return { value: pick.value, confidence }
}

/** City/country line (e.g. ACCRA, GHANA) — not the trading name */
const ADDRESS_LINE_GHANA = /^\s*[A-Z][A-Z\s]{2,},\s*GHANA\s*$/i

/** Legal / business entity markers (do NOT include bare country names — they match addresses). */
const COMPANY_LEGAL_MARKERS =
  /\b(LTD|LIMITED|LLC|L\.L\.C\.|INC\.?|PLC|G\.?L\.?T\.?C\.|ENTERPRISE|ENTERPRISES|CORPORATION|CORP\.|GROUP|HOLDINGS|HOLDING|SERVICES|SERVICE|CONSULT|CONSULTANTS|PARTNERS|PARTNERSHIP|CO\.|COMPANY|STORES?|SHOP|TRADING|SUPPLIES|WORKS|AGENCY|VENTURES)\b/i

const STREET_ADDRESS_HINT =
  /\b(street|st\.|road|rd\.|avenue|ave\.|boulevard|blvd|close|lane|ln\.|drive|dr\.|highway|hwy|crescent|cr\.|junction|jcn|plot|p\/lot|ring\s+road|spintex|n1\s|motorway|way|court|place|terrace|estate|area|zone|district|region|gps\s*address|digital\s*address)\b/i

const PO_BOX = /\bP\.?\s*O\.?\s*BOX|POST\s*OFFICE\s*BOX|POB\s*#?\s*\d|\bBOX\s*\d+\b/i

const PHONE_LINE =
  /^(?:\+|00)?[\d\s().-]{10,}$|^(?:tel|phone|mobile|cell|momo|whatsapp|fax)\s*[:#]?\s*[\d+]/i

const EMAIL_OR_URL = /@\S+\.\S+|https?:\/\/\S+/i

const POSTAL_CODE_LIKE = /\b(?:GA|GX)[- ]?\d{3}[- ]?\d{4}\b|\b\d{5}(?:-\d{4})?\b/

const TRADING_OR_PARTY_LABEL =
  /^(?:merchant|supplier|business|vendor|sold\s+by|from|bill\s*to|customer|client|payee|trading\s+name)\s*[:#.\-]\s*(.+)$/i

const FINZA_BOILERPLATE_LINE =
  /^\s*(finza|finza\s+service|powered\s+by\s+finza|www\.finza|app\.finza|receipt\s*#|payment\s+receipt)\s*$/i

/** Single-line tax / subtotal fragments (not a supplier). */
const TAX_OR_FIGURE_HEAD_LINE =
  /^(?:VAT|NHIL|GET\s*Fund|GETFund|COVID|SUB-?TOTAL|TOTAL|AMOUNT|GHS|₵|NGN|KES)\b/i

function digitAndPunctRatio(t: string): number {
  const compact = t.replace(/\s/g, "")
  if (!compact.length) return 1
  let n = 0
  for (const ch of compact) {
    if (/[\d.,#\-/():]/.test(ch)) n++
  }
  return n / compact.length
}

function isLikelyAddressOrContactLine(t: string): boolean {
  const s = t.trim()
  if (s.length < 3) return true
  if (ADDRESS_LINE_GHANA.test(s)) return true
  if (EMAIL_OR_URL.test(s)) return true
  if (PHONE_LINE.test(s)) return true
  if (PO_BOX.test(s)) return true
  if (POSTAL_CODE_LIKE.test(s)) return true
  if (digitAndPunctRatio(s) >= 0.55) return true

  // Numbered / plot / No. lines with a street cue (e.g. "12 Independence Ave", "Plot 15 Ring Road", "No. 8 Highway")
  if (
    STREET_ADDRESS_HINT.test(s) &&
    (/^\d+[A-Za-z]?\s+/.test(s) || /\bplot\s+\d+/i.test(s) || /\bno\.?\s*\d+/i.test(s))
  ) {
    return true
  }
  // Multi-clause address blocks: several commas + location words
  const commaCount = (s.match(/,/g) ?? []).length
  if (commaCount >= 2 && (STREET_ADDRESS_HINT.test(s) || /\b(accra|kumasi|tema|takoradi|lagos|nairobi)\b/i.test(s))) {
    return true
  }
  // "City, Country" without matching strict ACCRA, GHANA pattern
  if (commaCount >= 1 && /\b(ghana|nigeria|kenya|uganda|tanzania|south africa)\b/i.test(s) && !COMPANY_LEGAL_MARKERS.test(s)) {
    return true
  }
  return false
}

function trySupplierFromLabeledLine(lines: string[]): string | undefined {
  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const raw = lines[i]!.trim()
    const m = raw.match(TRADING_OR_PARTY_LABEL)
    if (!m?.[1]) continue
    const v = m[1].trim()
    if (v.length < 2 || v.length > 120) continue
    if (isLikelyAddressOrContactLine(v)) continue
    return v
  }
  return undefined
}

function textLooksFinzaServiceReceipt(lines: string[]): boolean {
  const head = lines.slice(0, 15).join("\n").toLowerCase()
  if (!/\bfinza\b/.test(head)) return false
  return /\b(receipt|payment|invoice|service)\b/.test(head)
}

function scoreSupplierCandidate(t: string, lineIndex: number, lines: string[]): number {
  if (t.length < 3 || t.length > 120) return -1e6
  if (NOISE_WORDS.test(t)) return -1e6
  if (SUPPLIER_NOISE.test(t)) return -1e6
  if (/^\d+$/.test(t)) return -1e6
  if (/^#\s*:|RECEIPT\s*#|DATE\s*:|AMOUNT\s*:/i.test(t)) return -1e6
  if (FINZA_BOILERPLATE_LINE.test(t)) return -1e6
  if (TAX_OR_FIGURE_HEAD_LINE.test(t)) return -1e6
  if (isLikelyAddressOrContactLine(t)) return -1e6

  let score = 0
  // Earlier lines are more likely to be the legal/trading header.
  score += Math.max(0, 14 - lineIndex) * 3

  const hasCompanyMarker = COMPANY_LEGAL_MARKERS.test(t)
  if (hasCompanyMarker) score += 40

  const isAllCaps = t === t.toUpperCase() && /[A-Z]/.test(t) && /[A-Z]{3,}/.test(t)
  const hasMixedCaseBusinessShape = /[a-z]/.test(t) && /[A-Z]/.test(t) && /[A-Za-z]{3,}/.test(t)
  if (isAllCaps && hasCompanyMarker) score += 15
  if (hasMixedCaseBusinessShape && !isLikelyAddressOrContactLine(t)) score += 8

  const wordCount = t.split(/\s+/).filter(Boolean).length
  if (wordCount >= 2 && wordCount <= 10) score += 5
  if (wordCount > 14) score -= 10

  if (textLooksFinzaServiceReceipt(lines)) {
    if (lineIndex <= 2 && !/\bfinza\b/i.test(t)) score += 18
    if (/\bfinza\b/i.test(t)) score -= 25
  }

  return score
}

function confidenceFromScore(score: number, hasCompanyMarker: boolean): ConfidenceLevel {
  if (score >= 75) return "HIGH"
  if (score >= 50 || hasCompanyMarker) return "MEDIUM"
  return "LOW"
}

function extractSupplierName(lines: string[]): { value: string; confidence: ConfidenceLevel } | undefined {
  const labeled = trySupplierFromLabeledLine(lines)
  if (labeled) {
    const conf: ConfidenceLevel = COMPANY_LEGAL_MARKERS.test(labeled) ? "HIGH" : "MEDIUM"
    return { value: labeled, confidence: conf }
  }

  const scan = lines.slice(0, 14)
  let bestLine: string | null = null
  let bestScore = -Infinity

  for (let i = 0; i < scan.length; i++) {
    const t = scan[i]!.trim()
    const s = scoreSupplierCandidate(t, i, lines)
    if (s > bestScore) {
      bestScore = s
      bestLine = t
    }
  }

  if (bestLine && bestScore > -1e5) {
    return {
      value: bestLine,
      confidence: confidenceFromScore(bestScore, COMPANY_LEGAL_MARKERS.test(bestLine)),
    }
  }

  // Weak fallback: first short non-excluded line (e.g. sole proprietor without LTD).
  for (const line of lines.slice(0, 8)) {
    const t = line.trim()
    if (t.length < 3 || t.length > 100) continue
    if (NOISE_WORDS.test(t) || SUPPLIER_NOISE.test(t)) continue
    if (TAX_OR_FIGURE_HEAD_LINE.test(t)) continue
    if (isLikelyAddressOrContactLine(t)) continue
    if (FINZA_BOILERPLATE_LINE.test(t)) continue
    return { value: t, confidence: "LOW" }
  }

  return undefined
}

function extractDocumentNumber(text: string): string | undefined {
  for (const re of DOC_NUMBER_PATTERNS) {
    const m = text.match(re)
    if (m && m[1]) return m[1].trim()
  }
  return undefined
}

function extractVat(text: string): number | undefined {
  const m = VAT_PATTERN.exec(text)
  VAT_PATTERN.lastIndex = 0
  if (m && m[1]) return parseNumber(m[1])
  return undefined
}

function extractNhil(text: string): number | undefined {
  const m = NHIL_PATTERN.exec(text)
  NHIL_PATTERN.lastIndex = 0
  if (m && m[1]) return parseNumber(m[1])
  return undefined
}

function extractGetfund(text: string): number | undefined {
  const m = GETFUND_PATTERN.exec(text)
  GETFUND_PATTERN.lastIndex = 0
  if (m && m[1]) return parseNumber(m[1])
  return undefined
}

function extractCovid(text: string): number | undefined {
  const m = COVID_PATTERN.exec(text)
  COVID_PATTERN.lastIndex = 0
  if (m && m[1]) return parseNumber(m[1])
  return undefined
}

function stubReceiptTextForDev(): string {
  const d = new Date()
  const iso = d.toISOString().split("T")[0]
  return [
    "Receipt supplier",
    "Invoice No: INV-001",
    `Date: ${iso.split("-").reverse().join("/")}`,
    "VAT 125.00",
    "NHIL 20.83",
    "GETFund 20.83",
    "TOTAL GHS 1000.00",
  ].join("\n")
}

/** Set RECEIPT_OCR_USE_STUB=true to skip Tesseract (faster local dev, no WASM download). */
const defaultProvider: ReceiptOcrProvider = {
  async extractText(imageDataUrl: string): Promise<string> {
    if (!imageDataUrl?.startsWith("data:")) return ""
    if (process.env.RECEIPT_OCR_USE_STUB === "true") {
      return stubReceiptTextForDev()
    }
    try {
      const { extractTextWithTesseract } = await import("./tesseractReceiptOcr")
      return await extractTextWithTesseract(imageDataUrl)
    } catch (e) {
      console.error("[receipt-ocr] Tesseract OCR failed:", e)
      return ""
    }
  },
}

let provider: ReceiptOcrProvider = defaultProvider

export function setReceiptOcrProvider(p: ReceiptOcrProvider): void {
  provider = p
}

export function getReceiptOcrProvider(): ReceiptOcrProvider {
  return provider
}

export function parseReceiptText(
  text: string,
  _documentType: DocumentType,
  businessCurrency?: string
): ReceiptOcrResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const suggestions: ReceiptOcrSuggestions = {}
  const confidence: ReceiptOcrConfidence = {}

  const currencyCode = detectCurrency(text, businessCurrency)
  suggestions.currency_code = currencyCode

  const supplier = extractSupplierName(lines)
  if (supplier) {
    suggestions.supplier_name = supplier.value
    confidence.supplier_name = supplier.confidence
  }

  const docNum = extractDocumentNumber(text)
  if (docNum) suggestions.document_number = docNum

  const dateResult = parseDate(text)
  if (dateResult) {
    suggestions.document_date = dateResult.value
    confidence.document_date = dateResult.confidence
  }

  const totalResult = extractTotal(text)
  if (totalResult) {
    suggestions.total = totalResult.value
    confidence.total = totalResult.confidence
  }

  const vat = extractVat(text)
  if (vat != null) suggestions.vat_amount = vat
  const nhil = extractNhil(text)
  if (nhil != null) suggestions.nhil_amount = nhil
  const getfund = extractGetfund(text)
  if (getfund != null) suggestions.getfund_amount = getfund
  const covid = extractCovid(text)
  if (covid != null) suggestions.covid_amount = covid

  if (suggestions.total != null) {
    const taxSum = (suggestions.vat_amount ?? 0) + (suggestions.nhil_amount ?? 0) + (suggestions.getfund_amount ?? 0) + (suggestions.covid_amount ?? 0)
    suggestions.subtotal = suggestions.total - taxSum
  }

  return { suggestions, confidence }
}

export type ExtractReceiptSuggestionsParams = {
  imageDataUrl: string
  documentType: DocumentType
  businessCurrency?: string
}

export async function extractReceiptSuggestions(
  params: ExtractReceiptSuggestionsParams
): Promise<ReceiptOcrResult> {
  const { imageDataUrl, documentType, businessCurrency } = params
  const rawText = await provider.extractText(imageDataUrl)
  return parseReceiptText(rawText, documentType, businessCurrency)
}
