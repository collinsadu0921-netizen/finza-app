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
  GHANA_ENGINE_V2,
  GHANA_ENGINE_V3,
  GHANA_NEW_RUN_ENGINE_VERSION,
  assertGhanaProfileTaxVersionCoversPeriod,
  calculateGhanaCasualFlatTax,
  calculateGhanaNonResidentSplitTax,
  methodMatchesProfile,
  resolveGhanaIncomeTaxMethodFromProfile,
  resolveGhanaProfileTaxRatesForPeriod,
  type GhanaIncomeTaxMethod,
  type GhanaProfileTaxRates,
} from "@/lib/payrollEngine/jurisdictions/ghanaProfileTax"
import { resolveGhanaStatutoryRatesForPeriod } from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
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
  /** Ghana: finza-ghana-v2 or finza-ghana-v3; defaults to GHANA_NEW_RUN_ENGINE_VERSION for new Ghana runs. */
  calculationEngineVersion?: string | null
  /** Locked payroll_tax_profile snapshot (v3 recalc). */
  existingPayrollTaxProfile?: Record<string, unknown> | null
  /** When true, reuse existingPayrollTaxProfile and optional locked income-tax method. */
  lockTaxProfile?: boolean
  existingIncomeTaxMethod?: string | null
  existingIncomeTaxMethodVersion?: string | null
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
  income_tax_method: string | null
  income_tax_method_version: string | null
  income_tax_regular_base: number | null
  income_tax_regular_amount: number | null
  income_tax_bonus_base: number | null
  income_tax_bonus_amount: number | null
  income_tax_overtime_base: number | null
  income_tax_overtime_amount: number | null
}

export const GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE = "GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE"

const NULL_INCOME_TAX_FIELDS: Pick<
  ComputedPayrollEntryRow,
  | "income_tax_method"
  | "income_tax_method_version"
  | "income_tax_regular_base"
  | "income_tax_regular_amount"
  | "income_tax_bonus_base"
  | "income_tax_bonus_amount"
  | "income_tax_overtime_base"
  | "income_tax_overtime_amount"
> = {
  income_tax_method: null,
  income_tax_method_version: null,
  income_tax_regular_base: null,
  income_tax_regular_amount: null,
  income_tax_bonus_base: null,
  income_tax_bonus_amount: null,
  income_tax_overtime_base: null,
  income_tax_overtime_amount: null,
}

function ghanaUnsupportedProfileError(classification: string): Error {
  return new Error(`${GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE}:${classification}`)
}

function resolveGhanaEngineVersion(calculationEngineVersion: string | null | undefined): string {
  const explicit = String(calculationEngineVersion || "").trim()
  if (explicit) return explicit
  return GHANA_NEW_RUN_ENGINE_VERSION
}

function adjustRegularIncomeTaxAmount(
  paye: number,
  bonusAmount: number,
  overtimeAmount: number,
  regularAmount: number
): number {
  const total = roundPayroll(regularAmount + bonusAmount + overtimeAmount)
  const diff = roundPayroll(paye - total)
  if (Math.abs(diff) <= 0.01) {
    return roundPayroll(regularAmount + diff)
  }
  return regularAmount
}

