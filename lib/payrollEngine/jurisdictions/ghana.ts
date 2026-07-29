/**
 * Ghana Payroll Engine
 *
 * Uses effective-dated statutory configuration from ghanaStatutoryRates.ts.
 * Calculation engine version: finza-ghana-v2
 */

import type {
  PayrollEngine,
  PayrollEngineConfig,
  PayrollCalculationResult,
  StatutoryDeduction,
  EmployerContribution,
} from "../types"
import { roundPayroll } from "../versioning"
import {
  GHANA_CALCULATION_ENGINE_VERSION,
  calculateGhanaPayeFromBands,
  clampGhanaPensionableBase,
  computeGhanaPensionAmounts,
  resolveGhanaStatutoryRatesByVersions,
  resolveGhanaStatutoryRatesForPeriod,
  type GhanaStatutoryRateBundle,
} from "./ghanaStatutoryRates"

export type GhanaRateVersionOverride = {
  payeRateVersion: string
  pensionRateVersion: string
  periodBasis: string
}

function resolveRates(
  effectiveDate: string,
  override?: GhanaRateVersionOverride | null
): GhanaStatutoryRateBundle {
  if (override?.payeRateVersion && override?.pensionRateVersion) {
    return resolveGhanaStatutoryRatesByVersions({
      payeRateVersion: override.payeRateVersion,
      pensionRateVersion: override.pensionRateVersion,
      periodBasis: override.periodBasis || effectiveDate,
    })
  }
  return resolveGhanaStatutoryRatesForPeriod(effectiveDate)
}

function gradedTaxTotal(
  graduatedPaye: number,
  bonusTax5: number,
  overtimeTax5: number,
  overtimeTax10: number
): number {
  return roundPayroll(graduatedPaye + bonusTax5 + overtimeTax5 + overtimeTax10)
}

