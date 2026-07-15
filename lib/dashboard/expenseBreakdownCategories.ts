/**
 * Maps ledger journal reference types to dashboard expense-breakdown categories.
 * Display-only — totals still come from finza_dashboard_pnl_totals / metrics RPC.
 */

export type ExpenseBreakdownCategoryKey =
  | "module"
  | "bills"
  | "payroll"
  | "depreciation"
  | "other"

export type ExpenseBreakdownCategory = {
  key: ExpenseBreakdownCategoryKey
  label: string
  /** Short helper shown in the info popover. */
  hint: string
}

export const EXPENSE_BREAKDOWN_CATEGORIES: ExpenseBreakdownCategory[] = [
  {
    key: "module",
    label: "Expenses module",
    hint: "Operating expenses recorded in Expenses (pre-tax subtotal on expense accounts).",
  },
  {
    key: "bills",
    label: "Supplier bills",
    hint: "Supplier and supplies costs when a bill is marked Open (issue-date month).",
  },
  {
    key: "payroll",
    label: "Payroll",
    hint: "Payroll runs posted to payroll expense accounts.",
  },
  {
    key: "depreciation",
    label: "Depreciation & adjustments",
    hint: "Depreciation expense and related ledger reversals in this period.",
  },
  {
    key: "other",
    label: "Other ledger expenses",
    hint: "Manual journals and other expense-account postings.",
  },
]

const REFERENCE_TYPE_TO_CATEGORY: Record<string, ExpenseBreakdownCategoryKey> = {
  expense: "module",
  bill: "bills",
  payroll: "payroll",
  depreciation: "depreciation",
  reversal: "depreciation",
}

export function categoryKeyForReferenceType(
  referenceType: string | null | undefined
): ExpenseBreakdownCategoryKey {
  if (!referenceType) return "other"
  return REFERENCE_TYPE_TO_CATEGORY[referenceType] ?? "other"
}

export function roundExpenseMoney(value: number): number {
  return Math.round(value * 100) / 100
}
