/**
 * Independent Act 1178 (September 2026) Ghana PAYE fixtures.
 *
 * Figures are derived by hand from the GRA-published monthly "Next" band widths:
 *   first 588 @ 0%; next 80 @ 5%; next 100 @ 10%; next 2,900 @ 17.5%;
 *   next 16,000 @ 25%; next 30,332 @ 30%; above 50,000 @ 35%.
 *
 * Do NOT import production rate tables into these expectations.
 */

export const GOLDEN_GHANA_PAYE_2026_09_BANDS = [
  { taxableAmount: 588, rate: 0 },
  { taxableAmount: 80, rate: 0.05 },
  { taxableAmount: 100, rate: 0.1 },
  { taxableAmount: 2900, rate: 0.175 },
  { taxableAmount: 16000, rate: 0.25 },
  { taxableAmount: 30332, rate: 0.3 },
  { taxableAmount: null as number | null, rate: 0.35 },
] as const

/** Monthly thresholds in chargeable-income terms. */
export const GOLDEN_GHANA_PAYE_2026_09_THRESHOLDS = {
  firstBandEnds: 588,
  fivePercentEnds: 668,
  tenPercentEnds: 768,
  seventeenFiveEnds: 3668,
  twentyFiveEnds: 19668,
  thirtyPercentEnds: 50000,
} as const

/** Annual equivalents are exactly 12× monthly under Act 1178. */
export const GOLDEN_GHANA_PAYE_2026_09_ANNUAL_BANDS = [
  { amount: 7056, rate: 0 },
  { amount: 960, rate: 0.05 },
  { amount: 1200, rate: 0.1 },
  { amount: 34800, rate: 0.175 },
  { amount: 192000, rate: 0.25 },
  { amount: 363984, rate: 0.3 },
  { amount: null as number | null, rate: 0.35 },
] as const

export function goldenRound2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Progressive PAYE from independently transcribed Act 1178 bands. */
export function goldenCalculatePaye2026(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0
  let remaining = taxableIncome
  let tax = 0
  for (const band of GOLDEN_GHANA_PAYE_2026_09_BANDS) {
    if (remaining <= 0) break
    const width =
      band.taxableAmount == null ? remaining : Math.min(remaining, Math.max(0, band.taxableAmount))
    tax += width * band.rate
    remaining -= width
  }
  return goldenRound2(tax)
}

/** Independently calculated expected PAYE at every new band boundary. */
export const GOLDEN_GHANA_PAYE_2026_09_BOUNDARY_CASES = [
  { taxable: 0, paye: 0 },
  { taxable: 587.99, paye: 0 },
  { taxable: 588, paye: 0 },
  { taxable: 588.01, paye: 0 },
  { taxable: 667.99, paye: 4.0 },
  { taxable: 668, paye: 4.0 },
  { taxable: 668.01, paye: 4.0 },
  { taxable: 767.99, paye: 14.0 },
  { taxable: 768, paye: 14.0 },
  { taxable: 768.01, paye: 14.0 },
  { taxable: 3667.99, paye: 521.5 },
  { taxable: 3668, paye: 521.5 },
  { taxable: 3668.01, paye: 521.5 },
  { taxable: 19667.99, paye: 4521.5 },
  { taxable: 19668, paye: 4521.5 },
  { taxable: 19668.01, paye: 4521.5 },
  { taxable: 49999.99, paye: 13621.1 },
  { taxable: 50000, paye: 13621.1 },
  { taxable: 50000.01, paye: 13621.1 },
] as const

/** Mid-band and high-income reference points, independently computed. */
export const GOLDEN_GHANA_PAYE_2026_09_REFERENCES = [
  { taxable: 650, paye: 3.1 },
  { taxable: 1000, paye: 54.6 },
  { taxable: 9450, paye: 1967.0 },
  { taxable: 60000, paye: 17121.1 },
  { taxable: 100000, paye: 31121.1 },
] as const

/** Same chargeable income under the pre-Act-1178 schedule (to 31 Aug 2026). */
export const GOLDEN_GHANA_PAYE_2024_REFERENCES = [
  { taxable: 650, paye: 10.5 },
  { taxable: 1000, paye: 65.75 },
  { taxable: 9450, paye: 1961.0 },
  { taxable: 60000, paye: 17082.83 },
  { taxable: 100000, paye: 31082.83 },
] as const

/**
 * Full resident, pensionable, monthly payroll (2026 SSNIT base = basic clamped to
 * 587.80 … 69,000; employee 5.5%). No allowances, bonus or overtime.
 */
export const GOLDEN_FULL_PAYROLL_SCHEDULE_COMPARISON = [
  {
    label: "low",
    basic: 1000,
    ssnitEmployee: 55,
    chargeable: 945,
    august2026: { paye: 56.13, net: 888.87 },
    september2026: { paye: 44.98, net: 900.02 },
  },
  {
    label: "medium",
    basic: 10000,
    ssnitEmployee: 550,
    chargeable: 9450,
    august2026: { paye: 1961.0, net: 7489.0 },
    september2026: { paye: 1967.0, net: 7483.0 },
  },
  {
    label: "high",
    basic: 60000,
    ssnitEmployee: 3300,
    chargeable: 56700,
    august2026: { paye: 15927.83, net: 40772.17 },
    september2026: { paye: 15966.1, net: 40733.9 },
  },
] as const
