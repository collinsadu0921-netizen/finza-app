/**
 * Effective-dated Ghana profile-tax configuration (non-standard employee methods).
 *
 * Rates verified against GRA PAYE guidance:
 * - Casual worker: flat 5% on amount paid
 * - Non-resident regular employment: 25%
 * - Non-resident bonus / overtime: 20%
 *
 * Support horizon is a Finza verification window, not a claim that the law expires.
 */

import { extractDatePart, roundPayroll, validateEffectiveDate } from "../versioning"

export const GHANA_ENGINE_V2 = "finza-ghana-v2"
export const GHANA_ENGINE_V3 = "finza-ghana-v3"

export const SUPPORTED_GHANA_ENGINE_VERSIONS = new Set([GHANA_ENGINE_V2, GHANA_ENGINE_V3])

/** Engine used for newly created Ghana monthly payroll runs. */
export const GHANA_NEW_RUN_ENGINE_VERSION = GHANA_ENGINE_V3

export const GHANA_PROFILE_TAX_VERSION_ERROR_CODE = "GHANA_PAYROLL_UNKNOWN_PROFILE_TAX_VERSION"

export class GhanaProfileTaxVersionError extends Error {
  readonly code = GHANA_PROFILE_TAX_VERSION_ERROR_CODE

  constructor(message: string) {
    super(message)
    this.name = "GhanaProfileTaxVersionError"
  }
}

export const GHANA_INCOME_TAX_METHODS = [
  "gh_resident_graduated",
  "gh_casual_flat_5",
  "gh_nonresident_split_25_20",
] as const

export type GhanaIncomeTaxMethod = (typeof GHANA_INCOME_TAX_METHODS)[number]

export type GhanaProfileTaxRates = {
  version: string
  effectiveFrom: string
  verifiedThrough: string
  productSupportEnd: string
  residentCasualRate: number
  nonResidentRegularRate: number
  nonResidentBonusRate: number
  nonResidentOvertimeRate: number
}

export const GHANA_PROFILE_TAX_2024_01: GhanaProfileTaxRates = {
  version: "gh-profile-tax-2024-01",
  effectiveFrom: "2024-01-01",
  verifiedThrough: "2026-07-30",
  productSupportEnd: "2026-12-31",
  residentCasualRate: 0.05,
  nonResidentRegularRate: 0.25,
  nonResidentBonusRate: 0.2,
  nonResidentOvertimeRate: 0.2,
}

const GHANA_PROFILE_TAX_VERSIONS: GhanaProfileTaxRates[] = [GHANA_PROFILE_TAX_2024_01]

export type GhanaIncomeTaxBreakdown = {
  incomeTaxMethod: GhanaIncomeTaxMethod
  incomeTaxMethodVersion: string
  incomeTaxRegularBase: number
  incomeTaxRegularAmount: number
  incomeTaxBonusBase: number
  incomeTaxBonusAmount: number
  incomeTaxOvertimeBase: number
  incomeTaxOvertimeAmount: number
  totalIncomeTax: number
}

export function isSupportedGhanaEngineVersion(version: string | null | undefined): boolean {
  return SUPPORTED_GHANA_ENGINE_VERSIONS.has(String(version || "").trim())
}

export function getGhanaProfileTaxRatesByVersion(version: string): GhanaProfileTaxRates {
  const found = GHANA_PROFILE_TAX_VERSIONS.find((v) => v.version === version)
  if (!found) {
    throw new GhanaProfileTaxVersionError(`Unknown Ghana profile-tax version "${version}".`)
  }
  return found
}

export function resolveGhanaProfileTaxRatesForPeriod(periodDate: string): GhanaProfileTaxRates {
  validateEffectiveDate(periodDate)
  const period = extractDatePart(periodDate)
  if (period < GHANA_PROFILE_TAX_2024_01.effectiveFrom) {
    throw new GhanaProfileTaxVersionError(
      `No Ghana profile-tax version covers payroll period ${period} (before ${GHANA_PROFILE_TAX_2024_01.effectiveFrom}).`
    )
  }
  if (period > GHANA_PROFILE_TAX_2024_01.productSupportEnd) {
    throw new GhanaProfileTaxVersionError(
      `Ghana profile-tax version ${GHANA_PROFILE_TAX_2024_01.version} does not cover payroll period ${period} (after product support end ${GHANA_PROFILE_TAX_2024_01.productSupportEnd}).`
    )
  }
  return GHANA_PROFILE_TAX_2024_01
}

export function assertGhanaProfileTaxVersionCoversPeriod(
  version: string,
  periodDate: string
): GhanaProfileTaxRates {
  const rates = getGhanaProfileTaxRatesByVersion(version)
  validateEffectiveDate(periodDate)
  const period = extractDatePart(periodDate)
  if (period < rates.effectiveFrom || period > rates.productSupportEnd) {
    throw new GhanaProfileTaxVersionError(
      `Stored Ghana profile-tax version "${version}" does not cover payroll period ${period}.`
    )
  }
  return rates
}

export type ProfileTaxMethodResolution =
  | { ok: true; method: GhanaIncomeTaxMethod }
  | { ok: false; unsupportedClassification: string }

