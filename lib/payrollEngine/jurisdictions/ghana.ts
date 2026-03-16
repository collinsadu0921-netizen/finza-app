/**
 * Ghana Payroll Engine Implementation
 * Implements Ghana's payroll structure with PAYE tax bands and SSNIT contributions
 *
 * Version A (current):
 * - PAYE: Progressive tax bands (0-490: 0%, 491-650: 5%, 651-3850: 10%, 3851-20000: 17.5%, 20001-50000: 25%, 50000+: 30%)
 * - SSNIT base (Ghana default): BASIC SALARY ONLY. Employee 5.5% and Employer 13% are applied to basic_salary,
 *   not gross (basic+allowances). This matches statutory treatment where pensionable earnings = basic only.
 * - Taxable income = gross - employee SSNIT; PAYE on taxable; net = gross - employee SSNIT - PAYE - deductions.
 *
 * Future versions can be added by date:
 * - Version B (2026-01-01): Potential rate changes (placeholder for future)
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/**
 * Ghana PAYE tax rate version
 */
interface GhanaPayeRates {
  bands: Array<{
    min: number
    max: number | null // null = no upper limit
    rate: number
  }>
}

/**
 * Ghana SSNIT contribution rates
 */
interface GhanaSsnitRates {
  employeeRate: number // 5.5%
  employerRate: number // 13%
}

/**
 * Ghana payroll rate versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: rates for that version
 */
const GHANA_PAYE_VERSIONS: Record<string, GhanaPayeRates> = {
  // Version A: Current GRA PAYE tax bands (effective from beginning)
  // Bands match SQL function calculate_ghana_paye() exactly
  // Band ranges are inclusive on both ends (e.g., 0-490 means 0 through 490 inclusive)
  '1970-01-01': {
    bands: [
      { min: 0, max: 490, rate: 0.00 }, // 0% - 0 to 490 (inclusive)
      { min: 491, max: 650, rate: 0.05 }, // 5% - 491 to 650 (inclusive)
      { min: 651, max: 3850, rate: 0.10 }, // 10% - 651 to 3850 (inclusive)
      { min: 3851, max: 20000, rate: 0.175 }, // 17.5% - 3851 to 20000 (inclusive)
      { min: 20001, max: 50000, rate: 0.25 }, // 25% - 20001 to 50000 (inclusive)
      { min: 50001, max: null, rate: 0.30 }, // 30% - 50001+ (no upper limit)
    ],
  },
}

const GHANA_SSNIT_VERSIONS: Record<string, GhanaSsnitRates> = {
  // Version A: Current SSNIT rates (effective from beginning)
  '1970-01-01': {
    employeeRate: 0.055, // 5.5%
    employerRate: 0.13, // 13%
  },
}

/**
 * Get PAYE tax bands for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns PAYE tax bands for the effective date
 */
function getPayeRatesForDate(effectiveDate: string): GhanaPayeRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(GHANA_PAYE_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return GHANA_PAYE_VERSIONS[latestVersion]
}

/**
 * Get SSNIT rates for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns SSNIT rates for the effective date
 */
function getSsnitRatesForDate(effectiveDate: string): GhanaSsnitRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(GHANA_SSNIT_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return GHANA_SSNIT_VERSIONS[latestVersion]
}

/**
 * Calculate PAYE tax using progressive tax bands
 * 
 * Progressive tax calculation:
 * - Each band applies only to income within that band range
 * - Tax is cumulative (band 1 + band 2 + ...)
 * 
 * Example for 3000 taxable income:
 * - Band 1 (0-490): 490 * 0.00 = 0
 * - Band 2 (491-650): (650-490) * 0.05 = 8
 * - Band 3 (651-3850): (3000-650) * 0.10 = 235
 * - Total: 0 + 8 + 235 = 243
 * 
 * @param taxableIncome Taxable income amount
 * @param effectiveDate Effective date for rate selection
 * @returns PAYE tax amount
 */
