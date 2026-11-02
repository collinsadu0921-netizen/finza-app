import type { SupabaseClient } from "@supabase/supabase-js"
import {
  computeStaffPayrollEntry,
  isPayrollEngineCountryError,
  type ComputedPayrollEntryRow,
  type StaffPayrollInput,
} from "@/lib/payroll/computeStaffPayrollEntry"
import { GHANA_ENGINE_V2, GHANA_ENGINE_V3 } from "@/lib/payrollEngine/jurisdictions/ghanaProfileTax"
import { filterPayrollItemsForRun } from "@/lib/payroll/periodPayrollItems"
import { rollupPayrollRunTotals } from "@/lib/payroll/rollupPayrollRunTotals"
import {
  exclusionReasonForSalaryBasisMismatch,
  parseSalaryBasis,
  salaryBasisMatchesFrequency,
} from "@/lib/payroll/salaryBasis"
import { syncPayrollRunStaffScopeFingerprint } from "@/lib/payroll/syncPayrollRunStaffScope"
import { resolveRunStatutoryPeriodDate } from "@/lib/payroll/payrollStatutoryPeriod"

export type DraftPayrollRunForRecalc = {
  id: string
  status: string
  payroll_month: string
  pay_period_start?: string | null
  pay_period_end?: string | null
  payroll_frequency?: string | null
  business_id: string
  paye_rate_version?: string | null
  pension_rate_version?: string | null
  statutory_period_basis?: string | null
  calculation_engine_version?: string | null
  updated_at?: string | null
}

export type DraftPayrollEntryForRecalc = Record<string, unknown> & {
  id: string
  staff_id: string
  updated_at?: string | null
}

export type GhanaRateVersionsForRecalc = {
  payeRateVersion: string
  pensionRateVersion: string
  periodBasis: string
}

function engineVersionForRun(
  calculationEngineVersion: string | null | undefined
): string | undefined {
  return calculationEngineVersion === GHANA_ENGINE_V3
    ? GHANA_ENGINE_V3
    : calculationEngineVersion === GHANA_ENGINE_V2
      ? GHANA_ENGINE_V2
      : undefined
}

