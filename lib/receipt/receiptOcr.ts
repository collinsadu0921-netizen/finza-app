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

export type ReceiptFieldSources = {
  supplier_name?: string
  document_date?: string
  total?: string
  currency_code?: string
}

export type ReceiptOcrResult = {
  suggestions: ReceiptOcrSuggestions
  confidence: ReceiptOcrConfidence
  /** Line or snippet that produced each field. Review aid only. */
  field_sources?: ReceiptFieldSources
  warnings?: string[]
}

export interface ReceiptOcrProvider {
  extractText(imageDataUrl: string): Promise<string>
}

const NOISE_WORDS = /^(receipt|invoice|bill|tel|tin|vat|v\.a\.t|nhil|getfund|covid|total|subtotal|amount|due|paid|change|tendered|cash)$/i
const SUPPLIER_NOISE = /^(official\s+receipt|customer\s+particulars|date\s*:?|amount\s*:?|receipt\s*#|invoice\s*#|bill\s*#|mobile\s*money|ref\s*:?|reference)$/i

const CURRENCY_PATTERNS: Array<{ re: RegExp; code: string }> = [
  { re: /GH[CS¢₵]|GHS|GHC|₵|Cedi/i, code: "GHS" },
  { re: /₦|NGN/i, code: "NGN" },
  { re: /KES|KSh/i, code: "KES" },
  { re: /UGX/i, code: "UGX" },
  { re: /TZS|TSh/i, code: "TZS" },
  { re: /ZAR|R\s/i, code: "ZAR" },
  { re: /CFA|XOF|XAF/i, code: "XOF" },
]

const ALL_CCY = `(?:GH[CS¢₵]|GHS|GHC|₵|Cedi|₦|NGN|KES|KSh|UGX|TZS|TSh|ZAR|CFA|XOF|XAF)`
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
  { re: /(?<!\d)(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?!\d)/, fn: (m) => `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` },
  { re: /(?<!\d)(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?!\d)/, fn: (m) => `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` },
  {
    re: /(?<!\d)(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/,
    fn: (m) => {
      const yy = Number(m[3])
      const year = yy >= 70 ? 1900 + yy : 2000 + yy
      return `${year}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`
    },
  },
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

function calendarPartsValid(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(year, month - 1, day))
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day
}

function numericDayMonthAmbiguous(snippet: string): boolean {
  const m = snippet.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a >= 1 && a <= 12 && b >= 1 && b <= 12
}

function parseDate(
  text: string,
  warnings: string[]
): { value: string; confidence: ConfidenceLevel; source: string } | undefined {
  const lines = text.split(/\r?\n/)
  const hits: Array<{ iso: string; source: string; labeled: boolean; ambiguous: boolean }> = []
  for (const line of lines) {
    const labeled = /\bDATE\b/i.test(line)
    for (const { re, fn } of DATE_PATTERNS) {
      const m = line.match(re)
      if (!m) continue
      const iso = fn(m)
      if (!iso || !calendarPartsValid(iso)) continue
      hits.push({
        iso,
        source: line.trim(),
        labeled,
        ambiguous: numericDayMonthAmbiguous(m[0]),
      })
      break
    }
  }
  if (hits.length === 0) return undefined
  const labeledHits = hits.filter((h) => h.labeled)
  const pool = labeledHits.length > 0 ? labeledHits : hits
  const distinct = [...new Set(pool.map((h) => h.iso))]
  if (distinct.length > 1) {
    warnings.push("ambiguous_date")
    return undefined
  }
  const pick = pool[0]!
  if (!isPlausibleDate(pick.iso)) {
    return { value: pick.iso, confidence: "LOW", source: pick.source }
  }
  if (pick.ambiguous) {
    warnings.push("day_month_order_assumed")
    return { value: pick.iso, confidence: "MEDIUM", source: pick.source }
  }
  return {
    value: pick.iso,
    confidence: pick.labeled ? "HIGH" : "MEDIUM",
    source: pick.source,
  }
}

function detectCurrency(
  text: string,
  businessCurrency?: string
): { code: string; source?: string; fromBusinessDefault: boolean } | undefined {
  for (const { re, code } of CURRENCY_PATTERNS) {
    re.lastIndex = 0
    if (!re.test(text)) continue
    re.lastIndex = 0
    const source = text.split(/\r?\n/).find((line) => {
      re.lastIndex = 0
      return re.test(line)
    })
    return { code, source: source?.trim(), fromBusinessDefault: false }
  }
  if (businessCurrency) return { code: businessCurrency, fromBusinessDefault: true }
  return undefined
}

const AMOUNT_REJECT_LINE =
  /\b(sub[\s-]*total|vat|v\.a\.t|nhil|get[\s-]*fund|covid|discount|change|tendered|cash|tip|balance\s+tendered)\b/i

function lineAtIndex(text: string, index: number): string {
  const start = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1
  const end = text.indexOf("\n", index)
  return text.slice(start, end === -1 ? text.length : end).trim()
}

function totalRank(label: string): number {
  const l = label.toUpperCase()
  if (l.includes("GRAND")) return 100
  if (l.includes("AMOUNT DUE") || l.includes("TOTAL DUE")) return 90
  if (l.includes("BALANCE DUE")) return 85
  if (l.includes("NET TOTAL") || l.includes("NET")) return 80
  if (l.includes("PAYABLE")) return 70
  if (l === "TOTAL" || l.startsWith("TOTAL")) return 75
  if (l === "AMOUNT") return 40
  if (l === "CURRENCY") return 15
  return 0
}

function extractTotal(text: string): { value: number; confidence: ConfidenceLevel; source: string } | undefined {
  const candidates: Array<{ value: number; label: string; source: string; index: number }> = []
  let m: RegExpExecArray | null
  const push = (value: number | undefined, label: string, index: number, source: string) => {
    if (value == null || value <= 0) return
    if (AMOUNT_REJECT_LINE.test(source) && !/\b(grand\s+total|amount\s+due|balance\s+due|net\s+total)\b/i.test(source)) {
      return
    }
    candidates.push({ value, label: label.toUpperCase(), source, index })
  }

  const totalRe = new RegExp(TOTAL_LABELS.source, "gi")
  while ((m = totalRe.exec(text)) !== null) {
    push(parseNumber(m[2] ?? ""), m[1] || "TOTAL", m.index, lineAtIndex(text, m.index))
  }
  const amountRe = new RegExp(AMOUNT_LINE.source, "gi")
  while ((m = amountRe.exec(text)) !== null) {
    push(parseNumber(m[1]!), "AMOUNT", m.index, lineAtIndex(text, m.index))
  }
  if (candidates.length === 0) {
    const labelOnlyRe =
      /^\s*(Grand\s+Total|(?<!SUB-?)TOTAL|Amount\s+Due|Balance\s+Due|Net\s+Total|Amount\s+Payable|AMOUNT)\s*[:]?\s*$/i
    const amountOnlyRe = new RegExp(`^${ALL_CCY}?\\s*([\\d,]+\\.?\\d*)\\s*${ALL_CCY}?$`, "i")
    const splitLines = text.split(/\r?\n/)
    for (let i = 0; i < splitLines.length - 1; i++) {
      const labelLine = splitLines[i] ?? ""
      const lm = labelLine.match(labelOnlyRe)
      if (!lm) continue
      const next = (splitLines[i + 1] ?? "").trim()
      const nm = next.match(amountOnlyRe)
      if (!nm?.[1]) continue
      const label = (lm[1] || "TOTAL").toUpperCase()
      push(parseNumber(nm[1]), label.includes("AMOUNT") && !label.includes("TOTAL") ? "AMOUNT" : label, i, `${labelLine.trim()} ${next}`.trim())
    }
  }
  if (candidates.length === 0) {
    const currencyAmountRe = new RegExp(CURRENCY_AMOUNT.source, "gi")
    while ((m = currencyAmountRe.exec(text)) !== null) {
      const source = lineAtIndex(text, m.index)
      if (AMOUNT_REJECT_LINE.test(source)) continue
      push(parseNumber(m[1] || m[2] || ""), "CURRENCY", m.index, source)
    }
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => totalRank(b.label) - totalRank(a.label) || b.index - a.index)
  const pick = candidates[0]!
  const rank = totalRank(pick.label)
  const confidence: ConfidenceLevel = rank >= 70 ? "HIGH" : rank >= 40 ? "MEDIUM" : "LOW"
  return { value: pick.value, confidence, source: pick.source }
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
  if (!/[A-Za-z]{2,}/.test(t)) return -1e6
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
    if (!/[A-Za-z]{2,}/.test(t)) continue
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

/** Set RECEIPT_OCR_USE_STUB=true only in local dev. Production UI never mentions this. */
const defaultProvider: ReceiptOcrProvider = {
  async extractText(imageDataUrl: string): Promise<string> {
    if (!imageDataUrl?.startsWith("data:")) return ""
    if (process.env.RECEIPT_OCR_USE_STUB === "true") {
      return stubReceiptTextForDev()
    }
    return ""
  },
}

let provider: ReceiptOcrProvider = defaultProvider
let providerOverridden = false

export function setReceiptOcrProvider(p: ReceiptOcrProvider): void {
  provider = p
  providerOverridden = true
}

export function resetReceiptOcrProvider(): void {
  provider = defaultProvider
  providerOverridden = false
}

export function getReceiptOcrProvider(): ReceiptOcrProvider {
  return provider
}

/** Serverless Tesseract is disabled. Browser OCR is the product path unless a test injects a provider or the dev stub is on. */
export function isServerImageOcrDisabled(): boolean {
  return !providerOverridden && process.env.RECEIPT_OCR_USE_STUB !== "true"
}

export function parseReceiptText(
  text: string,
  _documentType: DocumentType,
  businessCurrency?: string
): ReceiptOcrResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const suggestions: ReceiptOcrSuggestions = {}
  const confidence: ReceiptOcrConfidence = {}
  const field_sources: ReceiptFieldSources = {}
  const warnings: string[] = []

  const currency = detectCurrency(text, businessCurrency)
  if (currency) {
    suggestions.currency_code = currency.code
    if (currency.source) field_sources.currency_code = currency.source
  }

  const supplier = extractSupplierName(lines)
  if (supplier) {
    suggestions.supplier_name = supplier.value
    confidence.supplier_name = supplier.confidence
    field_sources.supplier_name = supplier.value
  }

  const docNum = extractDocumentNumber(text)
  if (docNum) suggestions.document_number = docNum

  const dateResult = parseDate(text, warnings)
  if (dateResult) {
    suggestions.document_date = dateResult.value
    confidence.document_date = dateResult.confidence
    field_sources.document_date = dateResult.source
  }

  const totalResult = extractTotal(text)
  if (totalResult) {
    suggestions.total = totalResult.value
    confidence.total = totalResult.confidence
    field_sources.total = totalResult.source
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

  return {
    suggestions,
    confidence,
    field_sources,
    ...(warnings.length ? { warnings } : {}),
  }
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
