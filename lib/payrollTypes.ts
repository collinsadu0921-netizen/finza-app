/**
 * Allowance and deduction type values allowed by DB constraints.
 * Source of truth: supabase/migrations/047_payroll_system.sql
 * - allowances: type IN ('transport', 'housing', 'utility', 'medical', 'bonus', 'other')
 * - deductions: type IN ('loan', 'advance', 'penalty', 'other')
 */

export const ALLOWANCE_TYPES = [
  "transport",
  "housing",
  "utility",
  "medical",
  "bonus",
  "other",
] as const

export const DEDUCTION_TYPES = [
  "loan",
  "advance",
  "penalty",
  "other",
] as const

export type AllowanceType = (typeof ALLOWANCE_TYPES)[number]
export type DeductionType = (typeof DEDUCTION_TYPES)[number]

export function normalizeAllowanceType(value: unknown): AllowanceType | null {
  if (value == null || typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return ALLOWANCE_TYPES.includes(normalized as AllowanceType) ? (normalized as AllowanceType) : null
}

export function normalizeDeductionType(value: unknown): DeductionType | null {
  if (value == null || typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return DEDUCTION_TYPES.includes(normalized as DeductionType) ? (normalized as DeductionType) : null
}

/** Options for UI dropdowns: value (DB) and label (display) */
export const ALLOWANCE_TYPE_OPTIONS: { value: AllowanceType; label: string }[] = [
  { value: "transport", label: "Transport" },
  { value: "housing", label: "Housing" },
  { value: "utility", label: "Utility" },
  { value: "medical", label: "Medical" },
  { value: "bonus", label: "Bonus" },
  { value: "other", label: "Other" },
]

export const DEDUCTION_TYPE_OPTIONS: { value: DeductionType; label: string }[] = [
  { value: "loan", label: "Loan" },
  { value: "advance", label: "Advance" },
  { value: "penalty", label: "Penalty" },
  { value: "other", label: "Other" },
]