function applyGhanaV3IncomeTax(opts: {
  method: GhanaIncomeTaxMethod
  profileTaxRates: GhanaProfileTaxRates
  profile: Record<string, unknown>
  paye: number
  taxableIncome: number
  netSalary: number
  grossSalary: number
  basicSalary: number
  regularAllowancesAmount: number
  bonusAmount: number
  overtimeAmount: number
  employeePension: number
  otherDeductions: number
  bonusTax5: number
  bonusTaxGraduated: number
  overtimeTax5: number
  overtimeTax10: number
  overtimeTaxGraduated: number
}): {
  paye: number
  taxableIncome: number
  netSalary: number
  bonusTax5: number
  bonusTaxGraduated: number
  overtimeTax5: number
  overtimeTax10: number
  overtimeTaxGraduated: number
  incomeTaxMethod: string
  incomeTaxMethodVersion: string
  incomeTaxRegularBase: number
  incomeTaxRegularAmount: number
  incomeTaxBonusBase: number
  incomeTaxBonusAmount: number
  incomeTaxOvertimeBase: number
  incomeTaxOvertimeAmount: number
  payrollTaxProfile: Record<string, unknown>
} {
  const profile = { ...opts.profile }

  if (opts.method === "gh_casual_flat_5") {
    const breakdown = calculateGhanaCasualFlatTax({
      grossRemuneration: opts.grossSalary,
      rates: opts.profileTaxRates,
    })
    const paye = breakdown.totalIncomeTax
    const netSalary = Math.max(
      0,
      roundPayroll(opts.grossSalary - opts.employeePension - paye - opts.otherDeductions)
    )
    profile.casual_worker_flat_tax_applied = true
    profile.income_tax_method = breakdown.incomeTaxMethod
    profile.income_tax_method_version = breakdown.incomeTaxMethodVersion

    return {
      paye,
      taxableIncome: opts.grossSalary,
      netSalary,
      bonusTax5: 0,
      bonusTaxGraduated: 0,
      overtimeTax5: 0,
      overtimeTax10: 0,
      overtimeTaxGraduated: 0,
      incomeTaxMethod: breakdown.incomeTaxMethod,
      incomeTaxMethodVersion: breakdown.incomeTaxMethodVersion,
      incomeTaxRegularBase: breakdown.incomeTaxRegularBase,
      incomeTaxRegularAmount: breakdown.incomeTaxRegularAmount,
      incomeTaxBonusBase: 0,
      incomeTaxBonusAmount: 0,
      incomeTaxOvertimeBase: 0,
      incomeTaxOvertimeAmount: 0,
      payrollTaxProfile: profile,
    }
  }

  if (opts.method === "gh_nonresident_split_25_20") {
    const regularEmployment = roundPayroll(opts.basicSalary + opts.regularAllowancesAmount)
    const breakdown = calculateGhanaNonResidentSplitTax({
      regularEmploymentAmount: regularEmployment,
      employeePension: opts.employeePension,
      bonusAmount: opts.bonusAmount,
      overtimeAmount: opts.overtimeAmount,
      rates: opts.profileTaxRates,
    })
    const paye = breakdown.totalIncomeTax
    const netSalary = Math.max(
      0,
      roundPayroll(opts.grossSalary - opts.employeePension - paye - opts.otherDeductions)
    )
    profile.income_tax_method = breakdown.incomeTaxMethod
    profile.income_tax_method_version = breakdown.incomeTaxMethodVersion
    profile.non_resident_regular_rate = opts.profileTaxRates.nonResidentRegularRate
    profile.non_resident_bonus_rate = opts.profileTaxRates.nonResidentBonusRate
    profile.non_resident_overtime_rate = opts.profileTaxRates.nonResidentOvertimeRate

    return {
      paye,
      taxableIncome: breakdown.incomeTaxRegularBase,
      netSalary,
      bonusTax5: 0,
      bonusTaxGraduated: breakdown.incomeTaxBonusAmount,
      overtimeTax5: 0,
      overtimeTax10: 0,
      overtimeTaxGraduated: breakdown.incomeTaxOvertimeAmount,
      incomeTaxMethod: breakdown.incomeTaxMethod,
      incomeTaxMethodVersion: breakdown.incomeTaxMethodVersion,
      incomeTaxRegularBase: breakdown.incomeTaxRegularBase,
      incomeTaxRegularAmount: breakdown.incomeTaxRegularAmount,
      incomeTaxBonusBase: breakdown.incomeTaxBonusBase,
      incomeTaxBonusAmount: breakdown.incomeTaxBonusAmount,
      incomeTaxOvertimeBase: breakdown.incomeTaxOvertimeBase,
      incomeTaxOvertimeAmount: breakdown.incomeTaxOvertimeAmount,
      payrollTaxProfile: profile,
    }
  }

  const bonusTaxTotal = roundPayroll(opts.bonusTax5 + opts.bonusTaxGraduated)
  const overtimeTaxTotal = roundPayroll(
    opts.overtimeTax5 + opts.overtimeTax10 + opts.overtimeTaxGraduated
  )
  let regularAmount = roundPayroll(opts.paye - bonusTaxTotal - overtimeTaxTotal)
  regularAmount = adjustRegularIncomeTaxAmount(
    opts.paye,
    bonusTaxTotal,
    overtimeTaxTotal,
    regularAmount
  )

  const regularBase = roundPayroll(
    Math.max(0, opts.taxableIncome - opts.bonusAmount - opts.overtimeAmount)
  )

  profile.income_tax_method = "gh_resident_graduated"
  profile.income_tax_method_version = opts.profileTaxRates.version

  return {
    paye: opts.paye,
    taxableIncome: opts.taxableIncome,
    netSalary: opts.netSalary,
    bonusTax5: opts.bonusTax5,
    bonusTaxGraduated: opts.bonusTaxGraduated,
    overtimeTax5: opts.overtimeTax5,
    overtimeTax10: opts.overtimeTax10,
    overtimeTaxGraduated: opts.overtimeTaxGraduated,
    incomeTaxMethod: "gh_resident_graduated",
    incomeTaxMethodVersion: opts.profileTaxRates.version,
    incomeTaxRegularBase: regularBase,
    incomeTaxRegularAmount: regularAmount,
    incomeTaxBonusBase: opts.bonusAmount,
    incomeTaxBonusAmount: bonusTaxTotal,
    incomeTaxOvertimeBase: opts.overtimeAmount,
    incomeTaxOvertimeAmount: overtimeTaxTotal,
    payrollTaxProfile: profile,
  }
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
    ...NULL_INCOME_TAX_FIELDS,
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
    calculationEngineVersion = null,
    existingPayrollTaxProfile = null,
    lockTaxProfile = false,
    existingIncomeTaxMethod = null,
    existingIncomeTaxMethodVersion = null,
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
    const ghanaEngine = resolveGhanaEngineVersion(calculationEngineVersion)
    versionMeta = {
      calculation_engine_version: ghanaEngine,
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

  if (breakdown?.payeRateVersion) {
    versionMeta.paye_rate_version = String(breakdown.payeRateVersion)
  }
  if (breakdown?.pensionRateVersion) {
    versionMeta.pension_rate_version = String(breakdown.pensionRateVersion)
  }
  if (breakdown?.statutoryPeriodBasis) {
    versionMeta.statutory_period_basis = String(breakdown.statutoryPeriodBasis)
  }

  const ghanaEngine = versionMeta.calculation_engine_version
  let payrollTaxProfile = filing.payroll_tax_profile
  let bonusTax5 = Number(breakdown?.bonusTax5 ?? 0)
  let bonusTaxGraduated = Number(breakdown?.bonusTaxGraduated ?? 0)
  let overtimeTax5 = Number(breakdown?.overtimeTax5 ?? 0)
  let overtimeTax10 = Number(breakdown?.overtimeTax10 ?? 0)
  let overtimeTaxGraduated = Number(breakdown?.overtimeTaxGraduated ?? 0)
  let incomeTaxFields: typeof NULL_INCOME_TAX_FIELDS = { ...NULL_INCOME_TAX_FIELDS }

  const bonusAmt = Number(breakdown?.bonusAmount ?? bonusAmount)
  const overtimeAmt = Number(breakdown?.overtimeAmount ?? overtimeAmount)
  const regularAllowancesAmt = Number(breakdown?.regularAllowancesAmount ?? regularAllowances)

  if (isGhanaCountry(businessCountry) && ghanaEngine === GHANA_ENGINE_V3) {
    if (lockTaxProfile && existingPayrollTaxProfile && typeof existingPayrollTaxProfile === "object") {
      payrollTaxProfile = { ...existingPayrollTaxProfile }
    }

    const profileTaxRates = existingIncomeTaxMethodVersion
      ? assertGhanaProfileTaxVersionCoversPeriod(existingIncomeTaxMethodVersion, effectiveDate)
      : resolveGhanaProfileTaxRatesForPeriod(effectiveDate)

    let method: GhanaIncomeTaxMethod
    if (lockTaxProfile && existingIncomeTaxMethod) {
      method = existingIncomeTaxMethod as GhanaIncomeTaxMethod
      if (!methodMatchesProfile(method, payrollTaxProfile)) {
        throw ghanaUnsupportedProfileError("income_tax_method_profile_mismatch")
      }
    } else {
      const resolved = resolveGhanaIncomeTaxMethodFromProfile(payrollTaxProfile)
      if (!resolved.ok) {
        throw ghanaUnsupportedProfileError(resolved.unsupportedClassification)
      }
      method = resolved.method
    }

    const v3 = applyGhanaV3IncomeTax({
      method,
      profileTaxRates,
      profile: payrollTaxProfile,
      paye,
      taxableIncome,
      netSalary,
      grossSalary: payrollResult.earnings.grossSalary,
      basicSalary: payrollResult.earnings.basicSalary,
      regularAllowancesAmount: regularAllowancesAmt,
      bonusAmount: bonusAmt,
      overtimeAmount: overtimeAmt,
      employeePension: employeeStatutoryContributions,
      otherDeductions: payrollResult.totals.totalOtherDeductions,
      bonusTax5,
      bonusTaxGraduated,
      overtimeTax5,
      overtimeTax10,
      overtimeTaxGraduated,
    })

    paye = v3.paye
    taxableIncome = v3.taxableIncome
    netSalary = v3.netSalary
    bonusTax5 = v3.bonusTax5
    bonusTaxGraduated = v3.bonusTaxGraduated
    overtimeTax5 = v3.overtimeTax5
    overtimeTax10 = v3.overtimeTax10
    overtimeTaxGraduated = v3.overtimeTaxGraduated
    payrollTaxProfile = v3.payrollTaxProfile
    incomeTaxFields = {
      income_tax_method: v3.incomeTaxMethod,
      income_tax_method_version: v3.incomeTaxMethodVersion,
      income_tax_regular_base: v3.incomeTaxRegularBase,
      income_tax_regular_amount: v3.incomeTaxRegularAmount,
      income_tax_bonus_base: v3.incomeTaxBonusBase,
      income_tax_bonus_amount: v3.incomeTaxBonusAmount,
      income_tax_overtime_base: v3.incomeTaxOvertimeBase,
      income_tax_overtime_amount: v3.incomeTaxOvertimeAmount,
    }
  } else if (isGhanaCountry(businessCountry) && ghanaEngine === GHANA_ENGINE_V2) {
    if (breakdown?.calculationEngineVersion) {
      versionMeta.calculation_engine_version = String(breakdown.calculationEngineVersion)
    }
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
    regular_allowances_amount: regularAllowancesAmt,
    bonus_amount: bonusAmt,
    overtime_amount: overtimeAmt,
    deductions_total: payrollResult.totals.totalOtherDeductions,
    gross_salary: payrollResult.earnings.grossSalary,
    ssnit_employee: employeeStatutoryContributions,
    ssnit_employer: employerStatutoryContributions,
    taxable_income: taxableIncome,
    paye,
    bonus_tax_5: bonusTax5,
    bonus_tax_graduated: bonusTaxGraduated,
    overtime_tax_5: overtimeTax5,
    overtime_tax_10: overtimeTax10,
    overtime_tax_graduated: overtimeTaxGraduated,
    is_qualifying_junior_employee: Boolean(breakdown?.isQualifyingJuniorEmployee ?? false),
    bonus_cap_amount: Number(breakdown?.bonusCapAmount ?? 0),
    overtime_threshold_amount: Number(breakdown?.overtimeThresholdAmount ?? 0),
    net_salary: netSalary,
    ...pensionSnapshots,
    filing_tin: filing.filing_tin,
    filing_employee_name: filing.filing_employee_name,
    bonus_concessional_amount: filing.bonus_concessional_amount,
    bonus_graduated_amount: filing.bonus_graduated_amount,
    payroll_tax_profile: payrollTaxProfile,
    ...incomeTaxFields,
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
