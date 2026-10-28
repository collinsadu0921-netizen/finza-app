/**
 * Effective-dated Ghana statutory PAYE + SSNIT configuration.
 *
 * Sources (authoritative):
 * - GRA PAYE monthly bands effective 1 Jan 2024 (Income Tax (Amendment) (No. 2) Act, 2023 / Act 1111;
 *   GRA PAYE page Year 2024 table).
 * - Income Tax (Amendment) Act, 2026 (Act 1178) and GRA notice "Amendments – Income Tax Act, 2026":
 *   new resident monthly/annual PAYE rates effective 1 September 2026. Monthly bands: first
 *   GH¢588 at 0%; next GH¢80 at 5%; next GH¢100 at 10%; next GH¢2,900 at 17.5%; next GH¢16,000
 *   at 25%; next GH¢30,332 at 30%; above GH¢50,000 at 35%. Annual bands are exactly 12× monthly.
 *   Act 1178 also raises the Modified Taxation Scheme turnover threshold (not a payroll rule).
 *   It does not change SSNIT, bonus, overtime, casual-worker, or non-resident rates.
 * - SSNIT Public Notice 13 Jan 2026: 2026 min/max insurable earnings GH¢587.80 / GH¢69,000;
 *   prior (2025) levels GH¢539.19 / GH¢61,000 cited in that notice.
 * - 2024 SSNIT ceilings: min GH¢490.05 / max GH¢52,000 (Tier 1 bounds GH¢66.16 / GH¢7,020).
 * - National Pensions Act, 2008 (Act 766): employee 5.5%, employer 13%; Tier 1 13.5%, Tier 2 5%.
 *
 * Selection uses the payroll period date, never "today". Fail closed when no version covers the period.
 *
 * Legal horizon (do not conflate these):
 * - PAYE: Act 1178 amended the First Schedule to Act 896. The schedule has a statutory
 *   commencement (1 September 2026) but no statutory expiry; it continues until Parliament
 *   amends it. Finza therefore treats `gh-paye-2026-09` as open-ended.
 * - SSNIT/SSNIT-style pension: minimum and maximum insurable earnings are annual values.
 *   The latest verified values are the 2026 SSNIT notice (1 January 2026). The 2027 values
 *   are not published/verified, so pension resolution fails closed from 2027-01-01 onward.
 */

import { extractDatePart, roundPayroll, validateEffectiveDate } from "../versioning"
import { GHANA_ENGINE_V2 } from "./ghanaProfileTax"

export const GHANA_CALCULATION_ENGINE_VERSION = GHANA_ENGINE_V2

export {
  GHANA_ENGINE_V2,
  GHANA_ENGINE_V3,
  GHANA_NEW_RUN_ENGINE_VERSION,
  SUPPORTED_GHANA_ENGINE_VERSIONS,
  isSupportedGhanaEngineVersion,
} from "./ghanaProfileTax"

/** Inclusive verified PAYE support start. The Act 1178 schedule has no statutory expiry. */
export const GHANA_PAYE_VERIFIED_FROM = "2024-01-01"
/** Inclusive start for verified annual SSNIT/pension insurable-earnings limits. */
export const GHANA_PENSION_VERIFIED_FROM = "2024-01-01"
/** Latest annual SSNIT/pension insurable-earnings limits verified by an official notice. */
export const GHANA_PENSION_VERIFIED_THROUGH = "2026-12-31"

/**
 * Legacy names kept for external callers. These describe the pension verification
 * horizon, not a PAYE expiry.
 */
export const GHANA_STATUTORY_VERIFIED_FROM = GHANA_PAYE_VERIFIED_FROM
export const GHANA_STATUTORY_VERIFIED_THROUGH = GHANA_PENSION_VERIFIED_THROUGH

export const GHANA_STATUTORY_VERSION_ERROR_CODE = "GHANA_PAYROLL_UNKNOWN_RATE_VERSION"

export class GhanaStatutoryVersionError extends Error {
  readonly code = GHANA_STATUTORY_VERSION_ERROR_CODE

  constructor(message: string) {
    super(message)
    this.name = "GhanaStatutoryVersionError"
  }
}

export type GhanaPayeBand = {
  /** Width of this band ("Next X"), or null for open-ended residual. */
  taxableAmount: number | null
  rate: number
}

