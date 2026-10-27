/**
 * Service workspace manual journal validation.
 *
 * This module is intentionally independent of the Accounting/Practice manual
 * journal workflow. The Service API and the Service database RPCs both apply
 * these rules; the RPCs remain authoritative.
 */

export const SERVICE_MANUAL_CONTROL_ACCOUNT_CODES = new Set([
  "1100",
  "1200",
  "2000",
  "2100",
  "2110",
  "2120",
  "2130",
  "2150",
  "2155",
  "2200",
  "2210",
  "2220",
  "2230",
  "2231",
  "2232",
  "2240",
  "2241",
])

export type ServiceManualJournalLineInput = {
  account_id?: unknown
  debit?: unknown
  credit?: unknown
  memo?: unknown
}

export type ServiceManualJournalLine = {
  account_id: string
  debit: number
  credit: number
  memo: string | null
}

export type ServiceManualJournalInput = {
  entry_date?: unknown
  description?: unknown
  reference?: unknown
  lines?: unknown
}

export type ServiceManualJournalAccount = {
  id: string
  business_id: string
  code: string
  name: string
  type: string
  sub_type: string | null
  is_system: boolean
  is_postable: boolean
  deleted_at: string | null
}

export type ServiceManualJournalValidation =
  | {
      ok: true
      entryDate: string
      description: string
      reference: string | null
      lines: ServiceManualJournalLine[]
      totalDebit: number
      totalCredit: number
    }
  | {
      ok: false
      code: string
      message: string
      field?: string
    }

export class ServiceManualJournalError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ServiceManualJournalError"
    this.code = code
  }
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function parseAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0
  if (typeof value !== "number" && typeof value !== "string") return null
  const parsed = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isServiceManualControlAccount(
  code: string | null | undefined,
  isSystem: boolean | null | undefined
): boolean {
  return Boolean(isSystem) && SERVICE_MANUAL_CONTROL_ACCOUNT_CODES.has(String(code || ""))
}

export function isServiceManualAccountPostable(
  account: Pick<
    ServiceManualJournalAccount,
    "business_id" | "code" | "is_system" | "is_postable" | "deleted_at"
  >,
  businessId: string
): boolean {
  return (
    account.business_id === businessId &&
    account.deleted_at === null &&
    account.is_postable === true &&
    !isServiceManualControlAccount(account.code, account.is_system)
  )
}

/**
 * Validate and normalize an API payload. Account existence/ownership/postability
 * is validated separately against the database accounts, and again inside the
 * database RPC.
 */
export function validateServiceManualJournalInput(
  input: ServiceManualJournalInput
): ServiceManualJournalValidation {
  const entryDate = typeof input.entry_date === "string" ? input.entry_date.trim() : ""
  if (!isIsoDate(entryDate)) {
    return { ok: false, code: "SERVICE_MANUAL_DATE_INVALID", message: "A valid entry date (YYYY-MM-DD) is required.", field: "entry_date" }
  }

  const description = typeof input.description === "string" ? input.description.trim() : ""
  if (description.length === 0 || description.length > 500) {
    return { ok: false, code: "SERVICE_MANUAL_DESCRIPTION_INVALID", message: "Description is required and must be 500 characters or fewer.", field: "description" }
  }

  const referenceRaw = typeof input.reference === "string" ? input.reference.trim() : ""
  if (referenceRaw.length > 200) {
    return { ok: false, code: "SERVICE_MANUAL_REFERENCE_INVALID", message: "Reference must be 200 characters or fewer.", field: "reference" }
  }

  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    return { ok: false, code: "SERVICE_MANUAL_LINES_INVALID", message: "At least two journal lines are required.", field: "lines" }
  }

  if (input.lines.length > 100) {
    return { ok: false, code: "SERVICE_MANUAL_LINES_INVALID", message: "At most 100 journal lines are allowed.", field: "lines" }
  }

  const lines: ServiceManualJournalLine[] = []
  let totalDebit = 0
  let totalCredit = 0

  for (let index = 0; index < input.lines.length; index += 1) {
    const raw = input.lines[index] as ServiceManualJournalLineInput
    if (!raw || typeof raw !== "object") {
      return { ok: false, code: "SERVICE_MANUAL_LINES_INVALID", message: `Line ${index + 1} is invalid.`, field: "lines" }
    }

    const accountId = typeof raw.account_id === "string" ? raw.account_id.trim() : ""
    if (!accountId || !isUuid(accountId)) {
      return { ok: false, code: "SERVICE_MANUAL_ACCOUNT_INVALID", message: `Line ${index + 1}: a valid account is required.`, field: "lines" }
    }

    const debit = parseAmount(raw.debit)
    const credit = parseAmount(raw.credit)
    if (debit === null || credit === null) {
      return { ok: false, code: "SERVICE_MANUAL_AMOUNT_INVALID", message: `Line ${index + 1}: debit and credit must be numbers.`, field: "lines" }
    }

    if (debit < 0 || credit < 0) {
      return { ok: false, code: "SERVICE_MANUAL_AMOUNT_INVALID", message: `Line ${index + 1}: negative amounts are not allowed.`, field: "lines" }
    }

    if (debit === 0 && credit === 0) {
      return { ok: false, code: "SERVICE_MANUAL_AMOUNT_INVALID", message: `Line ${index + 1}: enter a debit or a credit.`, field: "lines" }
    }

    if (debit > 0 && credit > 0) {
      return { ok: false, code: "SERVICE_MANUAL_AMOUNT_INVALID", message: `Line ${index + 1}: a line cannot have both a debit and a credit.`, field: "lines" }
    }

    if (debit > 1_000_000_000_000 || credit > 1_000_000_000_000) {
      return { ok: false, code: "SERVICE_MANUAL_AMOUNT_INVALID", message: `Line ${index + 1}: amount is too large.`, field: "lines" }
    }

    const memo = typeof raw.memo === "string" && raw.memo.trim() ? raw.memo.trim().slice(0, 500) : null
    const normalizedDebit = round2(debit)
    const normalizedCredit = round2(credit)
    totalDebit = round2(totalDebit + normalizedDebit)
    totalCredit = round2(totalCredit + normalizedCredit)

    lines.push({
      account_id: accountId,
      debit: normalizedDebit,
      credit: normalizedCredit,
      memo,
    })
  }

  if (totalDebit !== totalCredit) {
    return {
      ok: false,
      code: "SERVICE_MANUAL_UNBALANCED",
      message: `Debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)}).`,
      field: "lines",
    }
  }

  return {
    ok: true,
    entryDate,
    description,
    reference: referenceRaw || null,
    lines,
    totalDebit,
    totalCredit,
  }
}