async function loadStaffAndPayrollItems(params: {
  supabase: SupabaseClient
  businessId: string
  staffId: string
  runId: string
  payrollFrequency: string
  statutoryPeriod: string
}) {
  const { supabase, businessId, staffId, runId, payrollFrequency, statutoryPeriod } = params

  const { data: staff } = await supabase
    .from("staff")
    .select("*")
    .eq("id", staffId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (!staff) {
    return { ok: false as const, error: "Staff not found", status: 404 }
  }

  const [{ data: allowances }, { data: deductions }, { data: salaryAdvances }] = await Promise.all([
    supabase
      .from("allowances")
      .select("id, type, amount, recurring, description, applies_to_month, payroll_run_id")
      .eq("staff_id", staffId)
      .is("deleted_at", null),
    supabase
      .from("deductions")
      .select("id, type, amount, recurring, description, applies_to_month, payroll_run_id, advance_id")
      .eq("staff_id", staffId)
      .is("deleted_at", null),
    supabase
      .from("salary_advances")
      .select("id, staff_id, business_id, amount, repaid_amount, status, cancelled_at")
      .eq("business_id", businessId)
      .eq("staff_id", staffId)
      .is("cancelled_at", null)
      .neq("status", "cancelled"),
  ])

  const filtered = filterPayrollItemsForRun({
    allowances: allowances || [],
    deductions: deductions || [],
    payrollRunId: runId,
    payrollFrequency,
    payrollMonth: statutoryPeriod,
  })

  return {
    ok: true as const,
    staff,
    allowances: allowances || [],
    deductions: deductions || [],
    salaryAdvances: salaryAdvances || [],
    filtered,
  }
}

function computeDraftEntryUpdate(params: {
  staff: StaffPayrollInput
  existingEntry: DraftPayrollEntryForRecalc
  payrollRun: DraftPayrollRunForRecalc
  businessCountry: string
  businessId: string
  runId: string
  statutoryPeriod: string
  ghanaRateVersions: GhanaRateVersionsForRecalc | null
  includedAllowances: Parameters<typeof computeStaffPayrollEntry>[0]["allowances"]
  includedDeductions: Parameters<typeof computeStaffPayrollEntry>[0]["deductions"]
  oneOffItemsSnapshot: Parameters<typeof computeStaffPayrollEntry>[0]["oneOffItemsSnapshot"]
  salaryAdvances: NonNullable<Parameters<typeof computeStaffPayrollEntry>[0]["salaryAdvances"]>
}): Omit<ComputedPayrollEntryRow, "staff_id"> {
  const {
    staff,
    existingEntry,
    payrollRun,
    businessCountry,
    businessId,
    statutoryPeriod,
    ghanaRateVersions,
    includedAllowances,
    includedDeductions,
    oneOffItemsSnapshot,
    salaryAdvances,
  } = params

  const salaryBasis = parseSalaryBasis(
    (existingEntry.salary_basis as string | null) ??
      (staff.salary_basis as string | null) ??
      "monthly"
  )
  const frequency = String(payrollRun.payroll_frequency || "monthly")
  const eligible = salaryBasisMatchesFrequency(salaryBasis, frequency)

  const computed = computeStaffPayrollEntry({
    staff,
    businessCountry,
    effectiveDate: statutoryPeriod,
    allowances: eligible ? includedAllowances : [],
    deductions: eligible ? includedDeductions : [],
    isIncluded: eligible,
    adjustmentAmount: eligible ? Number(existingEntry.adjustment_amount || 0) : 0,
    baseSalarySnapshot: Number(existingEntry.base_salary_snapshot ?? staff.basic_salary) || 0,
    adjustmentReason: eligible ? (existingEntry.adjustment_reason as string | null) : null,
    exclusionReason: eligible
      ? null
      : exclusionReasonForSalaryBasisMismatch(salaryBasis, frequency),
    salaryBasisSnapshot: salaryBasis,
    oneOffItemsSnapshot: eligible ? oneOffItemsSnapshot : [],
    ghanaRateVersions,
    businessId,
    salaryAdvances,
    calculationEngineVersion: engineVersionForRun(payrollRun.calculation_engine_version),
    lockTaxProfile: payrollRun.calculation_engine_version === GHANA_ENGINE_V3,
    existingPayrollTaxProfile:
      payrollRun.calculation_engine_version === GHANA_ENGINE_V3
        ? (existingEntry.payroll_tax_profile as Record<string, unknown> | null)
        : null,
    existingIncomeTaxMethod:
      payrollRun.calculation_engine_version === GHANA_ENGINE_V3
        ? (existingEntry.income_tax_method as string | null)
        : null,
    existingIncomeTaxMethodVersion:
      payrollRun.calculation_engine_version === GHANA_ENGINE_V3
        ? (existingEntry.income_tax_method_version as string | null)
        : null,
  })

  const { staff_id: _sid, ...entryUpdate } = computed
  return entryUpdate
}

/**
 * Compute a draft entry recalculation without writing anything.
 *
 * Refresh uses this for every employee first; only after every calculation
 * succeeds is the complete payload applied atomically.
 */
export async function computeDraftEntryRecalculation(params: {
  supabase: SupabaseClient
  businessId: string
  businessCountry: string
  runId: string
  staffId: string
  payrollRun: DraftPayrollRunForRecalc
  existingEntry: DraftPayrollEntryForRecalc
  statutoryPeriod: string
  ghanaRateVersions: GhanaRateVersionsForRecalc | null
}): Promise<
  | {
      ok: true
      entryId: string
      expectedUpdatedAt: string | null
      entryUpdate: Omit<ComputedPayrollEntryRow, "staff_id">
    }
  | { ok: false; error: string; status: number }
> {
  const { supabase, businessId, businessCountry, runId, staffId, payrollRun, existingEntry } =
    params
  const frequency = String(payrollRun.payroll_frequency || "monthly")

  try {
    const loaded = await loadStaffAndPayrollItems({
      supabase,
      businessId,
      staffId,
      runId,
      payrollFrequency: frequency,
      statutoryPeriod: params.statutoryPeriod,
    })
    if (!loaded.ok) return loaded

    const entryUpdate = computeDraftEntryUpdate({
      staff: loaded.staff,
      existingEntry,
      payrollRun,
      businessCountry,
      businessId,
      runId,
      statutoryPeriod: params.statutoryPeriod,
      ghanaRateVersions: params.ghanaRateVersions,
      includedAllowances: loaded.filtered.includedAllowances,
      includedDeductions: loaded.filtered.includedDeductions,
      oneOffItemsSnapshot: loaded.filtered.oneOffSnapshots,
      salaryAdvances: loaded.salaryAdvances,
    })

    return {
      ok: true,
      entryId: existingEntry.id,
      expectedUpdatedAt: existingEntry.updated_at ?? null,
      entryUpdate,
    }
  } catch (error: unknown) {
    if (isPayrollEngineCountryError(error)) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: 400,
      }
    }
    throw error
  }
}

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
    .select(
      "id, status, payroll_month, pay_period_start, pay_period_end, payroll_frequency, business_id, paye_rate_version, pension_rate_version, statutory_period_basis, calculation_engine_version, updated_at"
    )
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

  const { data: existingEntry } = await supabase
    .from("payroll_entries")
    .select("*")
    .eq("payroll_run_id", runId)
    .eq("staff_id", staffId)
    .maybeSingle()

  if (!existingEntry) {
    return { ok: false, error: "Payroll entry not found for this staff member on the run", status: 404 }
  }

  const statutoryPeriod =
    resolveRunStatutoryPeriodDate(payrollRun) ?? String(payrollRun.payroll_month)
  const ghanaRateVersions =
    payrollRun.paye_rate_version && payrollRun.pension_rate_version
      ? {
          payeRateVersion: String(payrollRun.paye_rate_version),
          pensionRateVersion: String(payrollRun.pension_rate_version),
          periodBasis: statutoryPeriod,
        }
      : null

  try {
    const loaded = await loadStaffAndPayrollItems({
      supabase,
      businessId,
      staffId,
      runId,
      payrollFrequency: String(payrollRun.payroll_frequency || "monthly"),
      statutoryPeriod,
    })
    if (!loaded.ok) return loaded

    const entryUpdate = computeDraftEntryUpdate({
      staff: loaded.staff,
      existingEntry,
      payrollRun,
      businessCountry,
      businessId,
      runId,
      statutoryPeriod,
      ghanaRateVersions,
      includedAllowances: loaded.filtered.includedAllowances,
      includedDeductions: loaded.filtered.includedDeductions,
      oneOffItemsSnapshot: loaded.filtered.oneOffSnapshots,
      salaryAdvances: loaded.salaryAdvances,
    })

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
        "is_included, basic_salary, gross_salary, allowances_total, deductions_total, ssnit_employee, ssnit_employer, paye, net_salary"
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
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: 400,
      }
    }
    throw error
  }
}
