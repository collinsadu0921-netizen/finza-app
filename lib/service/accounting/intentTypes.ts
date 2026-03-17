/**
 * Service workspace posting: intent-based only.
 * Users cannot choose debit/credit; the engine derives lines from intent_type.
 */

export const SERVICE_INTENT_TYPES = [
  "OWNER_CONTRIBUTION",
  "OWNER_WITHDRAWAL",
] as const

export type ServiceIntentType = (typeof SERVICE_INTENT_TYPES)[number]

/** Account eligibility: type and optional sub_type (e.g. bank/cash = asset + sub_type in ['bank','cash']) */
export type AccountEligibility =
  | { type: "asset"; subType?: "bank" | "cash" }
  | { type: "equity" }
  | { type: "expense" }
  | { type: "liability" }
  | { type: "income" }

export interface ServiceIntentBase {
  intent_type: ServiceIntentType
  entry_date: string // YYYY-MM-DD
  description?: string
}

/** OWNER_CONTRIBUTION: DR bank/cash, CR equity. Amount > 0. */
export interface OwnerContributionIntent extends ServiceIntentBase {
  intent_type: "OWNER_CONTRIBUTION"
  amount: number
  bank_or_cash_account_id: string
  equity_account_id: string
}

/** OWNER_WITHDRAWAL: DR equity, CR bank/cash. Amount > 0. */
export interface OwnerWithdrawalIntent extends ServiceIntentBase {
  intent_type: "OWNER_WITHDRAWAL"
  amount: number
  bank_or_cash_account_id: string
  equity_account_id: string
}

export type ServiceIntent = OwnerContributionIntent | OwnerWithdrawalIntent

/** Per-intent required account roles and allowed types */
export const INTENT_ACCOUNT_RULES: Record<
  ServiceIntentType,
  { [K: string]: AccountEligibility }
> = {
  OWNER_CONTRIBUTION: {
    bank_or_cash_account_id: { type: "asset", subType: "bank" },
    equity_account_id: { type: "equity" },
  },
  OWNER_WITHDRAWAL: {
    bank_or_cash_account_id: { type: "asset", subType: "bank" },
    equity_account_id: { type: "equity" },
  },
}

/** Allow both bank and cash for both intents (sub_type in ['bank','cash']) */
export function isBankOrCashSubType(subType: string | null | undefined): boolean {
  if (!subType) return false
  const s = subType.toLowerCase()
  return s === "bank" || s === "cash"
}

export interface AccountForValidation {
  id: string
  type: string
  sub_type?: string | null
}

/**
 * Validate that an account fits the eligibility for a given intent field.
 */
export function accountFitsEligibility(
  account: AccountForValidation,
  eligibility: AccountEligibility
): boolean {
  if (account.type !== eligibility.type) return false
  if ("subType" in eligibility && eligibility.subType) {
    return isBankOrCashSubType(account.sub_type)
  }
  return true
}

/**
 * Validate intent payload and accounts. Returns error message or null.
 */
export function validateServiceIntent(
  intent: ServiceIntent,
  accounts: AccountForValidation[]
): string | null {
  if (!SERVICE_INTENT_TYPES.includes(intent.intent_type as ServiceIntentType)) {
    return "Invalid intent_type"
  }
  const rules = INTENT_ACCOUNT_RULES[intent.intent_type as ServiceIntentType]
  if (!rules) return "Unknown intent type"

  const entryDate = intent.entry_date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
    return "entry_date must be YYYY-MM-DD"
  }

  if (intent.intent_type === "OWNER_CONTRIBUTION") {
    const c = intent as OwnerContributionIntent
    if (typeof c.amount !== "number" || c.amount <= 0) return "amount must be a positive number"
    if (!c.bank_or_cash_account_id || !c.equity_account_id) {
      return "bank_or_cash_account_id and equity_account_id are required"
    }
  }
  if (intent.intent_type === "OWNER_WITHDRAWAL") {
    const w = intent as OwnerWithdrawalIntent
    if (typeof w.amount !== "number" || w.amount <= 0) return "amount must be a positive number"
    if (!w.bank_or_cash_account_id || !w.equity_account_id) {
      return "bank_or_cash_account_id and equity_account_id are required"
    }
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  for (const [field, eligibility] of Object.entries(rules)) {
    const accountId = (intent as unknown as Record<string, unknown>)[field] as string | undefined
    if (!accountId) return `Missing ${field}`
    const account = accountMap.get(accountId)
    if (!account) return `Account ${field} not found or not in this business`
    if (!accountFitsEligibility(account, eligibility)) {
      return `Account ${field} must be ${eligibility.type}${"subType" in eligibility ? " (bank or cash)" : ""}`
    }
  }

  return null
}
