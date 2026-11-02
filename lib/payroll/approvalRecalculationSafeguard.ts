import type { SupabaseClient } from "@supabase/supabase-js"
import { refreshGhanaDraftStatutoryRates } from "./refreshGhanaDraftStatutoryRates"

export const PAYROLL_RECALCULATION_REVIEW_REQUIRED = "PAYROLL_RECALCULATION_REVIEW_REQUIRED"

export type PayrollFinancialValues = {
  gross_salary: number
  allowances_total: number
  deductions_total: number
  ssnit_employee: number
  ssnit_employer: number
  paye: number
  net_salary: number
}

export type PayrollFinancialSnapshot = {
  totals: PayrollFinancialValues
  employees: Array<
    PayrollFinancialValues & {
      staff_id: string
      staff_name: string | null
    }
  >
}

export type PayrollFinancialFieldChange = {
  field: keyof PayrollFinancialValues
  label: string
  before: number
  after: number
  delta: number
}

export type PayrollEmployeeFinancialChange = {
  staff_id: string
  staff_name: string | null
  changes: PayrollFinancialFieldChange[]
}

export type PayrollRecalculationDiff = {
  changed: boolean
  totals: PayrollFinancialFieldChange[]
  employees: PayrollEmployeeFinancialChange[]
}

const FINANCIAL_FIELDS: Array<{ field: keyof PayrollFinancialValues; label: string }> = [
  { field: "gross_salary", label: "Gross salary" },
  { field: "allowances_total", label: "Allowances" },
  { field: "deductions_total", label: "Deductions" },
  { field: "ssnit_employee", label: "Employee SSNIT" },
  { field: "ssnit_employer", label: "Employer SSNIT" },
  { field: "paye", label: "PAYE" },
  { field: "net_salary", label: "Net salary" },
]

