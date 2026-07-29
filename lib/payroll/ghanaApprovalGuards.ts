/**
 * Ghana payroll approval containment — block unsupported tax profiles and unknown rate versions.
 */

import {
  GHANA_CALCULATION_ENGINE_VERSION,
  getGhanaPayeRatesByVersion,
  getGhanaPensionRatesByVersion,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"
import {
  parseStaffIsTaxResident,
  parseStaffSecondaryEmployment,
} from "@/lib/payroll/staffTaxProfile"
import { isGhanaMonthlyStatutoryEngine } from "@/lib/payroll/salaryBasis"

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
  staff?: {
    id?: string
    name?: string | null
    employment_type?: string | null
    is_tax_resident?: boolean | null
    secondary_employment?: boolean | null
  } | null
}

function classifyUnsupported(entry: PayrollEntryForGhanaApproval): string | null {
  const profile = entry.payroll_tax_profile || {}
  const staff = entry.staff || {}

  const isResident =
    profile.staff_is_tax_resident !== undefined
      ? profile.staff_is_tax_resident !== false
      : parseStaffIsTaxResident(staff.is_tax_resident)
  if (!isResident) return "non_resident"

  const secondary =
    profile.secondary_employment !== undefined
      ? profile.secondary_employment === true
      : parseStaffSecondaryEmployment(staff.secondary_employment)
  if (secondary) return "secondary_employment"

  const employmentType = String(staff.employment_type || profile.employment_type || "")
    .trim()
    .toLowerCase()
  if (employmentType === "casual" || employmentType.includes("casual")) return "casual_worker"
  if (employmentType.includes("temporary") || employmentType.includes("temp_worker")) {
    return "temporary_worker"
  }

  if (profile.casual_worker_flat_tax_applied === true) return "casual_worker"

  return null
}

function employeeName(entry: PayrollEntryForGhanaApproval): string | null {
  return (
    (entry.filing_employee_name && String(entry.filing_employee_name).trim()) ||
    (entry.staff?.name && String(entry.staff.name).trim()) ||
    null
  )
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

  if (!runEngine || !runPaye || !runPension) {
    return {
      ok: false,
      code: GHANA_PAYROLL_UNKNOWN_RATE_VERSION,
      message:
        "This payroll run is missing a recognized Ghana calculation-engine or statutory-rate version and cannot be approved. Recreate the run after upgrading, or contact support for legacy runs.",
      affectedEmployees: [],
    }
  }

  if (runEngine !== GHANA_CALCULATION_ENGINE_VERSION) {
    return {
      ok: false,
      code: GHANA_PAYROLL_UNKNOWN_RATE_VERSION,
      message: `Unrecognized Ghana calculation engine version "${runEngine}". Expected ${GHANA_CALCULATION_ENGINE_VERSION}.`,
      affectedEmployees: [],
    }
  }

  try {
    getGhanaPayeRatesByVersion(runPaye)
    getGhanaPensionRatesByVersion(runPension)
  } catch {
    return {
      ok: false,
      code: GHANA_PAYROLL_UNKNOWN_RATE_VERSION,
      message: `Unknown Ghana statutory rate version (PAYE="${runPaye}", pension="${runPension}"). Approval is blocked.`,
      affectedEmployees: [],
    }
  }

  const versionMismatches: UnsupportedTaxProfileEmployee[] = []
  for (const entry of included) {
    if (
      !entry.calculation_engine_version ||
      !entry.paye_rate_version ||
      !entry.pension_rate_version
    ) {
      versionMismatches.push({
        staffId: entry.staff_id,
        employeeName: employeeName(entry),
        unsupportedClassification: "missing_rate_version_snapshot",
      })
      continue
    }
    if (
      entry.calculation_engine_version !== runEngine ||
      entry.paye_rate_version !== runPaye ||
      entry.pension_rate_version !== runPension
    ) {
      versionMismatches.push({
        staffId: entry.staff_id,
        employeeName: employeeName(entry),
        unsupportedClassification: "mixed_or_unknown_rate_version",
      })
    }
  }

  if (versionMismatches.length > 0) {
    return {
      ok: false,
      code: GHANA_PAYROLL_STATUTORY_VALIDATION_FAILED,
      message:
        "Included payroll entries do not all share this run’s Ghana calculation and rate versions. Approval is blocked.",
      affectedEmployees: versionMismatches,
    }
  }

  const unsupported: UnsupportedTaxProfileEmployee[] = []
  for (const entry of included) {
    const classification = classifyUnsupported(entry)
    if (classification) {
      unsupported.push({
        staffId: entry.staff_id,
        employeeName: employeeName(entry),
        unsupportedClassification: classification,
      })
    }
  }

  if (unsupported.length > 0) {
    return {
      ok: false,
      code: GHANA_PAYROLL_UNSUPPORTED_TAX_PROFILE,
      message:
        "This payroll includes employees with tax classifications Finza cannot yet calculate correctly (non-resident, secondary employment, or casual/temporary). Remove or exclude them before approval.",
      affectedEmployees: unsupported,
    }
  }

  return { ok: true }
}
