/**
 * Recalculate Ghana PAYE/net when employee is not pensionable (no employee SSNIT).
 * Taxable income is gross salary — SSNIT is not deducted or deductible.
 */
import { roundPayroll } from "@/lib/payrollEngine/versioning"

function calculateGhanaPaye(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0
  if (taxableIncome <= 490) return 0
  if (taxableIncome <= 650) return roundPayroll((taxableIncome - 490) * 0.05)
  if (taxableIncome <= 3850) return roundPayroll((650 - 490) * 0.05 + (taxableIncome - 650) * 0.1)
  if (taxableIncome <= 20000) {
    return roundPayroll((650 - 490) * 0.05 + (3850 - 650) * 0.1 + (taxableIncome - 3850) * 0.175)
  }
  if (taxableIncome <= 50000) {
    return roundPayroll(
      (650 - 490) * 0.05 +
        (3850 - 650) * 0.1 +
        (20000 - 3850) * 0.175 +
        (taxableIncome - 20000) * 0.25
    )
  }
  return roundPayroll(
    (650 - 490) * 0.05 +
      (3850 - 650) * 0.1 +
      (20000 - 3850) * 0.175 +
      (50000 - 20000) * 0.25 +
      (taxableIncome - 50000) * 0.3
  )
}

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
}): { taxableIncome: number; paye: number; netSalary: number } {
  const taxableIncome = roundPayroll(opts.grossSalary)
  const graduatedPayeBase = roundPayroll(
    taxableIncome - opts.bonusConcessionalAmount - opts.overtimeTaxableAt5 - opts.overtimeTaxableAt10
  )
  const regularGraduatedBase = roundPayroll(
    graduatedPayeBase - opts.bonusGraduatedAmount - opts.overtimeGraduatedAmount
  )
  const regularPayeAmount = calculateGhanaPaye(Math.max(0, regularGraduatedBase))
  const regularPlusBonusPayeAmount = calculateGhanaPaye(
    Math.max(0, regularGraduatedBase + opts.bonusGraduatedAmount)
  )
  const graduatedPayeAmount = calculateGhanaPaye(Math.max(0, graduatedPayeBase))
  void regularPayeAmount
  void regularPlusBonusPayeAmount
  const paye = gradedTaxTotal(
    graduatedPayeAmount,
    opts.bonusTax5,
    opts.overtimeTax5,
    opts.overtimeTax10
  )
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
