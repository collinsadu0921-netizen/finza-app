import { calculatePayroll } from "@/lib/payrollEngine"
import { MissingCountryError, UnsupportedCountryError } from "@/lib/payrollEngine/errors"
import { deriveEntryPensionSnapshots } from "@/lib/payroll/deriveEntryPensionSnapshots"
import {
  ghanaPayeInputsFromBreakdown,
  recalculateGhanaEntryAfterRemovingSsnit,
} from "@/lib/payroll/ghanaNonPensionableAdjustments"
import type { OneOffItemSnapshot } from "@/lib/payroll/periodPayrollItems"
import { parseSalaryBasis, type SalaryBasis } from "@/lib/payroll/salaryBasis"
import { buildGraFilingFieldsForPayrollEntry, parseStaffIsPensionable } from "@/lib/payroll/staffTaxProfile"
import { roundPayroll } from "@/lib/payrollEngine/versioning"
import {
  GHANA_CALCULATION_ENGINE_VERSION,
  resolveGhanaStatutoryRatesForPeriod,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import {
  applyAdvanceRecoveryCaps,
  normalizeAdvanceRecoveriesSnapshot,
  type AdvanceRecoverySnapshotItem,
} from "@/lib/payroll/advanceRecoveriesSnapshot"

export type StaffPayrollInput = {
  id: string
  name?: string | null
  basic_salary?: number | null
  salary_basis?: string | null
  employment_type?: string | null
  position?: string | null
  tin_number?: string | null
  is_tax_resident?: boolean | null
  is_pensionable?: boolean | null
  gra_position_code?: string | null
  secondary_employment?: boolean | null
}

export type AllowanceRow = {
  type?: string | null
  amount?: number | null
}

export type DeductionRow = {
  id?: string | null
  amount?: number | null
  advance_id?: string | null
  type?: string | null
}

export type AdvanceBalanceForPayroll = {
  id: string
  staff_id: string
  business_id?: string | null
  amount: number
  repaid_amount?: number | null
  status?: string | null
  cancelled_at?: string | null
}

export type GhanaRateVersionLock = {
  payeRateVersion: string
  pensionRateVersion: string
  periodBasis: string
}

export type ComputeStaffPayrollEntryParams = {
  staff: StaffPayrollInput
  businessCountry: string
  effectiveDate: string
  allowances: AllowanceRow[] | null | undefined
  deductions: DeductionRow[] | null | undefined
  /** One-off basic salary delta for this run (negative = deduction). */
  adjustmentAmount?: number
  /** When false, returns zeroed amounts but preserves snapshot metadata. */
  isIncluded?: boolean
  /** Use stored snapshot instead of staff master salary (for recalc on existing lines). */
  baseSalarySnapshot?: number
  adjustmentReason?: string | null
  exclusionReason?: string | null
  /** Override snapshotted salary basis (defaults to staff.salary_basis / monthly). */
  salaryBasisSnapshot?: SalaryBasis | string | null
  oneOffItemsSnapshot?: OneOffItemSnapshot[] | null
  /**
   * Lock Ghana statutory versions (draft recalc / run create after resolve).
   * When omitted for GH, versions are resolved from effectiveDate.
   */
  ghanaRateVersions?: GhanaRateVersionLock | null
  /** Business id used to validate advance ownership when capping recoveries. */
  businessId?: string | null
  /** Outstanding advances for this staff (draft-time cap source). */
  salaryAdvances?: AdvanceBalanceForPayroll[] | null
  /**
   * When set (approved/locked recalc guard), reuse immutable snapshot and do not
   * rebuild from live deductions.
   */
  existingAdvanceRecoveriesSnapshot?: unknown
  lockAdvanceRecoveriesSnapshot?: boolean
}

export type ComputedPayrollEntryRow = {
  staff_id: string
  is_included: boolean
  base_salary_snapshot: number
  adjustment_amount: number
  adjustment_reason: string | null
  exclusion_reason: string | null
  salary_basis: SalaryBasis
  period_basic_pay: number
  one_off_items_snapshot: OneOffItemSnapshot[]
  basic_salary: number
  allowances_total: number
  regular_allowances_amount: number
  bonus_amount: number
  overtime_amount: number
  deductions_total: number
  gross_salary: number
  ssnit_employee: number
  ssnit_employer: number
  taxable_income: number
  paye: number
  bonus_tax_5: number
  bonus_tax_graduated: number
  overtime_tax_5: number
  overtime_tax_10: number
  overtime_tax_graduated: number
  is_qualifying_junior_employee: boolean
  bonus_cap_amount: number
  overtime_threshold_amount: number
  net_salary: number
  payroll_tax_profile: Record<string, unknown>
  filing_tin: string | null
  filing_employee_name: string | null
  bonus_concessional_amount: number
  bonus_graduated_amount: number
  pensionable_base: number
  employee_pension_contribution: number
  employer_pension_contribution: number
  total_mandatory_pension: number
  tier1_ssnit_remittance: number
  tier2_pension_remittance: number
  calculation_engine_version: string | null
  paye_rate_version: string | null
  pension_rate_version: string | null
  calculation_jurisdiction: string | null
  statutory_period_basis: string | null
  advance_recoveries_snapshot: AdvanceRecoverySnapshotItem[]
}

function isGhanaCountry(businessCountry: string): boolean {
  const c = String(businessCountry || "").trim().toUpperCase()
  return c === "GH" || c === "GHANA"
}

function isQualifyingJuniorEmployee(staff: StaffPayrollInput): boolean {
  const employmentType = String(staff.employment_type || "").toLowerCase()
  const position = String(staff.position || "").toLowerCase()
  return employmentType.includes("junior") || position.includes("junior")
}

function zeroEntry(
  staff: StaffPayrollInput,
  baseSnapshot: number,
  adjustmentAmount: number,
  adjustmentReason: string | null,
  exclusionReason: string | null,
  isIncluded: boolean,
  salaryBasis: SalaryBasis,
  oneOffItemsSnapshot: OneOffItemSnapshot[] = [],
  versionFields: Partial<ComputedPayrollEntryRow> = {}
): ComputedPayrollEntryRow {
  const filing = buildGraFilingFieldsForPayrollEntry({ staff, breakdown: null })
  return {
    staff_id: staff.id,
    is_included: isIncluded,
    base_salary_snapshot: baseSnapshot,
    adjustment_amount: adjustmentAmount,
    adjustment_reason: adjustmentReason,
    exclusion_reason: exclusionReason,
    salary_basis: salaryBasis,
    period_basic_pay: 0,
    one_off_items_snapshot: oneOffItemsSnapshot,
    basic_salary: 0,
    allowances_total: 0,
    regular_allowances_amount: 0,
    bonus_amount: 0,
    overtime_amount: 0,
    deductions_total: 0,
    gross_salary: 0,
    ssnit_employee: 0,
    ssnit_employer: 0,
    taxable_income: 0,
    paye: 0,
    bonus_tax_5: 0,
    bonus_tax_graduated: 0,
    overtime_tax_5: 0,
    overtime_tax_10: 0,
    overtime_tax_graduated: 0,
    is_qualifying_junior_employee: false,
    bonus_cap_amount: 0,
    overtime_threshold_amount: 0,
    net_salary: 0,
    pensionable_base: 0,
    employee_pension_contribution: 0,
    employer_pension_contribution: 0,
    total_mandatory_pension: 0,
    tier1_ssnit_remittance: 0,
    tier2_pension_remittance: 0,
    calculation_engine_version: versionFields.calculation_engine_version ?? null,
    paye_rate_version: versionFields.paye_rate_version ?? null,
    pension_rate_version: versionFields.pension_rate_version ?? null,
    calculation_jurisdiction: versionFields.calculation_jurisdiction ?? null,
    statutory_period_basis: versionFields.statutory_period_basis ?? null,
    advance_recoveries_snapshot: versionFields.advance_recoveries_snapshot ?? [],
    ...filing,
  }
}

export function computeStaffPayrollEntry(
  params: ComputeStaffPayrollEntryParams
): ComputedPayrollEntryRow {
  const {
    staff,
    businessCountry,
    effectiveDate,
    allowances,
    deductions,
    adjustmentAmount = 0,
    isIncluded = true,
    baseSalarySnapshot,
    adjustmentReason = null,
    exclusionReason = null,
    salaryBasisSnapshot,
    oneOffItemsSnapshot = null,
    ghanaRateVersions = null,
    businessId = null,
    salaryAdvances = null,
    existingAdvanceRecoveriesSnapshot = null,
    lockAdvanceRecoveriesSnapshot = false,
  } = params

  const salaryBasis = parseSalaryBasis(salaryBasisSnapshot ?? staff.salary_basis ?? "monthly")
  const oneOffSnapshot = Array.isArray(oneOffItemsSnapshot) ? oneOffItemsSnapshot : []

  const baseSnapshot =
    baseSalarySnapshot !== undefined ? Number(baseSalarySnapshot) || 0 : Number(staff.basic_salary) || 0
  const adjustment = Number(adjustmentAmount) || 0
  const effectiveBasic = Math.max(0, baseSnapshot + adjustment)

  let lockedVersions = ghanaRateVersions
  let versionMeta: Partial<ComputedPayrollEntryRow> = {
    calculation_engine_version: null,
    paye_rate_version: null,
    pension_rate_version: null,
    calculation_jurisdiction: isGhanaCountry(businessCountry) ? "GH" : null,
    statutory_period_basis: null,
    advance_recoveries_snapshot: [],
  }

  if (isGhanaCountry(businessCountry)) {
    if (!lockedVersions) {
      const resolved = resolveGhanaStatutoryRatesForPeriod(effectiveDate)
      lockedVersions = {
        payeRateVersion: resolved.paye.version,
        pensionRateVersion: resolved.pension.version,
        periodBasis: resolved.periodBasis,
      }
    }
    versionMeta = {
      calculation_engine_version: GHANA_CALCULATION_ENGINE_VERSION,
      paye_rate_version: lockedVersions.payeRateVersion,
      pension_rate_version: lockedVersions.pensionRateVersion,
      calculation_jurisdiction: "GH",
      statutory_period_basis: lockedVersions.periodBasis,
      advance_recoveries_snapshot: [],
    }
  }

  if (!isIncluded) {
    return zeroEntry(
      staff,
      baseSnapshot,
      adjustment,
      adjustmentReason,
      exclusionReason,
      false,
      salaryBasis,
      oneOffSnapshot,
      { ...versionMeta, advance_recoveries_snapshot: [] }
    )
  }

  const bonusAmount =
    allowances
      ?.filter((a) => String(a.type || "").toLowerCase() === "bonus")
      .reduce((sum, a) => sum + Number(a.amount || 0), 0) || 0
  const overtimeAmount =
    allowances
      ?.filter((a) => String(a.type || "").toLowerCase() === "overtime")
      .reduce((sum, a) => sum + Number(a.amount || 0), 0) || 0
  const regularAllowances =
    allowances
      ?.filter((a) => {
        const type = String(a.type || "").toLowerCase()
        return type !== "bonus" && type !== "overtime"
      })
      .reduce((sum, a) => sum + Number(a.amount || 0), 0) || 0
  const allowancesTotal = regularAllowances + bonusAmount + overtimeAmount

  let advanceRecoveriesSnapshot: AdvanceRecoverySnapshotItem[] = []
  let deductionsForCalc = deductions || []

  if (lockAdvanceRecoveriesSnapshot) {
    advanceRecoveriesSnapshot = normalizeAdvanceRecoveriesSnapshot(existingAdvanceRecoveriesSnapshot)
    const byAdvance = new Map(advanceRecoveriesSnapshot.map((item) => [item.advanceId, item.amount]))
    deductionsForCalc = (deductions || []).map((ded) => {
      const advanceId = ded.advance_id ? String(ded.advance_id) : ""
      if (!advanceId) return { ...ded, amount: roundPayroll(Number(ded.amount || 0)) }
      const snapped = byAdvance.get(advanceId)
      if (snapped == null) return { ...ded, amount: 0 }
      return { ...ded, amount: snapped }
    })
  } else {
    const capped = applyAdvanceRecoveryCaps({
      staffId: staff.id,
      businessId,
      deductions,
      advances: salaryAdvances,
    })
    deductionsForCalc = capped.deductionsForCalc
    advanceRecoveriesSnapshot = capped.advanceRecoveriesSnapshot
  }

  const deductionsTotal =
    deductionsForCalc?.reduce((sum, d) => sum + Number(d.amount || 0), 0) || 0

  const payrollResult = calculatePayroll(
    {
      jurisdiction: businessCountry,
      effectiveDate,
      basicSalary: effectiveBasic,
      allowances: allowancesTotal,
      otherDeductions: deductionsTotal,
      bonusAmount,
      overtimeAmount,
      isQualifyingJuniorEmployee: isQualifyingJuniorEmployee(staff),
      ...(lockedVersions ? { ghanaRateVersions: lockedVersions } : {}),
    },
    businessCountry
  )

  let employeeStatutoryContributions = payrollResult.statutoryDeductions
    .filter((d) => d.code !== "PAYE" && d.code !== "CBHI")
    .reduce((sum, d) => sum + (Number.isFinite(Number(d.amount)) ? Number(d.amount) : 0), 0)

  const payeDeduction = payrollResult.statutoryDeductions.find((d) => d.code === "PAYE")
  let paye = Number.isFinite(Number(payeDeduction?.amount)) ? Number(payeDeduction?.amount) : 0

  let employerStatutoryContributions = payrollResult.employerContributions.reduce(
    (sum, c) => sum + (Number.isFinite(Number(c.amount)) ? Number(c.amount) : 0),
    0
  )

  const breakdown = payrollResult.complianceBreakdown
  const isPensionable = parseStaffIsPensionable(staff.is_pensionable)
  let taxableIncome = payrollResult.totals.taxableIncome
  let netSalary = payrollResult.totals.netSalary

  if (!isPensionable) {
    const priorSsnitEmployee = employeeStatutoryContributions
    employeeStatutoryContributions = 0
    employerStatutoryContributions = 0

    if (isGhanaCountry(businessCountry)) {
      const payeInputs = ghanaPayeInputsFromBreakdown(
        breakdown as Record<string, unknown> | null | undefined,
        payrollResult.earnings.basicSalary
      )
      const adjusted = recalculateGhanaEntryAfterRemovingSsnit({
        grossSalary: payrollResult.earnings.grossSalary,
        otherDeductions: payrollResult.totals.totalOtherDeductions,
        payeRateVersion: lockedVersions?.payeRateVersion ?? breakdown?.payeRateVersion,
        effectiveDate,
        ...payeInputs,
      })
      paye = adjusted.paye
      taxableIncome = adjusted.taxableIncome
      netSalary = adjusted.netSalary
    } else {
      taxableIncome = roundPayroll(payrollResult.totals.taxableIncome + priorSsnitEmployee)
      netSalary = Math.max(
        0,
        roundPayroll(taxableIncome - paye - payrollResult.totals.totalOtherDeductions)
      )
    }
  }

  const filing = buildGraFilingFieldsForPayrollEntry({ staff, breakdown: breakdown ?? null })

  const pensionSnapshots = isPensionable
    ? deriveEntryPensionSnapshots({
        pensionableBase: Number(breakdown?.pensionableBase ?? payrollResult.earnings.basicSalary),
        employeeContribution: employeeStatutoryContributions,
        employerContribution: employerStatutoryContributions,
        tier1Remittance: Number(breakdown?.tier1SsnitRemittance ?? 0),
        tier2Remittance: Number(breakdown?.tier2PensionRemittance ?? 0),
      })
    : deriveEntryPensionSnapshots({
        pensionableBase: 0,
        employeeContribution: 0,
        employerContribution: 0,
        tier1Remittance: 0,
        tier2Remittance: 0,
      })

  if (breakdown?.calculationEngineVersion) {
    versionMeta.calculation_engine_version = String(breakdown.calculationEngineVersion)
  }
  if (breakdown?.payeRateVersion) {
    versionMeta.paye_rate_version = String(breakdown.payeRateVersion)
  }
  if (breakdown?.pensionRateVersion) {
    versionMeta.pension_rate_version = String(breakdown.pensionRateVersion)
  }
  if (breakdown?.statutoryPeriodBasis) {
    versionMeta.statutory_period_basis = String(breakdown.statutoryPeriodBasis)
  }

  return {
    staff_id: staff.id,
    is_included: true,
    base_salary_snapshot: baseSnapshot,
    adjustment_amount: adjustment,
    adjustment_reason: adjustmentReason,
    exclusion_reason: exclusionReason,
    salary_basis: salaryBasis,
    period_basic_pay: effectiveBasic,
    one_off_items_snapshot: oneOffSnapshot,
    basic_salary: payrollResult.earnings.basicSalary,
    allowances_total: payrollResult.earnings.allowances,
    regular_allowances_amount: Number(breakdown?.regularAllowancesAmount ?? allowancesTotal),
    bonus_amount: Number(breakdown?.bonusAmount ?? 0),
    overtime_amount: Number(breakdown?.overtimeAmount ?? 0),
    deductions_total: payrollResult.totals.totalOtherDeductions,
    gross_salary: payrollResult.earnings.grossSalary,
    ssnit_employee: employeeStatutoryContributions,
    ssnit_employer: employerStatutoryContributions,
    taxable_income: taxableIncome,
    paye,
    bonus_tax_5: Number(breakdown?.bonusTax5 ?? 0),
    bonus_tax_graduated: Number(breakdown?.bonusTaxGraduated ?? 0),
    overtime_tax_5: Number(breakdown?.overtimeTax5 ?? 0),
    overtime_tax_10: Number(breakdown?.overtimeTax10 ?? 0),
    overtime_tax_graduated: Number(breakdown?.overtimeTaxGraduated ?? 0),
    is_qualifying_junior_employee: Boolean(breakdown?.isQualifyingJuniorEmployee ?? false),
    bonus_cap_amount: Number(breakdown?.bonusCapAmount ?? 0),
    overtime_threshold_amount: Number(breakdown?.overtimeThresholdAmount ?? 0),
    net_salary: netSalary,
    ...pensionSnapshots,
    ...filing,
    calculation_engine_version: versionMeta.calculation_engine_version ?? null,
    paye_rate_version: versionMeta.paye_rate_version ?? null,
    pension_rate_version: versionMeta.pension_rate_version ?? null,
    calculation_jurisdiction: versionMeta.calculation_jurisdiction ?? null,
    statutory_period_basis: versionMeta.statutory_period_basis ?? null,
    advance_recoveries_snapshot: advanceRecoveriesSnapshot,
  }
}

export function isPayrollEngineCountryError(error: unknown): error is MissingCountryError | UnsupportedCountryError {
  return error instanceof MissingCountryError || error instanceof UnsupportedCountryError
}
