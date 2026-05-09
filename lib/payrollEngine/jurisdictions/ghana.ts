/**
 * Ghana Payroll Engine — Phase 1A (calculation foundation)
 *
 * References (official):
 * - GRA PAYE: https://gra.gov.gh/domestic-tax/tax-types/paye/
 * - SSNIT employer obligations: https://www.ssnit.org.gh/become-an-employer/
 * - SSNIT FAQs: https://www.ssnit.org.gh/faqs/
 * - 2026 min/max insurable earnings (Finza applies from 2026-01-01):
 *   https://www.ssnit.org.gh/wp-content/uploads/2026/01/Public-Notice-Min-Max-Insurable.pdf
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/** First version key for GRA monthly resident bands (Phase 1A; replaces incorrect historic brackets). */
export const GHANA_RESIDENT_PAYE_EFFECTIVE_FROM = '1970-01-01'

const GHANA_INSURABLE_EARNINGS_2026_START = '2026-01-01'

/** Progressive slices: first GHS 490 @ 0%, next 110 @ 5%, …, then 35% on excess. Source: GRA PAYE page. */
const PAYE_BAND_WIDTHS: ReadonlyArray<{ width: number; rate: number }> = [
  { width: 490, rate: 0 },
  { width: 110, rate: 0.05 },
  { width: 130, rate: 0.1 },
  { width: 3166.67, rate: 0.175 },
  { width: 16000, rate: 0.25 },
  { width: 30520, rate: 0.3 },
]
const PAYE_TOP_MARGINAL_RATE = 0.35

interface GhanaInsurableSchedule {
  minInsurableEarning: number | null
  maxInsurableEarning: number | null
}

function getInsurableScheduleForDate(effectiveDate: string): GhanaInsurableSchedule {
  const date = extractDatePart(effectiveDate)
  if (date >= GHANA_INSURABLE_EARNINGS_2026_START) {
    return {
      minInsurableEarning: 587.8,
      maxInsurableEarning: 69_000.0,
    }
  }
  return { minInsurableEarning: null, maxInsurableEarning: null }
}

/**
 * Pensionable insurable earnings (basic-only, Phase 1A).
 * No contribution when basic ≤ 0 or not pensionable.
 * From 2026-01-01: clamp to SSNIT public notice min/max insurable earnings.
 */
export function resolveGhanaInsurableBasicSalary(params: {
  basicSalary: number
  pensionable?: boolean | undefined
  effectiveDate: string
}): number {
  const { basicSalary: rawBasic, pensionable = true, effectiveDate } = params
  const basic = Number(rawBasic) || 0
  if (!pensionable || basic <= 0) return 0

  const sch = getInsurableScheduleForDate(effectiveDate)
  let base = basic
  if (sch.minInsurableEarning != null) base = Math.max(base, sch.minInsurableEarning)
  if (sch.maxInsurableEarning != null) base = Math.min(base, sch.maxInsurableEarning)
  return roundPayroll(base)
}

/** GRA progressive resident PAYE on monthly taxable employment income. */
export function calculateGhanaResidentGraduatedPaye(monthlyTaxableIncome: number): number {
  const income = Math.max(0, Number(monthlyTaxableIncome) || 0)
  if (income <= 0) return 0

  let remaining = income
  let tax = 0

  for (const { width, rate } of PAYE_BAND_WIDTHS) {
    if (remaining <= 0) break
    const slice = Math.min(remaining, width)
    tax += slice * rate
    remaining -= slice
  }

  if (remaining > 0) tax += remaining * PAYE_TOP_MARGINAL_RATE

  return roundPayroll(tax)
}

function employmentTypeIndicatesCasual(employmentType: string | undefined | null): boolean {
  const t = String(employmentType ?? '').trim().toLowerCase()
  return t === 'casual' || (t.includes('casual') && !t.includes('non-casual'))
}