export function validateServiceManualAccounts(params: {
  businessId: string
  lines: ServiceManualJournalLine[]
  accounts: ServiceManualJournalAccount[]
}): { ok: true; accountsById: Map<string, ServiceManualJournalAccount> } | { ok: false; code: string; message: string } {
  const byId = new Map(params.accounts.map((account) => [account.id, account]))

  for (const line of params.lines) {
    const account = byId.get(line.account_id)
    if (!account) {
      return { ok: false, code: "SERVICE_MANUAL_ACCOUNT_INVALID", message: "One or more accounts were not found." }
    }

    if (account.business_id !== params.businessId) {
      return { ok: false, code: "SERVICE_MANUAL_ACCOUNT_INVALID", message: "One or more accounts do not belong to this business." }
    }

    if (account.deleted_at !== null) {
      return { ok: false, code: "SERVICE_MANUAL_ACCOUNT_INACTIVE", message: `Account ${account.code} is inactive.` }
    }

    if (!account.is_postable || isServiceManualControlAccount(account.code, account.is_system)) {
      return { ok: false, code: "SERVICE_MANUAL_ACCOUNT_NOT_POSTABLE", message: `Account ${account.code} is a control or non-postable account.` }
    }
  }

  return { ok: true, accountsById: byId }
}

const RPC_ERROR_MAP: Array<{ prefix: string; status: number; code: string; message: string }> = [
  { prefix: "SERVICE_MANUAL_UNAUTHORIZED", status: 401, code: "UNAUTHORIZED", message: "Authentication is required." },
  { prefix: "SERVICE_MANUAL_FORBIDDEN", status: 403, code: "FORBIDDEN", message: "You do not have permission to create or post manual journals for this business." },
  { prefix: "SERVICE_MANUAL_NOT_SERVICE", status: 403, code: "NOT_SERVICE_WORKSPACE", message: "Manual journals are available only in the Service workspace." },
  { prefix: "SERVICE_MANUAL_BUSINESS_ARCHIVED", status: 403, code: "BUSINESS_ARCHIVED", message: "This business is archived." },
  { prefix: "SERVICE_MANUAL_SUBSCRIPTION_READ_ONLY", status: 403, code: "SUBSCRIPTION_READ_ONLY", message: "Financial writes are locked for this business." },
  { prefix: "SERVICE_MANUAL_TIER_REQUIRED", status: 403, code: "TIER_REQUIRED", message: "The Business plan or higher is required." },
  { prefix: "SERVICE_MANUAL_BUSINESS_NOT_FOUND", status: 404, code: "BUSINESS_NOT_FOUND", message: "Business not found." },
  { prefix: "SERVICE_MANUAL_DATE_REQUIRED", status: 400, code: "DATE_REQUIRED", message: "An entry date is required." },
  { prefix: "SERVICE_MANUAL_DESCRIPTION_INVALID", status: 400, code: "DESCRIPTION_INVALID", message: "Description is required and must be 500 characters or fewer." },
  { prefix: "SERVICE_MANUAL_REFERENCE_INVALID", status: 400, code: "REFERENCE_INVALID", message: "Reference must be 200 characters or fewer." },
  { prefix: "SERVICE_MANUAL_PERIOD_NOT_FOUND", status: 400, code: "PERIOD_NOT_FOUND", message: "No accounting period covers that entry date." },
  { prefix: "SERVICE_MANUAL_PERIOD_NOT_OPEN", status: 400, code: "PERIOD_NOT_OPEN", message: "The accounting period is not open for posting." },
  { prefix: "SERVICE_MANUAL_ACCOUNT_INVALID", status: 400, code: "ACCOUNT_INVALID", message: "One or more accounts are invalid or belong to another business." },
  { prefix: "SERVICE_MANUAL_ACCOUNT_INACTIVE", status: 400, code: "ACCOUNT_INACTIVE", message: "One or more accounts are inactive." },
  { prefix: "SERVICE_MANUAL_ACCOUNT_NOT_POSTABLE", status: 400, code: "ACCOUNT_NOT_POSTABLE", message: "Control accounts cannot be used in a manual journal." },
  { prefix: "SERVICE_MANUAL_AMOUNT_INVALID", status: 400, code: "AMOUNT_INVALID", message: "One or more amounts are invalid." },
  { prefix: "SERVICE_MANUAL_LINES_INVALID", status: 400, code: "LINES_INVALID", message: "The journal lines are invalid." },
  { prefix: "SERVICE_MANUAL_UNBALANCED", status: 400, code: "UNBALANCED", message: "Total debits must equal total credits." },
  { prefix: "SERVICE_MANUAL_DRAFT_NOT_FOUND", status: 404, code: "DRAFT_NOT_FOUND", message: "Manual journal draft not found." },
  { prefix: "SERVICE_MANUAL_NOT_DRAFT", status: 400, code: "NOT_DRAFT", message: "Only draft entries can be posted." },
  { prefix: "SERVICE_MANUAL_ALREADY_REVERSED", status: 400, code: "ALREADY_REVERSED", message: "This manual journal has already been reversed." },
  { prefix: "REVERSAL_ALREADY_EXISTS", status: 400, code: "ALREADY_REVERSED", message: "This journal has already been reversed." },
  { prefix: "REVERSAL_BUSINESS_MISMATCH", status: 403, code: "REVERSAL_BUSINESS_MISMATCH", message: "The reversal does not belong to this journal's business." },
  { prefix: "SERVICE_MANUAL_DRAFT_TOTALS_INVALID", status: 400, code: "DRAFT_TOTALS_INVALID", message: "The draft totals do not match its lines." },
  { prefix: "SERVICE_MANUAL_CURRENCY_REQUIRED", status: 400, code: "CURRENCY_REQUIRED", message: "Set the business default currency before posting." },
  { prefix: "SERVICE_MANUAL_JOURNAL_NOT_FOUND", status: 404, code: "JOURNAL_NOT_FOUND", message: "Posted manual journal not found." },
  { prefix: "SERVICE_MANUAL_JOURNAL_INVALID", status: 400, code: "JOURNAL_INVALID", message: "The original journal cannot be reversed." },
  { prefix: "SERVICE_MANUAL_REASON_INVALID", status: 400, code: "REASON_INVALID", message: "Reversal reason must be between 10 and 500 characters." },
  { prefix: "SERVICE_MANUAL_REVERSAL_DATE_INVALID", status: 400, code: "REVERSAL_DATE_INVALID", message: "Reversal date must be on or after the original entry date." },
  { prefix: "SERVICE_MANUAL_IDEMPOTENCY_REQUIRED", status: 400, code: "IDEMPOTENCY_REQUIRED", message: "An idempotency key is required." },
]

export function mapServiceManualRpcError(message: string | null | undefined): {
  status: number
  code: string
  message: string
} {
  const text = String(message || "")
  for (const entry of RPC_ERROR_MAP) {
    if (text.includes(entry.prefix)) {
      return { status: entry.status, code: entry.code, message: entry.message }
    }
  }
  return {
    status: 500,
    code: "SERVICE_MANUAL_FAILED",
    message: "The manual journal operation failed. Please try again or contact support.",
  }
}
