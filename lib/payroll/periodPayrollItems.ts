import type { Phase1BPayrollFrequency } from "@/lib/payroll/salaryBasis"

export type PayrollItemRow = {
  id?: string | null
  type?: string | null
  amount?: number | null
  recurring?: boolean | null
  description?: string | null
  applies_to_month?: string | null
  payroll_run_id?: string | null
}

export type OneOffItemSnapshot = {
  id: string | null
  kind: "allowance" | "deduction"
  type: string | null
  amount: number
  description: string | null
}

export type FilteredPayrollItemsResult = {
  includedAllowances: PayrollItemRow[]
  includedDeductions: PayrollItemRow[]
  oneOffSnapshots: OneOffItemSnapshot[]
  legacySkipped: Array<{
    kind: "allowance" | "deduction"
    id: string | null
    reason: string
  }>
}

function monthKey(value: string | null | undefined): string | null {
  if (!value) return null
  const slice = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slice)) return null
  return `${slice.slice(0, 7)}-01`
}

/**
 * Select allowances/deductions for a payroll run under Phase 1B rules.
 * - Recurring: included once for eligible (matching-basis) employees.
 * - Exact-run one-offs: payroll_run_id === runId.
 * - Legacy month-scoped / unscoped non-recurring: never auto-include on weekly/fortnightly;
 *   on monthly, include only when applies_to_month matches (or legacy null month = every monthly run).
 */
export function filterPayrollItemsForRun(params: {
  allowances: PayrollItemRow[] | null | undefined
  deductions: PayrollItemRow[] | null | undefined
  payrollRunId: string | null
  payrollFrequency: Phase1BPayrollFrequency | string
  payrollMonth: string
}): FilteredPayrollItemsResult {
  const frequency = String(params.payrollFrequency || "monthly").toLowerCase()
  const runMonth = monthKey(params.payrollMonth)
  const runId = params.payrollRunId

  const includedAllowances: PayrollItemRow[] = []
  const includedDeductions: PayrollItemRow[] = []
  const oneOffSnapshots: OneOffItemSnapshot[] = []
  const legacySkipped: FilteredPayrollItemsResult["legacySkipped"] = []

  const consider = (
    kind: "allowance" | "deduction",
    row: PayrollItemRow,
    bucket: PayrollItemRow[]
  ) => {
    const recurring = row.recurring !== false
    const amount = Number(row.amount || 0)
    if (!Number.isFinite(amount)) return

    if (recurring) {
      if (row.payroll_run_id) {
        legacySkipped.push({
          kind,
          id: row.id ? String(row.id) : null,
          reason: "Recurring item unexpectedly linked to a payroll run; skipped.",
        })
        return
      }
      bucket.push(row)
      return
    }

    // Non-recurring
    if (row.payroll_run_id) {
      if (runId && String(row.payroll_run_id) === String(runId)) {
        bucket.push(row)
        oneOffSnapshots.push({
          id: row.id ? String(row.id) : null,
          kind,
          type: row.type ?? null,
          amount,
          description: row.description ?? null,
        })
      }
      return
    }

    // Legacy month-scoped / unscoped one-offs
    if (frequency !== "monthly") {
      legacySkipped.push({
        kind,
        id: row.id ? String(row.id) : null,
        reason:
          "Legacy one-off item (no exact payroll run assignment) is not auto-included in weekly/fortnightly runs.",
      })
      return
    }

    const appliesMonth = monthKey(row.applies_to_month)
    if (appliesMonth && runMonth && appliesMonth !== runMonth) {
      return
    }
    if (appliesMonth && runMonth && appliesMonth === runMonth) {
      bucket.push(row)
      oneOffSnapshots.push({
        id: row.id ? String(row.id) : null,
        kind,
        type: row.type ?? null,
        amount,
        description: row.description ?? null,
      })
      return
    }

    // applies_to_month null: legacy "every run" — keep for monthly only
    if (!appliesMonth) {
      bucket.push(row)
      oneOffSnapshots.push({
        id: row.id ? String(row.id) : null,
        kind,
        type: row.type ?? null,
        amount,
        description: row.description ?? null,
      })
      return
    }
  }

  for (const row of params.allowances || []) consider("allowance", row, includedAllowances)
  for (const row of params.deductions || []) consider("deduction", row, includedDeductions)

  return { includedAllowances, includedDeductions, oneOffSnapshots, legacySkipped }
}
