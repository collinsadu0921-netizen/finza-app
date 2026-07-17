import type { SupabaseClient } from "@supabase/supabase-js"
import {
  computeStaffPayrollEntry,
  isPayrollEngineCountryError,
} from "@/lib/payroll/computeStaffPayrollEntry"
import { filterPayrollItemsForRun } from "@/lib/payroll/periodPayrollItems"
import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"
import {
  exclusionReasonForSalaryBasisMismatch,
  parseSalaryBasis,
  salaryBasisMatchesFrequency,
} from "@/lib/payroll/salaryBasis"
import { syncPayrollRunStaffScopeFingerprint } from "@/lib/payroll/syncPayrollRunStaffScope"

/** Recalculate one draft payroll entry after one-off item assignment changes. */
export async function recalcPayrollEntryForStaffOnDraftRun(params: {
  supabase: SupabaseClient
  businessId: string
  businessCountry: string
  runId: string
  staffId: string
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { supabase, businessId, businessCountry, runId, staffId } = params

  const { data: payrollRun } = await supabase
    .from("payroll_runs")
    .select("id, status, payroll_month, payroll_frequency, business_id")
    .eq("id", runId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!payrollRun) {
    return { ok: false, error: "Payroll run not found", status: 404 }
  }
  if (payrollRun.status !== "draft") {
    return { ok: false, error: "One-off items can only be assigned to draft payroll runs", status: 400 }
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("*")
    .eq("id", staffId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!staff) {
    return { ok: false, error: "Staff not found", status: 404 }
  }

  const { data: existingEntry } = await supabase
    .from("payroll_entries")
    .select("*")
    .eq("payroll_run_id", runId)
    .eq("staff_id", staffId)
    .maybeSingle()

  if (!existingEntry) {
    return { ok: false, error: "Payroll entry not found for this staff member on the run", status: 404 }
  }

  const salaryBasis = parseSalaryBasis(existingEntry.salary_basis ?? staff.salary_basis ?? "monthly")
  const frequency = String(payrollRun.payroll_frequency || "monthly")
  const eligible = salaryBasisMatchesFrequency(salaryBasis, frequency)

  const [{ data: allowances }, { data: deductions }] = await Promise.all([
    supabase
      .from("allowances")
      .select("id, type, amount, recurring, description, applies_to_month, payroll_run_id")
      .eq("staff_id", staffId)
      .is("deleted_at", null),
    supabase
      .from("deductions")
      .select("id, type, amount, recurring, description, applies_to_month, payroll_run_id")
      .eq("staff_id", staffId)
      .is("deleted_at", null),
  ])

  const filtered = filterPayrollItemsForRun({
    allowances: allowances || [],
    deductions: deductions || [],
    payrollRunId: runId,
    payrollFrequency: frequency,
    payrollMonth: payrollRun.payroll_month,
  })

  try {
    const computed = computeStaffPayrollEntry({
      staff,
      businessCountry,
      effectiveDate: payrollRun.payroll_month,
      allowances: eligible ? filtered.includedAllowances : [],
      deductions: eligible ? filtered.includedDeductions : [],
      isIncluded: eligible,
      adjustmentAmount: eligible ? Number(existingEntry.adjustment_amount || 0) : 0,
      baseSalarySnapshot: Number(existingEntry.base_salary_snapshot ?? staff.basic_salary) || 0,
      adjustmentReason: eligible ? existingEntry.adjustment_reason : null,
      exclusionReason: eligible
        ? null
        : exclusionReasonForSalaryBasisMismatch(salaryBasis, frequency),
      salaryBasisSnapshot: salaryBasis,
      oneOffItemsSnapshot: eligible ? filtered.oneOffSnapshots : [],
    })

    const { staff_id: _sid, ...entryUpdate } = computed
    const { error: updateError } = await supabase
      .from("payroll_entries")
      .update({ ...entryUpdate, updated_at: new Date().toISOString() })
      .eq("id", existingEntry.id)

    if (updateError) {
      return { ok: false, error: updateError.message, status: 500 }
    }

    const { data: entries } = await supabase
      .from("payroll_entries")
      .select(
        "is_included, gross_salary, allowances_total, deductions_total, ssnit_employee, ssnit_employer, paye, net_salary"
      )
      .eq("payroll_run_id", runId)

    const totals = rollupPayrollRunTotals(entries || [])
    await supabase
      .from("payroll_runs")
      .update({ ...totals, updated_at: new Date().toISOString() })
      .eq("id", runId)

    await syncPayrollRunStaffScopeFingerprint(supabase, runId)
    return { ok: true }
  } catch (error: unknown) {
    if (isPayrollEngineCountryError(error)) {
      return { ok: false, error: error.message, status: 400 }
    }
    throw error
  }
}
