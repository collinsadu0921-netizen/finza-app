/**
 * Service workspace posting: intent-based only.
 * Users cannot choose debit/credit; the engine derives lines from intent_type.
 */

import {
  isOperationalFundingSubType,
  isLoanSubType,
} from "@/lib/accounting/accountSubTypeTaxonomy"

export const SERVICE_INTENT_TYPES = [
  "OWNER_CONTRIBUTION",
  "OWNER_WITHDRAWAL",
  "LOAN_DRAWDOWN",
  "LOAN_REPAYMENT",
  "LOAN_INTEREST_PAYMENT",
] as const

export type ServiceIntentType = (typeof SERVICE_INTENT_TYPES)[number]

/** Account eligibility: type and optional sub_type */
export type AccountEligibility =
  | { type: "asset"; subType: "operational_funding" }
  | { type: "equity" }
  | { type: "expense" }
  | { type: "liability"; subType: "loan" }
  | { type: "income" }

export interface ServiceIntentBase {
  intent_type: ServiceIntentType
  entry_date: string // YYYY-MM-DD
  description?: string
}

/** OWNER_CONTRIBUTION: Dr bank/cash, Cr equity. Amount > 0. */
export interface OwnerContributionIntent extends ServiceIntentBase {
  intent_type: "OWNER_CONTRIBUTION"
  amount: number
  bank_or_cash_account_id: string
  equity_account_id: string
}

/** OWNER_WITHDRAWAL: Dr equity, Cr bank/cash. Amount > 0. */
export interface OwnerWithdrawalIntent extends ServiceIntentBase {
  intent_type: "OWNER_WITHDRAWAL"
  amount: number
  bank_or_cash_account_id: string
  equity_account_id: string
}

/** LOAN_DRAWDOWN: Dr bank/cash, Cr loan liability. Amount > 0. */
export interface LoanDrawdownIntent extends ServiceIntentBase {
  intent_type: "LOAN_DRAWDOWN"
  amount: number
  bank_or_cash_account_id: string
  loan_account_id: string
}

/** LOAN_REPAYMENT: Dr loan liability, Cr bank/cash. Amount > 0. Requires loan register row. */
export interface LoanRepaymentIntent extends ServiceIntentBase {
  intent_type: "LOAN_REPAYMENT"
  amount: number
  bank_or_cash_account_id: string
  loan_account_id: string
  loan_id: string
}

/** LOAN_INTEREST_PAYMENT: Dr interest expense, Cr bank/cash. Amount > 0. */
export interface LoanInterestPaymentIntent extends ServiceIntentBase {
  intent_type: "LOAN_INTEREST_PAYMENT"
  amount: number
  bank_or_cash_account_id: string
  expense_account_id: string
}

export type ServiceIntent =
  | OwnerContributionIntent
  | OwnerWithdrawalIntent
  | LoanDrawdownIntent
  | LoanRepaymentIntent
  | LoanInterestPaymentIntent

/** Per-intent required account roles and allowed types */
export const INTENT_ACCOUNT_RULES: Record<
  ServiceIntentType,
  { [K: string]: AccountEligibility }
> = {
  OWNER_CONTRIBUTION: {
    bank_or_cash_account_id: { type: "asset", subType: "operational_funding" },
    equity_account_id:       { type: "equity" },
  },
  OWNER_WITHDRAWAL: {
    bank_or_cash_account_id: { type: "asset", subType: "operational_funding" },
    equity_account_id:       { type: "equity" },
  },
  LOAN_DRAWDOWN: {
    bank_or_cash_account_id: { type: "asset", subType: "operational_funding" },
    loan_account_id:         { type: "liability", subType: "loan" },
  },
  LOAN_REPAYMENT: {
    bank_or_cash_account_id: { type: "asset", subType: "operational_funding" },
    loan_account_id:         { type: "liability", subType: "loan" },
  },
  LOAN_INTEREST_PAYMENT: {
    bank_or_cash_account_id: { type: "asset", subType: "operational_funding" },
    expense_account_id:      { type: "expense" },
  },
}

export {
  isOperationalFundingSubType,
  isOperationalFundingSubType as isBankOrCashSubType,
  isLoanSubType,
} from "@/lib/accounting/accountSubTypeTaxonomy"

export interface AccountForValidation {
  id: string
  type: string
  sub_type?: string | null
}

/** Validate that an account fits the eligibility for a given intent field. */
export function accountFitsEligibility(
  account: AccountForValidation,
  eligibility: AccountEligibility
): boolean {
  if (account.type !== eligibility.type) return false
  if ("subType" in eligibility && eligibility.subType) {
    if (eligibility.subType === "operational_funding") {
      return isOperationalFundingSubType(account.sub_type)
    }
    if (eligibility.subType === "loan") {
      return isLoanSubType(account.sub_type)
    }
  }
  return true
}

/** Validate intent payload and accounts. Returns error message or null. */
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

  if (
    intent.intent_type === "OWNER_CONTRIBUTION" ||
    intent.intent_type === "OWNER_WITHDRAWAL"
  ) {
    const i = intent as OwnerContributionIntent
    if (typeof i.amount !== "number" || i.amount <= 0) return "amount must be a positive number"
    if (!i.bank_or_cash_account_id || !i.equity_account_id) {
      return "bank_or_cash_account_id and equity_account_id are required"
    }
  }

  if (intent.intent_type === "LOAN_DRAWDOWN") {
    const i = intent as LoanDrawdownIntent
    if (typeof i.amount !== "number" || i.amount <= 0) return "amount must be a positive number"
    if (!i.bank_or_cash_account_id || !i.loan_account_id) {
      return "bank_or_cash_account_id and loan_account_id are required"
    }
  }

  if (intent.intent_type === "LOAN_REPAYMENT") {
    const i = intent as LoanRepaymentIntent
    if (typeof i.amount !== "number" || i.amount <= 0) return "amount must be a positive number"
    if (!i.bank_or_cash_account_id || !i.loan_account_id || !i.loan_id) {
      return "bank_or_cash_account_id, loan_account_id, and loan_id are required"
    }
  }

  if (intent.intent_type === "LOAN_INTEREST_PAYMENT") {
    const i = intent as LoanInterestPaymentIntent
    if (typeof i.amount !== "number" || i.amount <= 0) return "amount must be a positive number"
    if (!i.bank_or_cash_account_id || !i.expense_account_id) {
      return "bank_or_cash_account_id and expense_account_id are required"
    }
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  for (const [field, eligibility] of Object.entries(rules)) {
    const accountId = (intent as unknown as Record<string, unknown>)[field] as string | undefined
    if (!accountId) return `Missing ${field}`
    const account = accountMap.get(accountId)
    if (!account) return `Account ${field} not found or not in this business`
    if (!accountFitsEligibility(account, eligibility)) {
      const subTypeHint =
        "subType" in eligibility && eligibility.subType
          ? eligibility.subType === "operational_funding"
            ? " (bank, cash, or mobile money)"
            : ` (${eligibility.subType})`
          : ""
      return `Account ${field} must be type '${eligibility.type}'${subTypeHint}`
    }
  }

  return null
}
