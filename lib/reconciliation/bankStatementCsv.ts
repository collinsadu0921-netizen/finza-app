import Papa from "papaparse"

/** Column headers in the uploaded file → logical roles */
export type ColumnMapping = {
  date: string
  description: string
  amount: string
  reference?: string
}

export type BankImportSourceMeta = {
  source: "file" | "paste"
  filename?: string | null
}

export type ParsedBankGrid = {
  fields: string[]
  rows: Record<string, unknown>[]
  parseWarnings: string[]
}

const NO_DESCRIPTION = "(No description)"

function uniqHeader(header: string, index: number): string {
  const h = (header ?? "").trim()
  return h || `__column_${index}`
}

/** RFC4180-style parse via Papa: quoted fields, auto delimiter (comma/tab/…). */
export function parseBankDelimitedText(
  text: string,
  options: { hasHeaderRow: boolean }
): ParsedBankGrid | { error: string } {
  const trimmed = text.replace(/^\ufeff/, "").trim()
  if (!trimmed) {
    return { error: "The file is empty." }
  }

  if (options.hasHeaderRow) {
    const result = Papa.parse<Record<string, string>>(trimmed, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: uniqHeader,
      quoteChar: '"',
      escapeChar: '"',
    })

    const parseWarnings: string[] = []
    if (result.errors?.length) {
      for (const e of result.errors) {
        if (e.type === "Quotes" || e.type === "FieldMismatch") {
          parseWarnings.push(
            e.row != null
              ? `Parse issue near row ${e.row + 1}: ${e.message || e.code}`
              : e.message || e.code
          )
        }
      }
    }

    const fields = (result.meta.fields ?? []).filter(Boolean) as string[]
    const rawRows = (result.data ?? []) as Record<string, unknown>[]
    const rows = rawRows.filter((r) =>
      Object.values(r).some((v) => v !== "" && v != null && String(v).trim() !== "")
    )

    if (fields.length === 0 && rows.length > 0) {
      return { error: "Could not read column headers. Try turning off “first row is headers” or fix the CSV." }
    }

    if (rows.length === 0) {
      return { error: "No data rows found after the header." }
    }

    return { fields, rows, parseWarnings }
  }

  const result = Papa.parse<string[]>(trimmed, {
    header: false,
    skipEmptyLines: "greedy",
    quoteChar: '"',
    escapeChar: '"',
  })

  const parseWarnings: string[] = []
  if (result.errors?.length) {
    for (const e of result.errors) {
      if (e.type === "Quotes" || e.type === "FieldMismatch") {
        parseWarnings.push(e.message || e.code)
      }
    }
  }

  const arrays = (result.data ?? []).filter((row) =>
    row.some((cell) => String(cell ?? "").trim() !== "")
  ) as string[][]

  if (arrays.length === 0) {
    return { error: "No rows found." }
  }

  const fields = ["__col0", "__col1", "__col2", "__col3"]
  const rows = arrays.map((r) => ({
    __col0: r[0] ?? "",
    __col1: r[1] ?? "",
    __col2: r[2] ?? "",
    __col3: r[3] ?? "",
  }))

  return { fields, rows, parseWarnings }
}

function normHeader(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function scoreForRole(field: string, role: "date" | "description" | "amount" | "reference"): number {
  const n = normHeader(field)
  if (!n) return 0

  const rules: Record<typeof role, RegExp[]> = {
    date: [
      /^date$/,
      /\btransaction date\b/,
      /\btrans\.?\s*date\b/,
      /\bvalue date\b/,
      /\bpost(ing)? date\b/,
      /\bbooked date\b/,
      /\bval date\b/,
    ],
    description: [
      /^description$/,
      /\bnarrative\b/,
      /\bmemo\b/,
      /\bdetails?\b/,
      /\bparticulars?\b/,
      /\bpayee\b/,
      /\bcounterparty\b/,
      /\bmerchant\b/,
    ],
    amount: [
      /^amount$/,
      /\btransaction amount\b/,
      /\btxn amount\b/,
      /\bvalue\b$/,
      /\bamt\b$/,
      /\bdebit\b.*\bcredit\b|\bcredit\b.*\bdebit\b/i,
    ],
    reference: [/^ref(erence)?$/, /\btransaction id\b/, /\btxn id\b/, /\bcheque\b/, /\bcheck #\b/],
  }

  let score = 0
  for (const re of rules[role]) {
    if (re.test(n)) {
      score = Math.max(score, re.source.length + 2)
    }
  }
  if (role === "date" && n.includes("date")) score = Math.max(score, 5)
  if (role === "amount" && (n.includes("amount") || n === "value" || n === "amt")) {
    score = Math.max(score, 4)
  }
  if (role === "description" && (n.includes("desc") || n.includes("narrative"))) {
    score = Math.max(score, 4)
  }
  if (role === "reference" && (n.includes("ref") || n.includes("id"))) {
    score = Math.max(score, 3)
  }
  return score
}

function pickBest(pool: string[], role: "date" | "description" | "amount" | "reference"): string | null {
  let best: { f: string; s: number } | null = null
  for (const f of pool) {
    const s = scoreForRole(f, role)
    if (s > 0 && (!best || s > best.s)) best = { f, s }
  }
  return best?.f ?? null
}

/** Best-effort mapping; reference optional. Returns null if date/description/amount cannot be assigned uniquely. */
export function guessColumnMapping(fields: string[]): ColumnMapping | null {
  const pool = [...new Set(fields.filter(Boolean))]
  if (pool.length === 0) return null

  const date = pickBest(pool, "date")
  if (!date) return null
  const rest1 = pool.filter((f) => f !== date)

  const description = pickBest(rest1, "description")
  if (!description) return null
  const rest2 = rest1.filter((f) => f !== description)

  const amount = pickBest(rest2, "amount")
  if (!amount) return null
  const rest3 = rest2.filter((f) => f !== amount)

  const reference = pickBest(rest3, "reference") ?? undefined

  return { date, description, amount, reference }
}

export function isCompleteMapping(m: Partial<ColumnMapping>): m is ColumnMapping {
  return !!(m.date && m.description && m.amount)
}

export function applyColumnMapping(
  rows: Record<string, unknown>[],
  mapping: ColumnMapping
): Array<{ date: string; description: string; amount: string; reference: string }> {
  const refKey = mapping.reference
  return rows.map((row) => {
    const gv = (k: string) => {
      const v = row[k]
      if (v == null) return ""
      if (typeof v === "string") return v
      if (typeof v === "number" || typeof v === "boolean") return String(v)
      return String(v)
    }
    return {
      date: gv(mapping.date).trim(),
      description: gv(mapping.description).trim(),
      amount: gv(mapping.amount).trim(),
      reference: refKey ? gv(refKey).trim() : "",
    }
  })
}

export function parseSignedAmount(raw: string | number): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw === 0) return null
    return raw
  }

  let s = String(raw).trim()
  if (!s) return null

  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1).trim()
  }
  if (/^[-−]/.test(s)) {
    neg = true
    s = s.replace(/^[-−]+/, "").trim()
  }

  s = s.replace(/[A-Za-z$€£₵\s]/g, "")

  if (s.includes(",") && s.includes(".")) {
    const lastComma = s.lastIndexOf(",")
    const lastDot = s.lastIndexOf(".")
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".")
    } else {
      s = s.replace(/,/g, "")
    }
  } else if (s.includes(",")) {
    const parts = s.split(",")
    if (parts.length === 2 && parts[1].length <= 2) {
      s = parts[0].replace(/\./g, "") + "." + parts[1]
    } else {
      s = s.replace(/,/g, "")
    }
  }

  const n = parseFloat(s)
  if (!Number.isFinite(n) || n === 0) return null
  return neg ? -Math.abs(n) : n
}