export type GhanaPensionRates = {
  version: string
  effectiveFrom: string
  effectiveTo?: string
  employeeRate: number
  employerRate: number
  tier1TotalRate: number
  tier2Rate: number
  minimumInsurableEarnings: number
  maximumInsurableEarnings: number
}

export type GhanaPayeRates = {
  version: string
  effectiveFrom: string
  effectiveTo?: string
  bands: GhanaPayeBand[]
}

export type GhanaStatutoryRateBundle = {
  paye: GhanaPayeRates
  pension: GhanaPensionRates
  calculationEngineVersion: string
  periodBasis: string
}

/** Official GRA monthly resident PAYE "Next" bands from 1 Jan 2024 (superseded 1 Sep 2026). */
export const GHANA_PAYE_2024_01_BANDS: readonly GhanaPayeBand[] = [
  { taxableAmount: 490, rate: 0 },
  { taxableAmount: 110, rate: 0.05 },
  { taxableAmount: 130, rate: 0.1 },
  { taxableAmount: 3166.67, rate: 0.175 },
  { taxableAmount: 16000, rate: 0.25 },
  { taxableAmount: 30520, rate: 0.3 },
  { taxableAmount: null, rate: 0.35 },
] as const

/** Official GRA monthly resident PAYE "Next" bands from 1 Sep 2026 (Act 1178). */
export const GHANA_PAYE_2026_09_BANDS: readonly GhanaPayeBand[] = [
  { taxableAmount: 588, rate: 0 },
  { taxableAmount: 80, rate: 0.05 },
  { taxableAmount: 100, rate: 0.1 },
  { taxableAmount: 2900, rate: 0.175 },
  { taxableAmount: 16000, rate: 0.25 },
  { taxableAmount: 30332, rate: 0.3 },
  { taxableAmount: null, rate: 0.35 },
] as const

export const GHANA_PAYE_2024_01_VERSION = "gh-paye-2024-01"
export const GHANA_PAYE_2026_09_VERSION = "gh-paye-2026-09"

const GHANA_PAYE_VERSIONS: GhanaPayeRates[] = [
  {
    version: GHANA_PAYE_2024_01_VERSION,
    effectiveFrom: "2024-01-01",
    effectiveTo: "2026-08-31",
    bands: [...GHANA_PAYE_2024_01_BANDS],
  },
  {
    version: GHANA_PAYE_2026_09_VERSION,
    effectiveFrom: "2026-09-01",
    // No effectiveTo: Act 1178's First Schedule remains in force until amended.
    bands: [...GHANA_PAYE_2026_09_BANDS],
  },
]

const GHANA_PENSION_VERSIONS: GhanaPensionRates[] = [
  {
    version: "gh-pension-2024-01",
    effectiveFrom: "2024-01-01",
    effectiveTo: "2024-12-31",
    employeeRate: 0.055,
    employerRate: 0.13,
    tier1TotalRate: 0.135,
    tier2Rate: 0.05,
    minimumInsurableEarnings: 490.05,
    maximumInsurableEarnings: 52000,
  },
  {
    version: "gh-pension-2025-01",
    effectiveFrom: "2025-01-01",
    effectiveTo: "2025-12-31",
    employeeRate: 0.055,
    employerRate: 0.13,
    tier1TotalRate: 0.135,
    tier2Rate: 0.05,
    minimumInsurableEarnings: 539.19,
    maximumInsurableEarnings: 61000,
  },
  {
    version: "gh-pension-2026-01",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    employeeRate: 0.055,
    employerRate: 0.13,
    tier1TotalRate: 0.135,
    tier2Rate: 0.05,
    minimumInsurableEarnings: 587.8,
    maximumInsurableEarnings: 69000,
  },
]

function versionCoversDate(
  version: { effectiveFrom: string; effectiveTo?: string },
  date: string
): boolean {
  if (version.effectiveFrom > date) return false
  if (version.effectiveTo && version.effectiveTo < date) return false
  return true
}

export function assertGhanaPayePeriodSupported(periodDate: string): string {
  validateEffectiveDate(periodDate)
  const date = extractDatePart(periodDate)
  if (date < GHANA_PAYE_VERIFIED_FROM) {
    throw new GhanaStatutoryVersionError(
      `Ghana PAYE period ${date} is before the verified start ${GHANA_PAYE_VERIFIED_FROM}.`
    )
  }
  return date
}

