/**
 * Effective-dated Ghana statutory PAYE + SSNIT configuration.
 *
 * Sources (authoritative):
 * - GRA PAYE monthly bands effective 1 Jan 2024 (Income Tax (Amendment) (No. 2) Act, 2023 / Act 1111;
 *   GRA PAYE page Year 2024 table).
 * - SSNIT Public Notice 13 Jan 2026: 2026 min/max insurable earnings GH¢587.80 / GH¢69,000;
 *   prior (2025) levels GH¢539.19 / GH¢61,000 cited in that notice.
 * - 2024 SSNIT ceilings: min GH¢490.05 / max GH¢52,000 (Tier 1 bounds GH¢66.16 / GH¢7,020).
 * - National Pensions Act, 2008 (Act 766): employee 5.5%, employer 13%; Tier 1 13.5%, Tier 2 5%.
 *
 * Selection uses the payroll period date, never "today". Fail closed when no version covers the period
 * or the period is outside the verified support horizon (2024-01-01 … 2026-12-31).
 */

import { extractDatePart, roundPayroll, validateEffectiveDate } from "../versioning"

export const GHANA_CALCULATION_ENGINE_VERSION = "finza-ghana-v2"

/** Inclusive verified statutory configuration window for Finza Ghana payroll. */
export const GHANA_STATUTORY_VERIFIED_FROM = "2024-01-01"
export const GHANA_STATUTORY_VERIFIED_THROUGH = "2026-12-31"

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

/** Official GRA monthly resident PAYE "Next" bands from 1 Jan 2024. */
export const GHANA_PAYE_2024_01_BANDS: readonly GhanaPayeBand[] = [
  { taxableAmount: 490, rate: 0 },
  { taxableAmount: 110, rate: 0.05 },
  { taxableAmount: 130, rate: 0.1 },
  { taxableAmount: 3166.67, rate: 0.175 },
  { taxableAmount: 16000, rate: 0.25 },
  { taxableAmount: 30520, rate: 0.3 },
  { taxableAmount: null, rate: 0.35 },
] as const

const GHANA_PAYE_VERSIONS: GhanaPayeRates[] = [
  {
    version: "gh-paye-2024-01",
    effectiveFrom: "2024-01-01",
    effectiveTo: GHANA_STATUTORY_VERIFIED_THROUGH,
    bands: [...GHANA_PAYE_2024_01_BANDS],
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

export function assertGhanaPeriodWithinVerifiedHorizon(periodDate: string): string {
  validateEffectiveDate(periodDate)
  const date = extractDatePart(periodDate)
  if (date < GHANA_STATUTORY_VERIFIED_FROM || date > GHANA_STATUTORY_VERIFIED_THROUGH) {
    throw new GhanaStatutoryVersionError(
      `Ghana payroll period ${date} is outside the verified statutory support window (${GHANA_STATUTORY_VERIFIED_FROM} through ${GHANA_STATUTORY_VERIFIED_THROUGH}).`
    )
  }
  return date
}

export function getGhanaPayeRatesForPeriod(periodDate: string): GhanaPayeRates {
  const date = assertGhanaPeriodWithinVerifiedHorizon(periodDate)
  const match = GHANA_PAYE_VERSIONS.find((v) => versionCoversDate(v, date))
  if (!match) {
    throw new GhanaStatutoryVersionError(
      `No Ghana PAYE rate version covers payroll period ${date}. Supported from ${GHANA_STATUTORY_VERIFIED_FROM} through ${GHANA_STATUTORY_VERIFIED_THROUGH}.`
    )
  }
  return match
}

export function getGhanaPensionRatesForPeriod(periodDate: string): GhanaPensionRates {
  const date = assertGhanaPeriodWithinVerifiedHorizon(periodDate)
  const match = GHANA_PENSION_VERSIONS.find((v) => versionCoversDate(v, date))
  if (!match) {
    throw new GhanaStatutoryVersionError(
      `No Ghana pension/SSNIT rate version covers payroll period ${date}. Supported from ${GHANA_STATUTORY_VERIFIED_FROM} through ${GHANA_STATUTORY_VERIFIED_THROUGH}.`
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
  const periodBasis = assertGhanaPeriodWithinVerifiedHorizon(periodDate)
  return {
    paye: getGhanaPayeRatesForPeriod(periodBasis),
    pension: getGhanaPensionRatesForPeriod(periodBasis),
    calculationEngineVersion: GHANA_CALCULATION_ENGINE_VERSION,
    periodBasis,
  }
}

/**
 * Resolve by previously snapshotted version ids (draft recalc / historical stability).
 * Validates that both versions exist, are Ghana tables, and cover the stored period basis
 * within the verified support horizon. Does not fall back to any other version.
 */
export function resolveGhanaStatutoryRatesByVersions(opts: {
  payeRateVersion: string
  pensionRateVersion: string
  periodBasis: string
}): GhanaStatutoryRateBundle {
  const periodBasis = assertGhanaPeriodWithinVerifiedHorizon(opts.periodBasis)
  const paye = getGhanaPayeRatesByVersion(opts.payeRateVersion)
  const pension = getGhanaPensionRatesByVersion(opts.pensionRateVersion)

  if (!versionCoversDate(paye, periodBasis)) {
    throw new GhanaStatutoryVersionError(
      `Ghana PAYE version "${paye.version}" does not cover stored period ${periodBasis}.`
    )
  }
  if (!versionCoversDate(pension, periodBasis)) {
    throw new GhanaStatutoryVersionError(
      `Ghana pension version "${pension.version}" does not cover stored period ${periodBasis}.`
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
 * Rounds once at the end via roundPayroll.
 */
export function calculateGhanaPayeFromBands(taxableIncome: number, bands: readonly GhanaPayeBand[]): number {
  const income = Number(taxableIncome)
  if (!Number.isFinite(income) || income <= 0) return 0

  let remaining = income
  let tax = 0
  for (const band of bands) {
    if (remaining <= 0) break
    const width =
      band.taxableAmount == null ? remaining : Math.min(remaining, Math.max(0, band.taxableAmount))
    tax += width * band.rate
    remaining -= width
  }
  return roundPayroll(tax)
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
