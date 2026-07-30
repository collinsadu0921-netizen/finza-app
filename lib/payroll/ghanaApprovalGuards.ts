/**
 * Ghana payroll approval containment — block unsupported tax profiles and unknown rate versions.
 *
 * For finza-ghana-v2 entries, payroll_entries.payroll_tax_profile is authoritative.
 * Live staff fields must not determine classification or repair missing snapshots.
 *
 * For finza-ghana-v3, profile method resolution uses exact employment_type matching.
 */

import {
  GHANA_ENGINE_V2,
  GHANA_ENGINE_V3,
  GHANA_INCOME_TAX_METHODS,
  assertGhanaProfileTaxVersionCoversPeriod,
  getGhanaProfileTaxRatesByVersion,
  isSupportedGhanaEngineVersion,
  methodMatchesProfile,
  resolveGhanaIncomeTaxMethodFromProfile,
  type GhanaIncomeTaxMethod,
} from "@/lib/payrollEngine/jurisdictions/ghanaProfileTax"
import {
  calculateGhanaPayeFromBands,
  clampGhanaPensionableBase,
  computeGhanaPensionAmounts,
  resolveGhanaStatutoryRatesByVersions,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import { normalizeEmploymentTypeForSnapshot } from "@/lib/payroll/staffTaxProfile"
import { isGhanaMonthlyStatutoryEngine } from "@/lib/payroll/salaryBasis"
import { roundPayroll, extractDatePart } from "@/lib/payrollEngine/versioning"

export const GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE = "GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE"
export const GHANA_PAYROLL_UNKNOWN_RATE_VERSION = "GHANA_PAYROLL_UNKNOWN_RATE_VERSION"
export const GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED = "GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED"

const AMOUNT_TOLERANCE = 0.01

export type UnsupportedTaxProfileEmployee = {
  staffId: string
  employeeName: string | null
  unsupportedClassification: string
}

export type GhanaApprovalBlockResult =
  | { ok: true }
  | {
      ok: false
      code: string
      message: string
      affectedEmployees: UnsupportedTaxProfileEmployee[]
    }

export type PayrollEntryForGhanaApproval = {
  staff_id: string
  is_included?: boolean | null
  calculation_engine_version?: string | null
  paye_rate_version?: string | null
  pension_rate_version?: string | null
  calculation_jurisdiction?: string | null
  statutory_period_basis?: string | null
  payroll_tax_profile?: Record<string, unknown> | null
  filing_employee_name?: string | null
  paye?: number | null
  income_tax_method?: string | null
  income_tax_method_version?: string | null
  income_tax_regular_base?: number | null
  income_tax_regular_amount?: number | null
  income_tax_bonus_base?: number | null
  income_tax_bonus_amount?: number | null
  income_tax_overtime_base?: number | null
  income_tax_overtime_amount?: number | null
  basic_salary?: number | null
  regular_allowances_amount?: number | null
  bonus_amount?: number | null
  overtime_amount?: number | null
  allowances_total?: number | null
  gross_salary?: number | null
  employee_pension_contribution?: number | null
  ssnit_employee?: number | null
  net_salary?: number | null
  deductions_total?: number | null
  taxable_income?: number | null
  bonus_tax_5?: number | null
  bonus_tax_graduated?: number | null
  overtime_tax_5?: number | null
  overtime_tax_10?: number | null
  overtime_tax_graduated?: number | null
  pensionable_base?: number | null
  employer_pension_contribution?: number | null
  total_mandatory_pension?: number | null
  tier1_ssnit_remittance?: number | null
  tier2_pension_remittance?: number | null
  ssnit_employer?: number | null
  bonus_cap_amount?: number | null
  bonus_concessional_amount?: number | null
  bonus_graduated_amount?: number | null
  overtime_threshold_amount?: number | null
  is_qualifying_junior_employee?: boolean | null
  /** Display / legacy diagnostics only — never authoritative for finza-ghana-v2 classification. */
  staff?: {
    id?: string
    name?: string | null
    employment_type?: string | null
    is_tax_resident?: boolean | null
    secondary_employment?: boolean | null
  } | null
}

function employeeName(entry: PayrollEntryForGhanaApproval): string | null {
  return (
    (entry.filing_employee_name && String(entry.filing_employee_name).trim()) ||
    (entry.staff?.name && String(entry.staff.name).trim()) ||
    null
  )
}

function profileHasBoolean(profile: Record<string, unknown>, key: string): boolean {
  return typeof profile[key] === "boolean"
}

function isFiniteNumber(value: unknown): value is number {
  return value != null && Number.isFinite(Number(value))
}

function amountsMatch(a: number, b: number): boolean {
  return Math.abs(roundPayroll(a) - roundPayroll(b)) <= AMOUNT_TOLERANCE
}

function profileString(profile: Record<string, unknown>, key: string): string | null {
  const value = profile[key]
  if (typeof value !== "string" || !value.trim()) return null
  return value.trim()
}

function hasEarningsSnapshot(entry: PayrollEntryForGhanaApproval): boolean {
  return (
    isFiniteNumber(entry.basic_salary) &&
    isFiniteNumber(entry.regular_allowances_amount) &&
    isFiniteNumber(entry.bonus_amount) &&
    isFiniteNumber(entry.overtime_amount) &&
    isFiniteNumber(entry.gross_salary) &&
    isFiniteNumber(entry.allowances_total)
  )
}

function hasNetSalarySnapshot(entry: PayrollEntryForGhanaApproval): boolean {
  return (
    isFiniteNumber(entry.net_salary) &&
    isFiniteNumber(entry.gross_salary) &&
    isFiniteNumber(entry.paye) &&
    isFiniteNumber(entry.deductions_total) &&
    (isFiniteNumber(entry.employee_pension_contribution) || isFiniteNumber(entry.ssnit_employee))
  )
}

function hasIncomeTaxBases(entry: PayrollEntryForGhanaApproval): boolean {
  return (
    isFiniteNumber(entry.income_tax_regular_base) &&
    isFiniteNumber(entry.income_tax_bonus_base) &&
    isFiniteNumber(entry.income_tax_overtime_base)
  )
}

function resolveEmployeePension(entry: PayrollEntryForGhanaApproval): number | null {
  if (isFiniteNumber(entry.employee_pension_contribution)) {
    return roundPayroll(entry.employee_pension_contribution)
  }
  if (isFiniteNumber(entry.ssnit_employee)) {
    return roundPayroll(entry.ssnit_employee)
  }
  return null
}

function resolveExpectedPension(
  entry: PayrollEntryForGhanaApproval,
  profile: Record<string, unknown>,
  periodDate: string
):
  | {
      pensionableBase: number
      employeeContribution: number
      employerContribution: number
      tier1: number
      tier2: number
      totalMandatory: number
    }
  | null {
  if (!isFiniteNumber(entry.basic_salary) || !entry.pension_rate_version) return null
  if (typeof profile.staff_is_pensionable !== "boolean") return null

  try {
    const rates = resolveGhanaStatutoryRatesByVersions({
      payeRateVersion: entry.paye_rate_version || "gh-paye-2024-01",
      pensionRateVersion: entry.pension_rate_version,
      periodBasis: periodDate,
    })

    if (profile.staff_is_pensionable !== true) {
      return {
        pensionableBase: 0,
        employeeContribution: 0,
        employerContribution: 0,
        tier1: 0,
        tier2: 0,
        totalMandatory: 0,
      }
    }

    const pensionableBase = clampGhanaPensionableBase(entry.basic_salary, rates.pension)
    const amounts = computeGhanaPensionAmounts(pensionableBase, rates.pension)
    return { pensionableBase, ...amounts }
  } catch {
    return null
  }
}

function validatePensionSnapshot(
  entry: PayrollEntryForGhanaApproval,
  profile: Record<string, unknown>,
  periodDate: string
): string | null {
  const expected = resolveExpectedPension(entry, profile, periodDate)
  if (!expected) return null

  const checks: Array<[unknown, number]> = [
    [entry.pensionable_base, expected.pensionableBase],
    [entry.employee_pension_contribution, expected.employeeContribution],
    [entry.ssnit_employee, expected.employeeContribution],
    [entry.employer_pension_contribution, expected.employerContribution],
    [entry.ssnit_employer, expected.employerContribution],
    [entry.total_mandatory_pension, expected.totalMandatory],
    [entry.tier1_ssnit_remittance, expected.tier1],
    [entry.tier2_pension_remittance, expected.tier2],
  ]

  const present = checks.filter(([value]) => isFiniteNumber(value))
  if (present.length === 0) return null

  for (const [actual, expectedValue] of present) {
    if (!amountsMatch(Number(actual), expectedValue)) {
      return "pension_snapshot_mismatch"
    }
  }

  return null
}

function validateResidentGraduatedTax(
  entry: PayrollEntryForGhanaApproval,
  periodDate: string,
  employeePension: number
): string | null {
  if (!hasEarningsSnapshot(entry) || !hasIncomeTaxBases(entry)) return null

  let payeBands
  try {
    const rates = resolveGhanaStatutoryRatesByVersions({
      payeRateVersion: entry.paye_rate_version || "gh-paye-2024-01",
      pensionRateVersion: entry.pension_rate_version || "gh-pension-2026-01",
      periodBasis: periodDate,
    })
    payeBands = rates.paye.bands
  } catch {
    return null
  }

  const basic = roundPayroll(entry.basic_salary!)
  const regularAllowances = roundPayroll(entry.regular_allowances_amount!)
  const bonus = roundPayroll(Math.max(0, entry.bonus_amount!))
  const overtime = roundPayroll(Math.max(0, entry.overtime_amount!))
  const gross = roundPayroll(basic + regularAllowances + bonus + overtime)

  const bonusCap = roundPayroll(Math.max(0, basic * 12 * 0.15))
  const bonusConcessional = Math.min(bonus, bonusCap)
  const bonusGraduated = roundPayroll(Math.max(0, bonus - bonusConcessional))
  const bonusTax5 = roundPayroll(bonusConcessional * 0.05)
  const otThreshold = roundPayroll(Math.max(0, basic * 0.5))
  const isJunior = entry.is_qualifying_junior_employee === true
  const otAt5 = isJunior ? Math.min(overtime, otThreshold) : 0
  const otAt10 = isJunior ? roundPayroll(Math.max(0, overtime - otAt5)) : 0
  const otGraduated = isJunior ? 0 : overtime
  const otTax5 = roundPayroll(otAt5 * 0.05)
  const otTax10 = roundPayroll(otAt10 * 0.1)
  const taxable = roundPayroll(Math.max(0, gross - employeePension))
  const graduatedBase = roundPayroll(taxable - bonusConcessional - otAt5 - otAt10)
  const regularGraduatedBase = roundPayroll(graduatedBase - bonusGraduated - otGraduated)
  const regularPaye = calculateGhanaPayeFromBands(
    Math.max(0, regularGraduatedBase),
    payeBands
  )
  const regularPlusBonusPaye = calculateGhanaPayeFromBands(
    Math.max(0, regularGraduatedBase + bonusGraduated),
    payeBands
  )
  const graduatedPaye = calculateGhanaPayeFromBands(Math.max(0, graduatedBase), payeBands)
  const bonusTaxGraduated = roundPayroll(Math.max(0, regularPlusBonusPaye - regularPaye))
  const otTaxGraduated = roundPayroll(Math.max(0, graduatedPaye - regularPlusBonusPaye))
  const paye = roundPayroll(graduatedPaye + bonusTax5 + otTax5 + otTax10)
  const bonusComponentAmount = roundPayroll(bonusTax5 + bonusTaxGraduated)
  const otComponentAmount = roundPayroll(otTax5 + otTax10 + otTaxGraduated)
  const regularComponentAmount = roundPayroll(paye - bonusComponentAmount - otComponentAmount)
  const regularComponentBase = roundPayroll(Math.max(0, taxable - bonus - overtime))

  const baseChecks: Array<[unknown, number]> = [
    [entry.taxable_income, taxable],
    [entry.bonus_cap_amount, bonusCap],
    [entry.bonus_concessional_amount, bonusConcessional],
    [entry.bonus_graduated_amount, bonusGraduated],
    [entry.overtime_threshold_amount, otThreshold],
    [entry.income_tax_regular_base, regularComponentBase],
    [entry.income_tax_bonus_base, bonus],
    [entry.income_tax_overtime_base, overtime],
  ]
  if (baseChecks.some(([value]) => isFiniteNumber(value))) {
    for (const [actual, expected] of baseChecks) {
      if (isFiniteNumber(actual) && !amountsMatch(Number(actual), expected)) {
        return "resident_tax_base_mismatch"
      }
    }
  }

  const amountChecks: Array<[unknown, number]> = [
    [entry.bonus_tax_5, bonusTax5],
    [entry.bonus_tax_graduated, bonusTaxGraduated],
    [entry.overtime_tax_5, otTax5],
    [entry.overtime_tax_10, otTax10],
    [entry.overtime_tax_graduated, otTaxGraduated],
    [entry.paye, paye],
  ]
  if (amountChecks.some(([value]) => isFiniteNumber(value))) {
    for (const [actual, expected] of amountChecks) {
      if (isFiniteNumber(actual) && !amountsMatch(Number(actual), expected)) {
        return "resident_tax_amount_mismatch"
      }
    }
  }

  if (isFiniteNumber(entry.income_tax_regular_amount) &&
      !amountsMatch(entry.income_tax_regular_amount, regularComponentAmount)) {
    return "income_tax_component_mismatch"
  }
  if (isFiniteNumber(entry.income_tax_bonus_amount) &&
      !amountsMatch(entry.income_tax_bonus_amount, bonusComponentAmount)) {
    return "income_tax_component_mismatch"
  }
  if (isFiniteNumber(entry.income_tax_overtime_amount) &&
      !amountsMatch(entry.income_tax_overtime_amount, otComponentAmount)) {
    return "income_tax_component_mismatch"
  }

  return null
}

/**
 * Classify unsupported / incomplete tax profile from the immutable entry snapshot only.
 * Returns a classification code, or null when the snapshotted profile is supported.
 */
export function classifyUnsupportedFromTaxProfileSnapshot(
  profile: Record<string, unknown> | null | undefined
): string | null {
  if (!profile || typeof profile !== "object") {
    return "missing_tax_profile_snapshot"
  }

  if (!profileHasBoolean(profile, "staff_is_tax_resident")) {
    return "missing_tax_profile_snapshot"
  }
  if (!profileHasBoolean(profile, "secondary_employment")) {
    return "missing_tax_profile_snapshot"
  }

  const employmentRaw = profile.employment_type
  const employmentType =
    employmentRaw === undefined || employmentRaw === null
      ? null
      : normalizeEmploymentTypeForSnapshot(employmentRaw)
  if (!employmentType) {
    return "missing_tax_profile_snapshot"
  }

  if (profile.staff_is_tax_resident === false) return "non_resident"
  if (profile.secondary_employment === true) return "secondary_employment"

  if (employmentType === "casual" || employmentType.includes("casual")) return "casual_worker"
  if (employmentType === "temporary" || employmentType.includes("temporary")) {
    return "temporary_worker"
  }

  if (profile.casual_worker_flat_tax_applied === true) return "casual_worker"

  return null
}

function resolveEntryIncomeTaxMethod(entry: PayrollEntryForGhanaApproval): string | null {
  const fromColumn = entry.income_tax_method ? String(entry.income_tax_method).trim() : ""
  if (fromColumn) return fromColumn
  const profile = entry.payroll_tax_profile
  if (profile && typeof profile.income_tax_method === "string" && profile.income_tax_method.trim()) {
    return profile.income_tax_method.trim()
  }
  return null
}

function resolveEntryIncomeTaxMethodVersion(entry: PayrollEntryForGhanaApproval): string | null {
  const fromColumn = entry.income_tax_method_version
    ? String(entry.income_tax_method_version).trim()
    : ""
  if (fromColumn) return fromColumn
  const profile = entry.payroll_tax_profile
  if (
    profile &&
    typeof profile.income_tax_method_version === "string" &&
    profile.income_tax_method_version.trim()
  ) {
    return profile.income_tax_method_version.trim()
  }
  return null
}

/**
 * V3 approval classifier — exact employment_type match via resolveGhanaIncomeTaxMethodFromProfile.
 */
export function classifyUnsupportedV3Entry(
  entry: PayrollEntryForGhanaApproval,
  periodDate: string
): string | null {
  const profile = entry.payroll_tax_profile
  if (!profile || typeof profile !== "object") {
    return "missing_tax_profile_snapshot"
  }

  if (!profileHasBoolean(profile, "staff_is_pensionable")) {
    return "missing_pensionability_snapshot"
  }

  const resolved = resolveGhanaIncomeTaxMethodFromProfile(profile)
  if (!resolved.ok) {
    return resolved.unsupportedClassification
  }

  const method = resolveEntryIncomeTaxMethod(entry)
  const methodVersion = resolveEntryIncomeTaxMethodVersion(entry)
  const profileMethod = profileString(profile, "income_tax_method")
  const profileMethodVersion = profileString(profile, "income_tax_method_version")

  if (!method || !methodVersion || !profileMethod || !profileMethodVersion) {
    return "missing_income_tax_method_snapshot"
  }

  if (profileMethod !== method || profileMethodVersion !== methodVersion) {
    return "income_tax_method_snapshot_mismatch"
  }

  if (!GHANA_INCOME_TAX_METHODS.includes(method as GhanaIncomeTaxMethod)) {
    return "unknown_income_tax_method"
  }

  if (!methodMatchesProfile(method as GhanaIncomeTaxMethod, profile)) {
    return "income_tax_method_mismatch"
  }

  try {
    getGhanaProfileTaxRatesByVersion(methodVersion)
  } catch {
    return "unknown_profile_tax_version"
  }

  try {
    assertGhanaProfileTaxVersionCoversPeriod(methodVersion, periodDate)
  } catch {
    return "profile_tax_version_does_not_cover_period"
  }

  if (hasEarningsSnapshot(entry)) {
    const expectedGross = roundPayroll(
      entry.basic_salary! +
        entry.regular_allowances_amount! +
        entry.bonus_amount! +
        entry.overtime_amount!
    )
    const expectedAllowances = roundPayroll(
      entry.regular_allowances_amount! + entry.bonus_amount! + entry.overtime_amount!
    )
    if (
      !amountsMatch(entry.gross_salary!, expectedGross) ||
      !amountsMatch(entry.allowances_total!, expectedAllowances)
    ) {
      return "earnings_component_mismatch"
    }
  }

  const pensionMismatch = validatePensionSnapshot(entry, profile, periodDate)
  if (pensionMismatch) return pensionMismatch

  const employeePension = resolveEmployeePension(entry) ?? 0

  if (method === "gh_casual_flat_5" && hasIncomeTaxBases(entry) && hasEarningsSnapshot(entry)) {
    const gross = roundPayroll(entry.gross_salary!)
    if (
      !amountsMatch(entry.income_tax_regular_base!, gross) ||
      !amountsMatch(entry.income_tax_bonus_base!, 0) ||
      !amountsMatch(entry.income_tax_overtime_base!, 0) ||
      (isFiniteNumber(entry.taxable_income) && !amountsMatch(entry.taxable_income, gross))
    ) {
      return "income_tax_base_mismatch"
    }
    if (profile.casual_worker_flat_tax_applied !== true) {
      return "income_tax_component_mismatch"
    }
  }

  if (method === "gh_nonresident_split_25_20" && hasIncomeTaxBases(entry) && hasEarningsSnapshot(entry)) {
    const regularEmployment = roundPayroll(entry.basic_salary! + entry.regular_allowances_amount!)
    const bonus = roundPayroll(Math.max(0, entry.bonus_amount!))
    const overtime = roundPayroll(Math.max(0, entry.overtime_amount!))
    const regularBase = roundPayroll(Math.max(0, regularEmployment - employeePension))
    if (
      !amountsMatch(entry.income_tax_regular_base!, regularBase) ||
      !amountsMatch(entry.income_tax_bonus_base!, bonus) ||
      !amountsMatch(entry.income_tax_overtime_base!, overtime) ||
      (isFiniteNumber(entry.taxable_income) && !amountsMatch(entry.taxable_income, regularBase))
    ) {
      return "income_tax_base_mismatch"
    }
  }

  if (method === "gh_resident_graduated") {
    const residentFailure = validateResidentGraduatedTax(entry, periodDate, employeePension)
    if (residentFailure) return residentFailure
  }

  const regular = roundPayroll(Number(entry.income_tax_regular_amount ?? 0))
  const bonus = roundPayroll(Number(entry.income_tax_bonus_amount ?? 0))
  const overtime = roundPayroll(Number(entry.income_tax_overtime_amount ?? 0))
  const componentSum = roundPayroll(regular + bonus + overtime)
  const paye = roundPayroll(Number(entry.paye ?? 0))
  if (Math.abs(componentSum - paye) > AMOUNT_TOLERANCE) {
    return "income_tax_component_mismatch"
  }

  if (hasNetSalarySnapshot(entry)) {
    const pensionForNet = resolveEmployeePension(entry) ?? 0
    const expectedNet = roundPayroll(
      entry.gross_salary! - pensionForNet - entry.paye! - entry.deductions_total!
    )
    if (!amountsMatch(entry.net_salary!, expectedNet)) {
      return "net_salary_mismatch"
    }
  }

  return null
}

function normalizePeriodBasis(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim()
  if (!s) return null
  try {
    return extractDatePart(s)
  } catch {
    return null
  }
}

function collectEntryVersionMismatches(
  run: {
    calculation_engine_version: string
    paye_rate_version: string
    pension_rate_version: string
    calculation_jurisdiction: string
    statutory_period_basis: string
  },
  entries: PayrollEntryForGhanaApproval[]
): UnsupportedTaxProfileEmployee[] {
  const mismatches: UnsupportedTaxProfileEmployee[] = []

  for (const entry of entries) {
    const name = employeeName(entry)
    const push = (unsupportedClassification: string) => {
      mismatches.push({
        staffId: entry.staff_id,
        employeeName: name,
        unsupportedClassification,
      })
    }

    if (
      !entry.calculation_engine_version ||
      !entry.paye_rate_version ||
      !entry.pension_rate_version ||
      !entry.calculation_jurisdiction ||
      !entry.statutory_period_basis
    ) {
      push("missing_rate_version_snapshot")
      continue
    }

    if (entry.calculation_engine_version !== run.calculation_engine_version) {
      push("engine_version_mismatch")
    }
    if (entry.paye_rate_version !== run.paye_rate_version) {
      push("paye_version_mismatch")
    }
    if (entry.pension_rate_version !== run.pension_rate_version) {
      push("pension_version_mismatch")
    }
    if (String(entry.calculation_jurisdiction).trim().toUpperCase() !== run.calculation_jurisdiction) {
      push("jurisdiction_mismatch")
    }

    const entryPeriod = normalizePeriodBasis(entry.statutory_period_basis)
    if (!entryPeriod || entryPeriod !== run.statutory_period_basis) {
      push("statutory_period_mismatch")
    }
  }

  return mismatches
}

const V3_STATUTORY_FAILURE_CLASSIFICATIONS = new Set([
  "missing_pensionability_snapshot",
  "missing_income_tax_method_snapshot",
  "income_tax_method_snapshot_mismatch",
  "unknown_income_tax_method",
  "unknown_profile_tax_version",
  "income_tax_method_mismatch",
  "profile_tax_version_does_not_cover_period",
  "income_tax_component_mismatch",
  "income_tax_base_mismatch",
  "earnings_component_mismatch",
  "net_salary_mismatch",
  "pension_snapshot_mismatch",
  "resident_tax_base_mismatch",
  "resident_tax_amount_mismatch",
])

export function validateGhanaPayrollRunForApproval(opts: {
  businessCountry: string | null | undefined
  run: {
    calculation_engine_version?: string | null
    paye_rate_version?: string | null
    pension_rate_version?: string | null
    calculation_jurisdiction?: string | null
    statutory_period_basis?: string | null
    payroll_frequency?: string | null
  }
  entries: PayrollEntryForGhanaApproval[]
}): GhanaApprovalBlockResult {
  if (!isGhanaMonthlyStatutoryEngine(opts.businessCountry)) {
    return { ok: true }
  }

  const included = (opts.entries || []).filter((e) => e.is_included !== false)

  const runEngine = opts.run.calculation_engine_version
  const runPaye = opts.run.paye_rate_version
  const runPension = opts.run.pension_rate_version
  const runJurisdiction = opts.run.calculation_jurisdiction
    ? String(opts.run.calculation_jurisdiction).trim().toUpperCase()
    : null
  const runPeriod = normalizePeriodBasis(opts.run.statutory_period_basis)
  const runFrequency = opts.run.payroll_frequency
    ? String(opts.run.payroll_frequency).trim().toLowerCase()
    : null

  if (!runEngine || !runPaye || !runPension || !runJurisdiction || !runPeriod || !runFrequency) {
    return {
      ok: false,
      code: GHANA_PAYROLL_UNKNOWN_RATE_VERSION,
      message:
        "This payroll run is missing a recognized Ghana calculation-engine, jurisdiction, period basis, frequency, or statutory-rate version and cannot be approved. Recreate the run after upgrading, or contact support for legacy runs.",
      affectedEmployees: [],
    }
  }

  if (!isSupportedGhanaEngineVersion(runEngine)) {
    return {
      ok: false,
      code: GHANA_PAYROLL_UNKNOWN_RATE_VERSION,
      message: `Unrecognized Ghana calculation engine version "${runEngine}". Expected ${GHANA_ENGINE_V2} or ${GHANA_ENGINE_V3}.`,
      affectedEmployees: [],
    }
  }

  if (runJurisdiction !== "GH") {
    return {
      ok: false,
      code: GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
      message: `Ghana payroll approval requires calculation_jurisdiction "GH" (received "${runJurisdiction}").`,
      affectedEmployees: [],
    }
  }

  if (runFrequency !== "monthly") {
    return {
      ok: false,
      code: GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
      message: `Ghana payroll approval currently requires monthly frequency (received "${runFrequency}").`,
      affectedEmployees: [],
    }
  }

  try {
    resolveGhanaStatutoryRatesByVersions({
      payeRateVersion: runPaye,
      pensionRateVersion: runPension,
      periodBasis: runPeriod,
    })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Stored Ghana rate versions are invalid for this payroll period."
    const outsideOrUncovered = /does not cover|outside the verified/i.test(message)
    if (outsideOrUncovered) {
      return {
        ok: false,
        code: GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
        message: `Ghana statutory rate versions do not cover period ${runPeriod}. Approval is blocked.`,
        affectedEmployees: [
          {
            staffId: "",
            employeeName: null,
            unsupportedClassification: "version_does_not_cover_period",
          },
        ],
      }
    }
    return {
      ok: false,
      code: GHANA_PAYROLL_UNKNOWN_RATE_VERSION,
      message: `Unknown or unsupported Ghana statutory rate version (PAYE="${runPaye}", pension="${runPension}", period="${runPeriod}"). Approval is blocked.`,
      affectedEmployees: [],
    }
  }

  const versionMismatches = collectEntryVersionMismatches(
    {
      calculation_engine_version: runEngine,
      paye_rate_version: runPaye,
      pension_rate_version: runPension,
      calculation_jurisdiction: runJurisdiction,
      statutory_period_basis: runPeriod,
    },
    included
  )

  if (versionMismatches.length > 0) {
    return {
      ok: false,
      code: GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
      message:
        "Included payroll entries do not all match this run’s Ghana calculation versions, jurisdiction, and period basis. Approval is blocked.",
      affectedEmployees: versionMismatches,
    }
  }

  const unsupported: UnsupportedTaxProfileEmployee[] = []
  const missingProfile: UnsupportedTaxProfileEmployee[] = []
  const statutoryFailures: UnsupportedTaxProfileEmployee[] = []

  for (const entry of included) {
    const classification =
      runEngine === GHANA_ENGINE_V3
        ? classifyUnsupportedV3Entry(entry, runPeriod)
        : classifyUnsupportedFromTaxProfileSnapshot(entry.payroll_tax_profile)

    if (!classification) continue

    const item = {
      staffId: entry.staff_id,
      employeeName: employeeName(entry),
      unsupportedClassification: classification,
    }

    if (classification === "missing_tax_profile_snapshot") {
      missingProfile.push(item)
    } else if (runEngine === GHANA_ENGINE_V3 && V3_STATUTORY_FAILURE_CLASSIFICATIONS.has(classification)) {
      statutoryFailures.push(item)
    } else {
      unsupported.push(item)
    }
  }

  if (missingProfile.length > 0) {
    return {
      ok: false,
      code: GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
      message:
        "One or more included employees are missing immutable tax-profile snapshot fields required for Ghana approval (residency, secondary employment, or employment classification).",
      affectedEmployees: missingProfile,
    }
  }

  if (statutoryFailures.length > 0) {
    return {
      ok: false,
      code: GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
      message:
        "One or more included employees have invalid or incomplete Ghana v3 income-tax method snapshots. Recalculate draft entries before approval.",
      affectedEmployees: statutoryFailures,
    }
  }

  if (unsupported.length > 0) {
    const v3Message =
      runEngine === GHANA_ENGINE_V3
        ? "This payroll includes employees with tax classifications Finza cannot yet calculate correctly (secondary employment, non-resident casual, or unknown employment type). Remove or exclude them before approval."
        : "This payroll includes employees with tax classifications Finza cannot yet calculate correctly (non-resident, secondary employment, or casual/temporary). Remove or exclude them before approval."

    return {
      ok: false,
      code: GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE,
      message: v3Message,
      affectedEmployees: unsupported,
    }
  }

  return { ok: true }
}