export function assertGhanaPensionPeriodWithinVerifiedHorizon(periodDate: string): string {
  validateEffectiveDate(periodDate)
  const date = extractDatePart(periodDate)
  if (date < GHANA_PENSION_VERIFIED_FROM) {
    throw new GhanaStatutoryVersionError(
      `Ghana pension/SSNIT period ${date} is before the verified start ${GHANA_PENSION_VERIFIED_FROM}.`
    )
  }
  if (date > GHANA_PENSION_VERIFIED_THROUGH) {
    throw new GhanaStatutoryVersionError(
      `Ghana pension/SSNIT rate version does not cover payroll period ${date}; annual insurable-earnings limits are verified only through ${GHANA_PENSION_VERIFIED_THROUGH}. Ghana PAYE remains valid, but the next SSNIT annual notice is required before pensionable payroll can be calculated.`
    )
  }
  return date
}

/**
 * Legacy alias for the annual pension/SSNIT verification horizon.
 * Do not use this to decide PAYE schedule validity.
 */
export function assertGhanaPeriodWithinVerifiedHorizon(periodDate: string): string {
  return assertGhanaPensionPeriodWithinVerifiedHorizon(periodDate)
}

export function getGhanaPayeRatesForPeriod(periodDate: string): GhanaPayeRates {
  const date = assertGhanaPayePeriodSupported(periodDate)
  const match = GHANA_PAYE_VERSIONS.find((v) => versionCoversDate(v, date))
  if (!match) {
    throw new GhanaStatutoryVersionError(
      `No Ghana PAYE rate version covers payroll period ${date}. Supported from ${GHANA_PAYE_VERIFIED_FROM} onward.`
    )
  }
  return match
}

export function getGhanaPensionRatesForPeriod(periodDate: string): GhanaPensionRates {
  const date = assertGhanaPensionPeriodWithinVerifiedHorizon(periodDate)
  const match = GHANA_PENSION_VERSIONS.find((v) => versionCoversDate(v, date))
  if (!match) {
    throw new GhanaStatutoryVersionError(
      `Ghana pension/SSNIT rate version does not cover payroll period ${date}; annual insurable-earnings limits are verified only through ${GHANA_PENSION_VERIFIED_THROUGH}.`
    )
  }
  return match
}

export function getGhanaPayeRatesByVersion(versionId: string): GhanaPayeRates {
  const match = GHANA_PAYE_VERSIONS.find((v) => v.version === versionId)
  if (!match) {
    throw new GhanaStatutoryVersionError(`Unknown Ghana PAYE rate version: ${versionId}`)
  }
  return match
}

export function getGhanaPensionRatesByVersion(versionId: string): GhanaPensionRates {
  const match = GHANA_PENSION_VERSIONS.find((v) => v.version === versionId)
  if (!match) {
    throw new GhanaStatutoryVersionError(`Unknown Ghana pension rate version: ${versionId}`)
  }
  return match
}

/** Resolve PAYE + pension for a payroll period. Fail closed — no newest/oldest fallback. */
export function resolveGhanaStatutoryRatesForPeriod(periodDate: string): GhanaStatutoryRateBundle {
  const periodBasis = assertGhanaPayePeriodSupported(periodDate)
  return {
    paye: getGhanaPayeRatesForPeriod(periodBasis),
    pension: getGhanaPensionRatesForPeriod(periodBasis),
    calculationEngineVersion: GHANA_CALCULATION_ENGINE_VERSION,
    periodBasis,
  }
}

/**
 * Resolve by previously snapshotted version ids (draft recalc / historical stability).
 * Validates that both versions exist, are Ghana tables, and cover the stored period basis.
 * PAYE coverage is open-ended from Act 1178; pension coverage remains limited to verified
 * annual SSNIT insurable-earnings notices. Does not fall back to any other version.
 */
