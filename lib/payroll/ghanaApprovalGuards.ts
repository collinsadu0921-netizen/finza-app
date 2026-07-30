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
import { resolveGhanaStatutoryRatesByVersions } from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import { normalizeEmploymentTypeForSnapshot } from "@/lib/payroll/staffTaxProfile"
import { isGhanaMonthlyStatutoryEngine } from "@/lib/payroll/salaryBasis"
import { roundPayroll, extractDatePart } from "@/lib/payrollEngine/versioning"

export const GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE = "GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE"
export const GHANA_PAYROLL_UNKNOWN_RATE_VERSION = "GHANA_PAYROLL_UNKNOWN_RATE_VERSION"
export const GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED = "GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED"

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
  income_tax_regular_amount?: number | null
  income_tax_bonus_amount?: number | null
  income_tax_overtime_amount?: number | null
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

  const resolved = resolveGhanaIncomeTaxMethodFromProfile(profile)
  if (!resolved.ok) {
    return resolved.unsupportedClassification
  }

  const method = resolveEntryIncomeTaxMethod(entry)
  const methodVersion = resolveEntryIncomeTaxMethodVersion(entry)
  if (!method || !methodVersion) {
    return "missing_income_tax_method_snapshot"
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

  const regular = roundPayroll(Number(entry.income_tax_regular_amount ?? 0))
  const bonus = roundPayroll(Number(entry.income_tax_bonus_amount ?? 0))
  const overtime = roundPayroll(Number(entry.income_tax_overtime_amount ?? 0))
  const componentSum = roundPayroll(regular + bonus + overtime)
  const paye = roundPayroll(Number(entry.paye ?? 0))
  if (Math.abs(componentSum - paye) > 0.01) {
    return "income_tax_component_mismatch"
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
    } else if (
      runEngine === GHANA_ENGINE_V3 &&
      [
        "missing_income_tax_method_snapshot",
        "unknown_income_tax_method",
        "unknown_profile_tax_version",
        "income_tax_method_mismatch",
        "profile_tax_version_does_not_cover_period",
        "income_tax_component_mismatch",
      ].includes(classification)
    ) {
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