export const ghanaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const safeBasicSalary = Number(config.basicSalary) || 0
    const allowances = Number(config.allowances ?? 0) || 0
    const otherDeductions = Math.max(0, Number(config.otherDeductions ?? 0) || 0)
    const dateToUse = config.effectiveDate
    const pensionable = config.isPensionable !== false
    const isResident = config.isResident !== false
    const safeBonusAmount = roundPayroll(Math.max(0, Number(config.bonusAmount ?? 0) || 0))
    const safeOvertimeAmount = roundPayroll(Math.max(0, Number(config.overtimeAmount ?? 0) || 0))
    const regularAllowances = roundPayroll(Math.max(0, allowances - safeBonusAmount - safeOvertimeAmount))

    const casual = employmentTypeIndicatesCasual(config.employmentCategory)

    const priorBonusYtd = Math.max(0, Number(config.priorBonusPaidInCalendarYear ?? 0) || 0)
    const annualBasicForCap = roundPayroll(Math.max(0, safeBasicSalary * 12))
    const bonusAnnualCap = roundPayroll(Math.max(0, annualBasicForCap * 0.15))
    const bonusCapRemainingBeforeThisRun = roundPayroll(Math.max(0, bonusAnnualCap - priorBonusYtd))
    const bonusConcessionalAmount = casual ? 0 : Math.min(safeBonusAmount, bonusCapRemainingBeforeThisRun)
    const bonusGraduatedAmount = roundPayroll(Math.max(0, safeBonusAmount - bonusConcessionalAmount))

    const annualQualIncome = config.annualQualifyingEmploymentIncomeYtd
    const juniorIncomeQualifies =
      typeof annualQualIncome === 'number' && Number.isFinite(annualQualIncome) && annualQualIncome <= 18_000
    const concessionApplies =
      !casual &&
      Boolean(config.isQualifyingJuniorEmployee) &&
      juniorIncomeQualifies

    const overtimeThresholdAmount = roundPayroll(Math.max(0, safeBasicSalary * 0.5))
    const overtimeTaxableAt5 = concessionApplies ? Math.min(safeOvertimeAmount, overtimeThresholdAmount) : 0
    const overtimeTaxableAt10 = concessionApplies
      ? roundPayroll(Math.max(0, safeOvertimeAmount - overtimeTaxableAt5))
      : 0
    const overtimeGraduatedAmount = concessionApplies ? 0 : safeOvertimeAmount

    const bonusTax5 =
      casual || !isResident
        ? 0
        : roundPayroll(bonusConcessionalAmount * 0.05)
    const overtimeTax5 =
      casual || !isResident ? 0 : roundPayroll(overtimeTaxableAt5 * 0.05)
    const overtimeTax10 =
      casual || !isResident ? 0 : roundPayroll(overtimeTaxableAt10 * 0.1)

    const grossSalary = roundPayroll(safeBasicSalary + regularAllowances + safeBonusAmount + safeOvertimeAmount)

    const ssnitBase = resolveGhanaInsurableBasicSalary({
      basicSalary: safeBasicSalary,
      pensionable,
      effectiveDate: dateToUse,
    })

    const employeeRate = 0.055
    const employerRate = 0.13
    const ssnitEmployeeAmount = pensionable ? roundPayroll(ssnitBase * employeeRate) : 0
    const ssnitEmployerAmount = pensionable ? roundPayroll(ssnitBase * employerRate) : 0

    const tier1SsnitRemittance = pensionable ? roundPayroll(ssnitBase * 0.135) : 0
    const tier2PensionRemittance = pensionable ? roundPayroll(ssnitBase * 0.05) : 0

    const taxableIncome = roundPayroll(Math.max(0, grossSalary - ssnitEmployeeAmount))

    let payeAmount: number
    let bonusTaxGraduatedForBreakdown = 0
    let overtimeTaxGraduatedForBreakdown = 0
    let graduatedPayeAmount = 0

    if (casual) {
      payeAmount = roundPayroll(taxableIncome * 0.05)
    } else if (!isResident) {
      const remainder = Math.max(
        0,
        roundPayroll(taxableIncome - safeBonusAmount - safeOvertimeAmount)
      )
      payeAmount = roundPayroll(remainder * 0.25 + safeBonusAmount * 0.2 + safeOvertimeAmount * 0.2)
    } else {
      const graduatedPayeBase = roundPayroll(
        taxableIncome - bonusConcessionalAmount - overtimeTaxableAt5 - overtimeTaxableAt10
      )
      const regularGraduatedBase = roundPayroll(
        graduatedPayeBase - bonusGraduatedAmount - overtimeGraduatedAmount
      )
      const regularPayeAmount = calculateGhanaResidentGraduatedPaye(Math.max(0, regularGraduatedBase))
      const regularPlusBonusPayeAmount = calculateGhanaResidentGraduatedPaye(
        Math.max(0, regularGraduatedBase + bonusGraduatedAmount)
      )
      graduatedPayeAmount = calculateGhanaResidentGraduatedPaye(Math.max(0, graduatedPayeBase))
      bonusTaxGraduatedForBreakdown = roundPayroll(
        Math.max(0, regularPlusBonusPayeAmount - regularPayeAmount)
      )
      overtimeTaxGraduatedForBreakdown = roundPayroll(
        Math.max(0, graduatedPayeAmount - regularPlusBonusPayeAmount)
      )
      payeAmount = roundPayroll(
        graduatedPayeAmount + bonusTax5 + overtimeTax5 + overtimeTax10
      )
    }

    const netSalary = Math.max(0, roundPayroll(taxableIncome - payeAmount - otherDeductions))

    const totalMandatoryPension = pensionable ? roundPayroll(ssnitBase * 0.185) : 0

    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: 'SSNIT_EMPLOYEE',
        name: 'Employee pension contribution (5.5% of insurable basic)',
        rate: employeeRate,
        base: roundPayroll(ssnitBase),
        amount: ssnitEmployeeAmount,
        // Employee pension withholding is not a single liability line in Finza posting: Tier 1 / Tier 2 remittance
        // amounts live on payroll_entries and post_payroll_to_ledger credits 2231 + 2232 (see complianceBreakdown).
        ledgerAccountCode: null,
        isTaxDeductible: true,
      },
      {
        code: 'PAYE',
        name: 'PAYE',
        rate: 0,
        base: roundPayroll(taxableIncome),
        amount: payeAmount,
        // Finza payroll journal: PAYE payable posts to 2230 (post_payroll_to_ledger); metadata hint only.
        ledgerAccountCode: '2230',
        isTaxDeductible: false,
      },
    ]

    const employerContributions: EmployerContribution[] = [
      {
        code: 'SSNIT_EMPLOYER',
        name: 'Employer pension contribution (13% of insurable basic)',
        rate: employerRate,
        base: roundPayroll(ssnitBase),
        amount: ssnitEmployerAmount,
        // Finza payroll journal: employer pension expense posts to 5610 (post_payroll_to_ledger). Metadata hint only.
        ledgerExpenseAccountCode: '5610',
        // Ghana employer pension liability is split between 2231 Tier 1 and 2232 Tier 2 by post_payroll_to_ledger using payroll entry snapshots.
        ledgerLiabilityAccountCode: null,
      },
    ]

    const totalStatutoryDeductions = roundPayroll(
      statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
    )
    const totalEmployerContributions = roundPayroll(
      employerContributions.reduce((sum, c) => sum + c.amount, 0)
    )

    return {
      earnings: {
        basicSalary: roundPayroll(safeBasicSalary),
        allowances: roundPayroll(allowances),
        grossSalary: roundPayroll(grossSalary),
      },
      statutoryDeductions,
      otherDeductions: roundPayroll(otherDeductions),
      employerContributions,
      totals: {
        grossSalary: roundPayroll(grossSalary),
        totalStatutoryDeductions,
        totalOtherDeductions: roundPayroll(otherDeductions),
        taxableIncome: roundPayroll(taxableIncome),
        netSalary,
        totalEmployerContributions,
      },
      complianceBreakdown: {
        bonusAmount: safeBonusAmount,
        overtimeAmount: safeOvertimeAmount,
        regularAllowancesAmount: regularAllowances,
        isQualifyingJuniorEmployee: Boolean(config.isQualifyingJuniorEmployee),
        bonusCapAmount: bonusAnnualCap,
        bonusTax5,
        bonusTaxGraduated: bonusTaxGraduatedForBreakdown,
        overtimeThresholdAmount,
        overtimeTax5,
        overtimeTax10,
        overtimeTaxGraduated: overtimeTaxGraduatedForBreakdown,
        graduatedPayeBase: roundPayroll(
          Math.max(
            0,
            taxableIncome -
              bonusConcessionalAmount -
              overtimeTaxableAt5 -
              overtimeTaxableAt10
          )
        ),
        graduatedPayeAmount: roundPayroll(graduatedPayeAmount),
        totalIncomeTax: roundPayroll(payeAmount),
        priorBonusPaidInCalendarYear: priorBonusYtd,
        bonusConcessionalRoomBeforeRun: bonusCapRemainingBeforeThisRun,
        juniorOvertimeConcessionApplies: concessionApplies,
        annualQualifyingEmploymentIncomeYtd: annualQualIncome,
        casualWorkerFlatTaxApplied: casual,
        isResident,
        pensionable,
        ssnitBase: roundPayroll(ssnitBase),
        employeePensionContribution: ssnitEmployeeAmount,
        employerPensionContribution: ssnitEmployerAmount,
        totalMandatoryPension,
        tier1SsnitRemittance,
        tier2PensionRemittance,
      },
    }
  },
}
