/**
 * Recalculate Ghana PAYE/net when employee is not pensionable (no employee SSNIT).
 * Taxable income is gross salary — SSNIT is not deducted or deductible.
 */
import { roundPayroll } from "@/lib/payrollEngine/versioning"
import {
  calculateGhanaPayeFromBands,
  type GhanaPayeBand,
  getGhanaPayeRatesByVersion,
  getGhanaPayeRatesForPeriod,
} from "@/lib/payrollEngine/jurisdictions/ghanaStatutoryRates"

function gradedTaxTotal(
  graduatedPaye: number,
  bonusTax5: number,
  overtimeTax5: number,
  overtimeTax10: number
): number {
  return roundPayroll(graduatedPaye + bonusTax5 + overtimeTax5 + overtimeTax10)
}

export function recalculateGhanaEntryAfterRemovingSsnit(opts: {
  grossSalary: number
  otherDeductions: number
  bonusConcessionalAmount: number
  bonusGraduatedAmount: number
  bonusTax5: number
  overtimeTaxableAt5: number
  overtimeTaxableAt10: number
  overtimeGraduatedAmount: number
  overtimeTax5: number
  overtimeTax10: number
  /** Prefer snapshotted PAYE version; else period date. */
  payeRateVersion?: string | null
  effectiveDate?: string | null
  payeBands?: readonly GhanaPayeBand[] | null
}): { taxableIncome: number; paye: number; netSalary: number } {
  let bands = opts.payeBands
  if (!bands || bands.length === 0) {
    if (opts.payeRateVersion) {
      bands = getGhanaPayeRatesByVersion(opts.payeRateVersion).bands
    } else if (opts.effectiveDate) {
      bands = getGhanaPayeRatesForPeriod(opts.effectiveDate).bands
    } else {
      throw new Error("Ghana non-pensionable PAYE recalc requires payeRateVersion, effectiveDate, or payeBands")
    }
  }

  const taxableIncome = roundPayroll(Math.max(0, opts.grossSalary))
  const graduatedPayeBase = roundPayroll(
    taxableIncome - opts.bonusConcessionalAmount - opts.overtimeTaxableAt5 - opts.overtimeTaxableAt10
  )
  const graduatedPayeAmount = calculateGhanaPayeFromBands(Math.max(0, graduatedPayeBase), bands)
  const paye = gradedTaxTotal(graduatedPayeAmount, opts.bonusTax5, opts.overtimeTax5, opts.overtimeTax10)
  const netSalary = Math.max(0, roundPayroll(taxableIncome - paye - opts.otherDeductions))
  return { taxableIncome, paye, netSalary }
}

/** Derive bonus/overtime PAYE split inputs from engine compliance breakdown. */
export function ghanaPayeInputsFromBreakdown(
  breakdown: Record<string, unknown> | null | undefined,
  basicSalary: number
): {
  bonusConcessionalAmount: number
  bonusGraduatedAmount: number
  bonusTax5: number
  overtimeTaxableAt5: number
  overtimeTaxableAt10: number
  overtimeGraduatedAmount: number
  overtimeTax5: number
  overtimeTax10: number
} {
  const b = breakdown ?? {}
  const bonusAmount = Number(b.bonusAmount ?? 0)
  const bonusCapAmount = Number(b.bonusCapAmount ?? Math.max(0, basicSalary * 12 * 0.15))
  const bonusConcessionalAmount = roundPayroll(Math.min(bonusAmount, Math.max(0, bonusCapAmount)))
  const bonusGraduatedAmount = roundPayroll(Math.max(0, bonusAmount - bonusConcessionalAmount))
  const bonusTax5 = roundPayroll(Number(b.bonusTax5 ?? bonusConcessionalAmount * 0.05))
  const isQualifyingJunior = Boolean(b.isQualifyingJuniorEmployee)
  const overtimeAmount = Number(b.overtimeAmount ?? 0)
  const overtimeThresholdAmount = Number(b.overtimeThresholdAmount ?? Math.max(0, basicSalary * 0.5))
  const overtimeTaxableAt5 = isQualifyingJunior
    ? roundPayroll(Math.min(overtimeAmount, overtimeThresholdAmount))
    : 0
  const overtimeTaxableAt10 = isQualifyingJunior
    ? roundPayroll(Math.max(0, overtimeAmount - overtimeTaxableAt5))
    : 0
  const overtimeGraduatedAmount = isQualifyingJunior ? 0 : roundPayroll(overtimeAmount)
  const overtimeTax5 = roundPayroll(Number(b.overtimeTax5 ?? overtimeTaxableAt5 * 0.05))
  const overtimeTax10 = roundPayroll(Number(b.overtimeTax10 ?? overtimeTaxableAt10 * 0.1))
  return {
    bonusConcessionalAmount,
    bonusGraduatedAmount,
    bonusTax5,
    overtimeTaxableAt5,
    overtimeTaxableAt10,
    overtimeGraduatedAmount,
    overtimeTax5,
    overtimeTax10,
  }
}