function calculatePaye(taxableIncome: number, effectiveDate: string): number {
  if (taxableIncome <= 0) {
    return 0
  }

  const payeRates = getPayeRatesForDate(effectiveDate)
  
  // Progressive tax calculation (matches SQL function calculate_ghana_paye exactly)
  // SQL calculation uses the previous band's upper boundary as the base
  // Band 1 (0-490): tax = 0
  // Band 2 (491-650): tax = (income - 490) * 0.05
  // Band 3 (651-3850): tax = (650-490)*0.05 + (income-650)*0.10
  // etc.
  
  // Match SQL logic exactly using if-else chain
  if (taxableIncome <= 490) {
    return 0
  } else if (taxableIncome <= 650) {
    return roundPayroll((taxableIncome - 490) * 0.05)
  } else if (taxableIncome <= 3850) {
    return roundPayroll((650 - 490) * 0.05 + (taxableIncome - 650) * 0.10)
  } else if (taxableIncome <= 20000) {
    return roundPayroll((650 - 490) * 0.05 + (3850 - 650) * 0.10 + (taxableIncome - 3850) * 0.175)
  } else if (taxableIncome <= 50000) {
    return roundPayroll(
      (650 - 490) * 0.05 +
      (3850 - 650) * 0.10 +
      (20000 - 3850) * 0.175 +
      (taxableIncome - 20000) * 0.25
    )
  } else {
    return roundPayroll(
      (650 - 490) * 0.05 +
      (3850 - 650) * 0.10 +
      (20000 - 3850) * 0.175 +
      (50000 - 20000) * 0.25 +
      (taxableIncome - 50000) * 0.30
    )
  }
}

/**
 * Ghana Payroll Engine
 */
export const ghanaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const { basicSalary, allowances, otherDeductions, effectiveDate } = config

    // Use effectiveDate from config (defaults to payroll_month)
    const dateToUse = effectiveDate

    // Calculate earnings: gross = basic + allowances (allowances increase gross and net but do not affect SSNIT base)
    const grossSalary = basicSalary + allowances

    // Get SSNIT rates for effective date
    const ssnitRates = getSsnitRatesForDate(dateToUse)

    // SSNIT base (Ghana default): BASIC SALARY ONLY. Employee 5.5% and employer 13% apply to basic_salary.
    const ssnitBase = basicSalary
    const ssnitEmployeeAmount = roundPayroll(ssnitBase * ssnitRates.employeeRate)
    const ssnitEmployerAmount = roundPayroll(ssnitBase * ssnitRates.employerRate)

    // Taxable income = gross - employee SSNIT (SSNIT is tax-deductible). PAYE on taxable; employer SSNIT not in net.
    const taxableIncome = roundPayroll(grossSalary - ssnitEmployeeAmount)

    // Calculate PAYE tax (progressive bands on taxable income)
    const payeAmount = calculatePaye(taxableIncome, dateToUse)

    // Calculate net salary (taxable income - PAYE - other deductions)
    const netSalary = Math.max(0, roundPayroll(taxableIncome - payeAmount - otherDeductions))

    // Build statutory deductions
    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: 'SSNIT_EMPLOYEE',
        name: 'SSNIT Employee Contribution',
        rate: ssnitRates.employeeRate,
        base: roundPayroll(ssnitBase), // Ghana default: basic salary only
        amount: ssnitEmployeeAmount,
        ledgerAccountCode: '2220', // SSNIT Employee Contribution Payable
        isTaxDeductible: true, // SSNIT is deductible from taxable income
      },
      {
        code: 'PAYE',
        name: 'PAYE',
        rate: 0, // PAYE uses progressive bands, no single rate
        base: roundPayroll(taxableIncome),
        amount: payeAmount,
        ledgerAccountCode: '2210', // PAYE Liability
        isTaxDeductible: false, // PAYE is calculated on taxable income (after SSNIT)
      },
    ]

    // Build employer contributions
    const employerContributions: EmployerContribution[] = [
      {
        code: 'SSNIT_EMPLOYER',
        name: 'SSNIT Employer Contribution',
        rate: ssnitRates.employerRate,
        base: roundPayroll(ssnitBase), // Ghana default: basic salary only
        amount: ssnitEmployerAmount,
        ledgerExpenseAccountCode: '6010', // Employer SSNIT Contribution (expense)
        ledgerLiabilityAccountCode: '2230', // SSNIT Employer Contribution Payable
      },
    ]

    // Calculate totals
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
    }
  },
}