/** Compare at accounting precision (two decimals), never raw floats. */
function roundAmount(value: unknown): number {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

function amountsDiffer(a: number, b: number): boolean {
  return Math.abs(roundAmount(a) - roundAmount(b)) >= 0.005
}

function fromRunRow(row: Record<string, unknown>): PayrollFinancialValues {
  return {
    gross_salary: roundAmount(row.total_gross_salary),
    allowances_total: roundAmount(row.total_allowances),
    deductions_total: roundAmount(row.total_deductions),
    ssnit_employee: roundAmount(row.total_ssnit_employee),
    ssnit_employer: roundAmount(row.total_ssnit_employer),
    paye: roundAmount(row.total_paye),
    net_salary: roundAmount(row.total_net_salary),
  }
}

function fromEntryRow(row: Record<string, unknown>): PayrollFinancialValues {
  return {
    gross_salary: roundAmount(row.gross_salary),
    allowances_total: roundAmount(row.allowances_total),
    deductions_total: roundAmount(row.deductions_total),
    ssnit_employee: roundAmount(row.ssnit_employee),
    ssnit_employer: roundAmount(row.ssnit_employer),
    paye: roundAmount(row.paye),
    net_salary: roundAmount(row.net_salary),
  }
}

function financialFieldChanges(
  before: PayrollFinancialValues,
  after: PayrollFinancialValues
): PayrollFinancialFieldChange[] {
  const changes: PayrollFinancialFieldChange[] = []
  for (const { field, label } of FINANCIAL_FIELDS) {
    if (!amountsDiffer(before[field], after[field])) continue
    changes.push({
      field,
      label,
      before: roundAmount(before[field]),
      after: roundAmount(after[field]),
      delta: roundAmount(after[field] - before[field]),
    })
  }
  return changes
}

/**
 * Compare the financial state before and after an automatic statutory refresh.
 * Metadata-only changes produce no differences and therefore require no review.
 */
export function comparePayrollFinancialSnapshots(
  before: PayrollFinancialSnapshot,
  after: PayrollFinancialSnapshot
): PayrollRecalculationDiff {
  const totals = financialFieldChanges(before.totals, after.totals)

  const beforeById = new Map(before.employees.map((entry) => [entry.staff_id, entry]))
  const afterById = new Map(after.employees.map((entry) => [entry.staff_id, entry]))
  const staffIds = Array.from(new Set([...beforeById.keys(), ...afterById.keys()])).sort()

  const employees: PayrollEmployeeFinancialChange[] = []
  for (const staffId of staffIds) {
    const beforeEntry = beforeById.get(staffId)
    const afterEntry = afterById.get(staffId)
    const empty: PayrollFinancialValues = {
      gross_salary: 0,
      allowances_total: 0,
      deductions_total: 0,
      ssnit_employee: 0,
      ssnit_employer: 0,
      paye: 0,
      net_salary: 0,
    }
    const changes = financialFieldChanges(beforeEntry ?? empty, afterEntry ?? empty)
    if (changes.length === 0) continue
    employees.push({
      staff_id: staffId,
      staff_name: afterEntry?.staff_name ?? beforeEntry?.staff_name ?? null,
      changes,
    })
  }

  return {
    changed: totals.length > 0 || employees.length > 0,
    totals,
    employees,
  }
}

export async function capturePayrollFinancialSnapshot(
  supabase: SupabaseClient,
  runId: string
): Promise<{ ok: true; snapshot: PayrollFinancialSnapshot } | { ok: false; error: string }> {
  const { data: run, error: runError } = await supabase
    .from("payroll_runs")
    .select(
      "total_gross_salary, total_allowances, total_deductions, total_ssnit_employee, total_ssnit_employer, total_paye, total_net_salary"
    )
    .eq("id", runId)
    .maybeSingle()

  if (runError || !run) {
    return {
      ok: false,
      error: runError?.message || "Failed to read payroll totals for recalculation review",
    }
  }

  const { data: entries, error: entriesError } = await supabase
    .from("payroll_entries")
    .select(
      "staff_id, is_included, gross_salary, allowances_total, deductions_total, ssnit_employee, ssnit_employer, paye, net_salary, filing_employee_name, staff:staff_id(name)"
    )
    .eq("payroll_run_id", runId)

  if (entriesError) {
    return { ok: false, error: entriesError.message }
  }

  const employees = (entries || [])
    .filter((entry) => entry.is_included !== false)
    .map((entry) => {
      const staff = Array.isArray(entry.staff) ? entry.staff[0] : entry.staff
      return {
        staff_id: String(entry.staff_id),
        staff_name: staff?.name ?? entry.filing_employee_name ?? null,
        ...fromEntryRow(entry),
      }
    })

  return {
    ok: true,
    snapshot: {
      totals: fromRunRow(run),
      employees,
    },
  }
}

export type DraftApprovalRefreshResult =
  | { ok: true; changed: boolean }
  | {
      ok: false
      status: number
      error: string
      code?: string
      details?: Record<string, unknown>
    }

/**
 * Refresh a draft for approval without ever approving changed amounts.
 *
 * The draft is recalculated through the existing controlled mechanism. If any
 * financial amount changed, the caller must stop and require an explicit review
 * and a subsequent approval request.
 */
export async function refreshDraftStatutoryRatesForApproval(params: {
  supabase: SupabaseClient
  businessId: string
  businessCountry: string | null | undefined
  runId: string
}): Promise<DraftApprovalRefreshResult> {
  const before = await capturePayrollFinancialSnapshot(params.supabase, params.runId)
  if (!before.ok) {
    return { ok: false, status: 500, error: before.error }
  }

  const refreshed = await refreshGhanaDraftStatutoryRates(params)
  if (!refreshed.ok) {
    return { ok: false, status: refreshed.status, error: refreshed.error }
  }

  const after = await capturePayrollFinancialSnapshot(params.supabase, params.runId)
  if (!after.ok) {
    return { ok: false, status: 500, error: after.error }
  }

  const diff = comparePayrollFinancialSnapshots(before.snapshot, after.snapshot)
  if (diff.changed) {
    return {
      ok: false,
      status: 409,
      code: PAYROLL_RECALCULATION_REVIEW_REQUIRED,
      error: "Payroll calculations updated",
      details: {
        message:
          "Some payroll amounts have changed because the applicable statutory rates were updated. Review the revised payroll before approving.",
        totals: diff.totals,
        employees: diff.employees,
        before: before.snapshot,
        after: after.snapshot,
      },
    }
  }

  return { ok: true, changed: refreshed.changed }
}