export function resolveGhanaStatutoryRatesByVersions(opts: {
  payeRateVersion: string
  pensionRateVersion: string
  periodBasis: string
}): GhanaStatutoryRateBundle {
  validateEffectiveDate(opts.periodBasis)
  const periodBasis = extractDatePart(opts.periodBasis)
  const paye = getGhanaPayeRatesByVersion(opts.payeRateVersion)
  const pension = getGhanaPensionRatesByVersion(opts.pensionRateVersion)

  if (!versionCoversDate(paye, periodBasis)) {
    throw new GhanaStatutoryVersionError(
      `Ghana PAYE version "${paye.version}" does not cover stored period ${periodBasis}.`
    )
  }
  if (!versionCoversDate(pension, periodBasis)) {
    throw new GhanaStatutoryVersionError(
      `Ghana pension version "${pension.version}" does not cover stored period ${periodBasis}; annual SSNIT insurable-earnings limits are verified only through ${GHANA_PENSION_VERIFIED_THROUGH}. Ghana PAYE remains valid.`
    )
  }

  return {
    paye,
    pension,
    calculationEngineVersion: GHANA_CALCULATION_ENGINE_VERSION,
    periodBasis,
  }
}

/**
 * Progressive PAYE from official "Next" band widths.
 *
 * Accumulates in integer cents × rate basis points so binary floating-point
 * error cannot move a half-pesewa result to the wrong side of the statutory
 * half-up boundary (e.g. GH¢44.975 must become GH¢44.98, never GH¢44.97).
 * Rounds once at the end, half-up, to two decimals.
 */
export function calculateGhanaPayeFromBands(taxableIncome: number, bands: readonly GhanaPayeBand[]): number {
  const income = Number(taxableIncome)
  if (!Number.isFinite(income) || income <= 0) return 0

  let remainingCents = Math.round(income * 100)
  let taxUnits = 0
  for (const band of bands) {
    if (remainingCents <= 0) break
    const widthCents =
      band.taxableAmount == null
        ? remainingCents
        : Math.min(remainingCents, Math.round(Math.max(0, band.taxableAmount) * 100))
    const rateUnits = Math.round(band.rate * 10000)
    taxUnits += widthCents * rateUnits
    remainingCents -= widthCents
  }
  return Math.round(taxUnits / 10000) / 100
}

export function clampGhanaPensionableBase(
  basicSalary: number,
  pension: Pick<GhanaPensionRates, "minimumInsurableEarnings" | "maximumInsurableEarnings">
): number {
  const basic = Math.max(0, Number(basicSalary) || 0)
  const min = Number(pension.minimumInsurableEarnings)
  const max = Number(pension.maximumInsurableEarnings)
  return roundPayroll(Math.min(max, Math.max(min, basic)))
}

/**
 * Contributions and tier remittances from clamped pensionable base.
 * Tiers are base × statutory rates (not a proportional split of rounded totals).
 * At most a one-pesewa correction is applied to Tier 2 so:
 *   employee + employer = tier1 + tier2
 */
export function computeGhanaPensionAmounts(
  pensionableBase: number,
  pension: Pick<
    GhanaPensionRates,
    "employeeRate" | "employerRate" | "tier1TotalRate" | "tier2Rate"
  >
): {
  employeeContribution: number
  employerContribution: number
  tier1: number
  tier2: number
  totalMandatory: number
} {
  const base = roundPayroll(Math.max(0, Number(pensionableBase) || 0))
  const employeeContribution = roundPayroll(base * pension.employeeRate)
  const employerContribution = roundPayroll(base * pension.employerRate)
  let tier1 = roundPayroll(base * pension.tier1TotalRate)
  let tier2 = roundPayroll(base * pension.tier2Rate)
  const totalMandatory = roundPayroll(employeeContribution + employerContribution)
  const tierSum = roundPayroll(tier1 + tier2)
  const drift = roundPayroll(totalMandatory - tierSum)
  if (Math.abs(drift) > 0 && Math.abs(drift) <= 0.01) {
    tier2 = roundPayroll(tier2 + drift)
  } else if (Math.abs(drift) > 0.01) {
    tier2 = roundPayroll(totalMandatory - tier1)
  }
  return {
    employeeContribution,
    employerContribution,
    tier1,
    tier2,
    totalMandatory,
  }
}

export function listGhanaPayeVersionsForTests(): readonly GhanaPayeRates[] {
  return GHANA_PAYE_VERSIONS
}

export function listGhanaPensionVersionsForTests(): readonly GhanaPensionRates[] {
  return GHANA_PENSION_VERSIONS
}
