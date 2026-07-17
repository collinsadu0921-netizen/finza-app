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
  amount?: number | null
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
  oneOffItemsSnapshot: OneOffItemSnapshot[] = []
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
  } = params

  const salaryBasis = parseSalaryBasis(salaryBasisSnapshot ?? staff.salary_basis ?? "monthly")
  const oneOffSnapshot = Array.isArray(oneOffItemsSnapshot) ? oneOffItemsSnapshot : []

  const baseSnapshot =
    baseSalarySnapshot !== undefined ? Number(baseSalarySnapshot) || 0 : Number(staff.basic_salary) || 0
  const adjustment = Number(adjustmentAmount) || 0
  const effectiveBasic = Math.max(0, baseSnapshot + adjustment)

  if (!isIncluded) {
    return zeroEntry(
      staff,
      baseSnapshot,
      adjustment,
      adjustmentReason,
      exclusionReason,
      false,
      salaryBasis,
      oneOffSnapshot
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

  const deductionsTotal =
    deductions?.reduce((sum, d) => sum + Number(d.amount || 0), 0) || 0

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

    const country = String(businessCountry || "").toUpperCase()
    if (country === "GH" || country === "GHANA") {
      const payeInputs = ghanaPayeInputsFromBreakdown(
        breakdown as Record<string, unknown> | null | undefined,
        payrollResult.earnings.basicSalary
      )
      const adjusted = recalculateGhanaEntryAfterRemovingSsnit({
        grossSalary: payrollResult.earnings.grossSalary,
        otherDeductions: payrollResult.totals.totalOtherDeductions,
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
        pensionableBase: payrollResult.earnings.basicSalary,
        employeeContribution: employeeStatutoryContributions,
        employerContribution: employerStatutoryContributions,
      })
    : deriveEntryPensionSnapshots({
        pensionableBase: 0,
        employeeContribution: 0,
        employerContribution: 0,
      })

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
  }
}

export function isPayrollEngineCountryError(error: unknown): error is MissingCountryError | UnsupportedCountryError {
  return error instanceof MissingCountryError || error instanceof UnsupportedCountryError
}
