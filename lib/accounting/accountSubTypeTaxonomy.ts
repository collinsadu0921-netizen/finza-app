/**
 * Shared COA semantic sub_type taxonomy (application layer).
 * DB column remains nullable TEXT — no restrictive enum in P0.
 */

export const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
] as const

export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const ASSET_SUB_TYPES = ["bank", "cash", "mobile_money"] as const
export const LIABILITY_SUB_TYPES = [
  "loan",
  "payable",
  "tax_payable",
  "payroll_payable",
  "other",
] as const

export type AssetSubType = (typeof ASSET_SUB_TYPES)[number]
export type LiabilitySubType = (typeof LIABILITY_SUB_TYPES)[number]
export type AccountSubType = AssetSubType | LiabilitySubType

/** Operational accounts that can fund/receive loan and equity cash movements. */
export const OPERATIONAL_FUNDING_SUB_TYPES = [
  "bank",
  "cash",
  "mobile_money",
] as const

export type OperationalFundingSubType = (typeof OPERATIONAL_FUNDING_SUB_TYPES)[number]

export function allowedSubTypesForAccountType(
  type: AccountType
): readonly string[] {
  switch (type) {
    case "asset":
      return ASSET_SUB_TYPES
    case "liability":
      return LIABILITY_SUB_TYPES
    default:
      return []
  }
}

export function isAllowedSubTypeForAccountType(
  type: AccountType,
  subType: string | null | undefined
): boolean {
  if (!subType) return true
  const normalized = subType.trim().toLowerCase()
  if (!normalized) return true
  return allowedSubTypesForAccountType(type).includes(normalized)
}

export function normalizeSubType(
  subType: string | null | undefined
): string | null {
  if (typeof subType !== "string") return null
  const trimmed = subType.trim().toLowerCase()
  return trimmed.length > 0 ? trimmed : null
}

export function isOperationalFundingSubType(
  subType: string | null | undefined
): boolean {
  const s = normalizeSubType(subType)
  if (!s) return false
  return (OPERATIONAL_FUNDING_SUB_TYPES as readonly string[]).includes(s)
}

/** @deprecated Use isOperationalFundingSubType — includes mobile_money. */
export const isBankOrCashSubType = isOperationalFundingSubType

export function isLoanSubType(subType: string | null | undefined): boolean {
  return normalizeSubType(subType) === "loan"
}

export const SUB_TYPE_LABELS: Record<string, string> = {
  bank: "Bank account",
  cash: "Cash on hand",
  mobile_money: "Mobile money",
  loan: "Loan / Borrowing",
  payable: "Accounts payable",
  tax_payable: "Tax payable",
  payroll_payable: "Payroll payable",
  other: "Other liability",
}

export function subTypeLabel(subType: string | null | undefined): string {
  const s = normalizeSubType(subType)
  if (!s) return "None"
  return SUB_TYPE_LABELS[s] ?? s
}
