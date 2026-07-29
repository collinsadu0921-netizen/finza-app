/**
 * Independent Ghana statutory golden fixtures for tests.
 * Intentionally duplicated from official GRA / SSNIT published figures — do NOT import
 * production ghanaStatutoryRates tables into these expectations.
 *
 * GRA PAYE Year 2024 monthly resident bands (Act 1111 / GRA PAYE page).
 * SSNIT 2026 min/max from SSNIT Public Notice 13 Jan 2026.
 */

export const GOLDEN_GHANA_PAYE_2024_BANDS = [
  { taxableAmount: 490, rate: 0 },
  { taxableAmount: 110, rate: 0.05 },
  { taxableAmount: 130, rate: 0.1 },
  { taxableAmount: 3166.67, rate: 0.175 },
  { taxableAmount: 16000, rate: 0.25 },
  { taxableAmount: 30520, rate: 0.3 },
  { taxableAmount: null as number | null, rate: 0.35 },
] as const

/** Round half-up to 2 decimals (matches Finza roundPayroll). */
export function goldenRound2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Progressive PAYE from independent golden bands. */
export function goldenCalculatePaye(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0
  let remaining = taxableIncome
  let tax = 0
  for (const band of GOLDEN_GHANA_PAYE_2024_BANDS) {
    if (remaining <= 0) break
    const width =
      band.taxableAmount == null ? remaining : Math.min(remaining, Math.max(0, band.taxableAmount))
    tax += width * band.rate
    remaining -= width
  }
  return goldenRound2(tax)
}

export const GOLDEN_SSNIT_2026 = {
  employeeRate: 0.055,
  employerRate: 0.13,
  tier1Rate: 0.135,
  tier2Rate: 0.05,
  minimumInsurableEarnings: 587.8,
  maximumInsurableEarnings: 69000,
} as const

export function goldenClampPensionableBase(basic: number): number {
  return goldenRound2(
    Math.min(
      GOLDEN_SSNIT_2026.maximumInsurableEarnings,
      Math.max(GOLDEN_SSNIT_2026.minimumInsurableEarnings, Math.max(0, basic))
    )
  )
}

export function goldenPensionFromBase(base: number) {
  const pensionableBase = goldenRound2(base)
  const employee = goldenRound2(pensionableBase * GOLDEN_SSNIT_2026.employeeRate)
  const employer = goldenRound2(pensionableBase * GOLDEN_SSNIT_2026.employerRate)
  let tier1 = goldenRound2(pensionableBase * GOLDEN_SSNIT_2026.tier1Rate)
  let tier2 = goldenRound2(pensionableBase * GOLDEN_SSNIT_2026.tier2Rate)
  const total = goldenRound2(employee + employer)
  const drift = goldenRound2(total - (tier1 + tier2))
  if (Math.abs(drift) > 0 && Math.abs(drift) <= 0.01) {
    tier2 = goldenRound2(tier2 + drift)
  }
  return { pensionableBase, employee, employer, tier1, tier2, total }
}

/** Required PAYE boundary taxable incomes. */
export const GOLDEN_PAYE_BOUNDARY_TAXABLES = [
  0, 489.99, 490, 490.01, 599.99, 600, 600.01, 729.99, 730, 730.01, 3896.66, 3896.67, 3896.68,
  19896.66, 19896.67, 19896.68, 50416.66, 50416.67, 50416.68, 60000, 100000,
] as const

export const GOLDEN_REFERENCE_PAYE = {
  taxable_650: { taxable: 650, paye: 10.5 },
  taxable_10000: { taxable: 10000, paye: 2098.5 },
  taxable_60000: { taxable: 60000, paye: 17082.83 },
} as const

/** Basic 1000, resident, pensionable, no other items (2026 SSNIT caps). */
export const GOLDEN_FULL_PAYROLL_1000 = {
  basic: 1000,
  employeeSsnit: 55,
  employerSsnit: 130,
  chargeable: 945,
  paye: 56.13,
  net: 888.87,
  tier1: 135,
  tier2: 50,
} as const