function parseFlexibleDate(raw: string): Date | null {
  const t = raw.trim()
  if (!t) return null

  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t.slice(0, 10) + "T12:00:00")
    return Number.isNaN(d.getTime()) ? null : d
  }

  const d = new Date(t)
  if (!Number.isNaN(d.getTime())) {
    return d
  }

  const m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/)
  if (m) {
    let day = Number(m[1])
    let month = Number(m[2])
    let year = Number(m[3])
    if (year < 100) year += 2000
    if (month > 12 && day <= 12) {
      const tmp = day
      day = month
      month = tmp
    }
    const dt = new Date(year, month - 1, day)
    return Number.isNaN(dt.getTime()) ? null : dt
  }

  return null
}

export type NormalizedBankImportRow = {
  date: string
  description: string
  amountAbs: number
  signedAmount: number
  type: "debit" | "credit"
  reference: string | null
}

export function normalizeBankImportRow(input: {
  date: string
  description: string
  amount: string | number
  reference?: string | null
}): { ok: true; normalized: NormalizedBankImportRow } | { ok: false; errors: string[] } {
  const errors: string[] = []

  const d = parseFlexibleDate(input.date)
  if (!d) {
    errors.push("Invalid or missing date")
  }

  const signed = parseSignedAmount(input.amount)
  if (signed === null) {
    errors.push("Amount must be non-zero and numeric")
  }

  const desc = (input.description ?? "").trim()
  const description = desc.length > 0 ? desc : NO_DESCRIPTION

  const refRaw = (input.reference ?? "").trim()
  const reference = refRaw.length > 0 ? refRaw : null

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const signedAmount = signed as number
  const type: "debit" | "credit" = signedAmount >= 0 ? "credit" : "debit"
  const amountAbs = Math.abs(signedAmount)

  return {
    ok: true,
    normalized: {
      date: d!.toISOString().slice(0, 10),
      description,
      amountAbs,
      signedAmount,
      type,
      reference,
    },
  }
}

export type PreviewBankRow = {
  rowIndex: number
  dateDisplay: string
  description: string
  signedAmount: number | null
  type: "credit" | "debit" | null
  reference: string
  errors: string[]
}

export function buildPreviewRows(
  mapped: Array<{ date: string; description: string; amount: string; reference: string }>
): PreviewBankRow[] {
  return mapped.map((row, i) => {
    const res = normalizeBankImportRow(row)
    if (!res.ok) {
      return {
        rowIndex: i + 1,
        dateDisplay: row.date,
        description: row.description,
        signedAmount: null,
        type: null,
        reference: row.reference,
        errors: res.errors,
      }
    }
    const { normalized } = res
    return {
      rowIndex: i + 1,
      dateDisplay: normalized.date,
      description: normalized.description,
      signedAmount: normalized.signedAmount,
      type: normalized.type,
      reference: normalized.reference ?? "",
      errors: [],
    }
  })
}

export function allPreviewRowsValid(rows: PreviewBankRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.errors.length === 0)
}

export function rowsToImportPayload(rows: PreviewBankRow[]): Array<{
  date: string
  description: string
  amount: number
  reference: string | null
}> {
  return rows.map((r) => {
    if (r.errors.length > 0 || r.signedAmount === null) {
      throw new Error("Invalid row in import payload")
    }
    return {
      date: r.dateDisplay,
      description: r.description,
      amount: r.signedAmount,
      reference: r.reference.trim() ? r.reference.trim() : null,
    }
  })
}

export function sanitizeImportFilename(name: string | null | undefined, maxLen = 240): string | null {
  if (!name || !name.trim()) return null
  const base = name.trim().replace(/[\\/]/g, "_")
  return base.length > maxLen ? base.slice(0, maxLen) : base
}