export const ghanaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const {
      basicSalary,
      allowances,
      otherDeductions,
      effectiveDate,
      bonusAmount = 0,
      overtimeAmount = 0,
      isQualifyingJuniorEmployee = false,
    } = config

    const override = (config as PayrollEngineConfig & { ghanaRateVersions?: GhanaRateVersionOverride })
      .ghanaRateVersions
    const rates = resolveRates(effectiveDate, override ?? null)
    const dateToUse = rates.periodBasis

    const safeBonusAmount = roundPayroll(Math.max(0, Number(bonusAmount) || 0))
    const safeOvertimeAmount = roundPayroll(Math.max(0, Number(overtimeAmount) || 0))
    const regularAllowances = roundPayroll(
      Math.max(0, Number(allowances || 0) - safeBonusAmount - safeOvertimeAmount)
    )

    // Ghana bonus concession: first 15% of annual basic taxed at flat 5%.
    const bonusCapAmount = roundPayroll(Math.max(0, basicSalary * 12 * 0.15))
    const bonusConcessionalAmount = Math.min(safeBonusAmount, bonusCapAmount)
    const bonusGraduatedAmount = roundPayroll(Math.max(0, safeBonusAmount - bonusConcessionalAmount))
    const bonusTax5 = roundPayroll(bonusConcessionalAmount * 0.05)

    // Ghana overtime concession (qualifying junior employees).
    const overtimeThresholdAmount = roundPayroll(Math.max(0, basicSalary * 0.5))
    const overtimeTaxableAt5 = isQualifyingJuniorEmployee
      ? Math.min(safeOvertimeAmount, overtimeThresholdAmount)
      : 0
    const overtimeTaxableAt10 = isQualifyingJuniorEmployee
      ? roundPayroll(Math.max(0, safeOvertimeAmount - overtimeTaxableAt5))
      : 0
    const overtimeGraduatedAmount = isQualifyingJuniorEmployee ? 0 : safeOvertimeAmount
    const overtimeTax5 = roundPayroll(overtimeTaxableAt5 * 0.05)
    const overtimeTax10 = roundPayroll(overtimeTaxableAt10 * 0.1)

    const grossSalary = roundPayroll(basicSalary + regularAllowances + safeBonusAmount + safeOvertimeAmount)

    const pensionableBase = clampGhanaPensionableBase(basicSalary, rates.pension)
    const pensionAmounts = computeGhanaPensionAmounts(pensionableBase, rates.pension)
    const ssnitEmployeeAmount = pensionAmounts.employeeContribution
    const ssnitEmployerAmount = pensionAmounts.employerContribution

    const taxableIncome = roundPayroll(Math.max(0, grossSalary - ssnitEmployeeAmount))

    const calculatePaye = (income: number) => calculateGhanaPayeFromBands(income, rates.paye.bands)

    const graduatedPayeBase = roundPayroll(
      taxableIncome - bonusConcessionalAmount - overtimeTaxableAt5 - overtimeTaxableAt10
    )
    const regularGraduatedBase = roundPayroll(
      graduatedPayeBase - bonusGraduatedAmount - overtimeGraduatedAmount
    )
    const regularPayeAmount = calculatePaye(Math.max(0, regularGraduatedBase))
    const regularPlusBonusPayeAmount = calculatePaye(
      Math.max(0, regularGraduatedBase + bonusGraduatedAmount)
    )
    const graduatedPayeAmount = calculatePaye(Math.max(0, graduatedPayeBase))
    const bonusTaxGraduated = roundPayroll(regularPlusBonusPayeAmount - regularPayeAmount)
    const overtimeTaxGraduated = roundPayroll(graduatedPayeAmount - regularPlusBonusPayeAmount)
    const payeAmount = gradedTaxTotal(graduatedPayeAmount, bonusTax5, overtimeTax5, overtimeTax10)

    const netSalary = Math.max(0, roundPayroll(taxableIncome - payeAmount - otherDeductions))

    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: "SSNIT_EMPLOYEE",
        name: "SSNIT Employee Contribution",
        rate: rates.pension.employeeRate,
        base: roundPayroll(pensionableBase),
        amount: ssnitEmployeeAmount,
        ledgerAccountCode: "2220",
        isTaxDeductible: true,
      },
      {
        code: "PAYE",
        name: "PAYE",
        rate: 0,
        base: roundPayroll(taxableIncome),
        amount: payeAmount,
        ledgerAccountCode: "2210",
        isTaxDeductible: false,
      },
    ]

    const employerContributions: EmployerContribution[] = [
      {
        code: "SSNIT_EMPLOYER",
        name: "SSNIT Employer Contribution",
        rate: rates.pension.employerRate,
        base: roundPayroll(pensionableBase),
        amount: ssnitEmployerAmount,
        ledgerExpenseAccountCode: "6010",
        ledgerLiabilityAccountCode: "2230",
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
        basicSalary: roundPayroll(basicSalary),
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
        isQualifyingJuniorEmployee,
        bonusCapAmount,
        bonusTax5,
        bonusTaxGraduated: roundPayroll(Math.max(0, bonusTaxGraduated)),
        overtimeThresholdAmount,
        overtimeTax5,
        overtimeTax10,
        overtimeTaxGraduated: roundPayroll(Math.max(0, overtimeTaxGraduated)),
        graduatedPayeBase: roundPayroll(Math.max(0, graduatedPayeBase)),
        graduatedPayeAmount: roundPayroll(graduatedPayeAmount),
        totalIncomeTax: roundPayroll(payeAmount),
        calculationEngineVersion: GHANA_CALCULATION_ENGINE_VERSION,
        payeRateVersion: rates.paye.version,
        pensionRateVersion: rates.pension.version,
        statutoryPeriodBasis: dateToUse,
        pensionableBase: roundPayroll(pensionableBase),
        tier1SsnitRemittance: pensionAmounts.tier1,
        tier2PensionRemittance: pensionAmounts.tier2,
      },
    }
  },
}