const CANONICAL_EMPLOYMENT = new Set([
  "full_time",
  "part_time",
  "permanent",
  "temporary",
  "contract",
  "casual",
])

const GRADUATED_EMPLOYMENT = new Set([
  "full_time",
  "part_time",
  "permanent",
  "temporary",
  "contract",
])

/**
 * Resolve income-tax method from an immutable profile snapshot.
 * Exact canonical employment_type only — no substring matching.
 */
export function resolveGhanaIncomeTaxMethodFromProfile(profile: {
  staff_is_tax_resident?: unknown
  secondary_employment?: unknown
  employment_type?: unknown
}): ProfileTaxMethodResolution {
  if (typeof profile.staff_is_tax_resident !== "boolean") {
    return { ok: false, unsupportedClassification: "missing_tax_profile_snapshot" }
  }
  if (typeof profile.secondary_employment !== "boolean") {
    return { ok: false, unsupportedClassification: "missing_tax_profile_snapshot" }
  }
  if (typeof profile.employment_type !== "string" || !String(profile.employment_type).trim()) {
    return { ok: false, unsupportedClassification: "missing_tax_profile_snapshot" }
  }

  const employmentType = String(profile.employment_type).trim()
  if (!CANONICAL_EMPLOYMENT.has(employmentType)) {
    return { ok: false, unsupportedClassification: "unknown_employment_type" }
  }

  const resident = profile.staff_is_tax_resident === true

  // Precedence A: non-resident casual blocks before secondary classification.
  if (!resident && employmentType === "casual") {
    return { ok: false, unsupportedClassification: "nonresident_casual_worker" }
  }

  // Precedence B: secondary employment (resident or non-resident).
  if (profile.secondary_employment === true) {
    return {
      ok: false,
      unsupportedClassification: "secondary_employment_requires_verified_withholding_method",
    }
  }

  if (!resident && GRADUATED_EMPLOYMENT.has(employmentType)) {
    return { ok: true, method: "gh_nonresident_split_25_20" }
  }

  if (resident && employmentType === "casual") {
    return { ok: true, method: "gh_casual_flat_5" }
  }

  if (resident && GRADUATED_EMPLOYMENT.has(employmentType)) {
    return { ok: true, method: "gh_resident_graduated" }
  }

  return { ok: false, unsupportedClassification: "unknown_employment_type" }
}

export function calculateGhanaCasualFlatTax(opts: {
  grossRemuneration: number
  rates: GhanaProfileTaxRates
}): GhanaIncomeTaxBreakdown {
  const gross = roundPayroll(Math.max(0, Number(opts.grossRemuneration) || 0))
  const tax = roundPayroll(gross * opts.rates.residentCasualRate)
  return {
    incomeTaxMethod: "gh_casual_flat_5",
    incomeTaxMethodVersion: opts.rates.version,
    incomeTaxRegularBase: gross,
    incomeTaxRegularAmount: tax,
    incomeTaxBonusBase: 0,
    incomeTaxBonusAmount: 0,
    incomeTaxOvertimeBase: 0,
    incomeTaxOvertimeAmount: 0,
    totalIncomeTax: tax,
  }
}

export function calculateGhanaNonResidentSplitTax(opts: {
  regularEmploymentAmount: number
  employeePension: number
  bonusAmount: number
  overtimeAmount: number
  rates: GhanaProfileTaxRates
}): GhanaIncomeTaxBreakdown {
  const regularEmployment = roundPayroll(Math.max(0, Number(opts.regularEmploymentAmount) || 0))
  const pension = roundPayroll(Math.max(0, Number(opts.employeePension) || 0))
  const bonus = roundPayroll(Math.max(0, Number(opts.bonusAmount) || 0))
  const overtime = roundPayroll(Math.max(0, Number(opts.overtimeAmount) || 0))

  const regularBase = roundPayroll(Math.max(0, regularEmployment - pension))
  const regularTax = roundPayroll(regularBase * opts.rates.nonResidentRegularRate)
  const bonusTax = roundPayroll(bonus * opts.rates.nonResidentBonusRate)
  const overtimeTax = roundPayroll(overtime * opts.rates.nonResidentOvertimeRate)
  const total = roundPayroll(regularTax + bonusTax + overtimeTax)

  return {
    incomeTaxMethod: "gh_nonresident_split_25_20",
    incomeTaxMethodVersion: opts.rates.version,
    incomeTaxRegularBase: regularBase,
    incomeTaxRegularAmount: regularTax,
    incomeTaxBonusBase: bonus,
    incomeTaxBonusAmount: bonusTax,
    incomeTaxOvertimeBase: overtime,
    incomeTaxOvertimeAmount: overtimeTax,
    totalIncomeTax: total,
  }
}

export function methodMatchesProfile(
  method: GhanaIncomeTaxMethod,
  profile: { staff_is_tax_resident?: unknown; secondary_employment?: unknown; employment_type?: unknown }
): boolean {
  const resolved = resolveGhanaIncomeTaxMethodFromProfile(profile)
  return resolved.ok && resolved.method === method
}
