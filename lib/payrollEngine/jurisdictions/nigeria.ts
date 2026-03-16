/**
 * Nigeria Payroll Engine Implementation
 * Implements Nigeria's payroll structure with PAYE tax bands, pension contributions, NHF, and NSITF
 * 
 * Version A (pre-2026, before 2026-01-01):
 * - PENSION Employee: 8% of gross salary (tax-deductible)
 * - PENSION Employer: 10% of gross salary
 * - NHF Employee: 2.5% of basic salary (tax-deductible, may be voluntary for some private sector)
 * - NSITF Employer: 1% of gross salary (employer-only, not deducted from employee)
 * - CRA: Consolidated Relief Allowance (annual calculation)
 * - PAYE: Progressive tax bands (7/11/15/19/21/24%) on annual taxable income, then /12 monthly
 * 
 * Version B (2026-01-01 onward):
 * - PENSION Employee: 8% of gross salary (tax-deductible)
 * - PENSION Employer: 10% of gross salary
 * - NHF Employee: 2.5% of basic salary (tax-deductible)
 * - NSITF Employer: 1% of gross salary (employer-only)
 * - CRA: Removed (no longer applicable)
 * - Rent Relief: Not implemented (requires rent input which is not available)
 * - PAYE: Progressive tax bands (0/15/18/21/23/25%) on annual taxable income, then /12 monthly
 *   - 0% up to 800,000 NGN annual
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/**
 * Nigeria PAYE (PIT) tax rate version
 */
interface NigeriaPayeRates {
  bands: Array<{
    min: number
    max: number | null // null = no upper limit
    rate: number
  }>
}

/**
 * Nigeria pension contribution rates
 */
interface NigeriaPensionRates {
  employeeRate: number // 8%
  employerRate: number // 10%
}

/**
 * Nigeria NHF contribution rates
 */
interface NigeriaNhfRates {
  employeeRate: number // 2.5% of basic salary
}

/**
 * Nigeria NSITF contribution rates
 */
interface NigeriaNsitfRates {
  employerRate: number // 1% of gross salary
}

/**
 * Nigeria payroll rate versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: rates for that version
 */
const NIGERIA_PAYE_VERSIONS: Record<string, NigeriaPayeRates> = {
  // Version A: Pre-2026 PIT bands (effective from beginning to 2025-12-31)
  '1970-01-01': {
    bands: [
      { min: 0, max: 300000, rate: 0.07 }, // 7% - 0 to 300,000
      { min: 300001, max: 600000, rate: 0.11 }, // 11% - 300,001 to 600,000
      { min: 600001, max: 1100000, rate: 0.15 }, // 15% - 600,001 to 1,100,000
      { min: 1100001, max: 1600000, rate: 0.19 }, // 19% - 1,100,001 to 1,600,000
      { min: 1600001, max: 3200000, rate: 0.21 }, // 21% - 1,600,001 to 3,200,000
      { min: 3200001, max: null, rate: 0.24 }, // 24% - 3,200,001+ (no upper limit)
    ],
  },
  // Version B: 2026+ PIT bands (effective from 2026-01-01)
  '2026-01-01': {
    bands: [
      { min: 0, max: 800000, rate: 0.00 }, // 0% - 0 to 800,000
      { min: 800001, max: 3000000, rate: 0.15 }, // 15% - 800,001 to 3,000,000
      { min: 3000001, max: 10000000, rate: 0.18 }, // 18% - 3,000,001 to 10,000,000
      { min: 10000001, max: 20000000, rate: 0.21 }, // 21% - 10,000,001 to 20,000,000
      { min: 20000001, max: 50000000, rate: 0.23 }, // 23% - 20,000,001 to 50,000,000
      { min: 50000001, max: null, rate: 0.25 }, // 25% - 50,000,001+ (no upper limit)
    ],
  },
}

const NIGERIA_PENSION_VERSIONS: Record<string, NigeriaPensionRates> = {
  // Version A: Current pension rates (effective from beginning)
  '1970-01-01': {
    employeeRate: 0.08, // 8%
    employerRate: 0.10, // 10%
  },
}

const NIGERIA_NHF_VERSIONS: Record<string, NigeriaNhfRates> = {
  // Version A: Current NHF rates (effective from beginning)
  '1970-01-01': {
    employeeRate: 0.025, // 2.5% of basic salary
  },
}

const NIGERIA_NSITF_VERSIONS: Record<string, NigeriaNsitfRates> = {
  // Version A: Current NSITF rates (effective from beginning)
  '1970-01-01': {
    employerRate: 0.01, // 1% of gross salary
  },
}

/**
 * 2026 tax reform date - when CRA was removed and PIT bands changed
 */
const TAX_REFORM_DATE = '2026-01-01'

/**
 * Get PAYE (PIT) tax bands for a specific effective date
 */
function getPayeRatesForDate(effectiveDate: string): NigeriaPayeRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(NIGERIA_PAYE_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return NIGERIA_PAYE_VERSIONS[latestVersion]
}

/**
 * Get pension rates for a specific effective date
 */
function getPensionRatesForDate(effectiveDate: string): NigeriaPensionRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(NIGERIA_PENSION_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse()
  
  const latestVersion = versions[0] || '1970-01-01'
  return NIGERIA_PENSION_VERSIONS[latestVersion]
}

/**
 * Get NHF rates for a specific effective date
 */
function getNhfRatesForDate(effectiveDate: string): NigeriaNhfRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(NIGERIA_NHF_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse()
  
  const latestVersion = versions[0] || '1970-01-01'
  return NIGERIA_NHF_VERSIONS[latestVersion]
}

/**
 * Get NSITF rates for a specific effective date
 */
function getNsitfRatesForDate(effectiveDate: string): NigeriaNsitfRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(NIGERIA_NSITF_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse()
  
  const latestVersion = versions[0] || '1970-01-01'
  return NIGERIA_NSITF_VERSIONS[latestVersion]
}

/**
 * Check if effective date is on/after tax reform (2026-01-01)
 */
function isPostTaxReform(effectiveDate: string): boolean {
  const date = extractDatePart(effectiveDate)
  return date >= TAX_REFORM_DATE
}

/**
 * Calculate Consolidated Relief Allowance (CRA) - Pre-2026 only
 * 
 * Formula:
 * CRA = max(200,000, 0.01 * grossAnnual) + 0.20 * GI2
 * where GI2 = grossAnnual - pensionAnnual
 * 
 * @param grossAnnual Annual gross salary
 * @param pensionAnnual Annual pension employee contribution
 * @returns CRA amount (annual)
 */
function calculateCRA(grossAnnual: number, pensionAnnual: number): number {
  const GI2 = grossAnnual - pensionAnnual
  const firstComponent = Math.max(200000, 0.01 * grossAnnual)
  const secondComponent = 0.20 * GI2
  return roundPayroll(firstComponent + secondComponent)
}

/**
 * Calculate PAYE (PIT) tax using progressive tax bands on annual taxable income
 * 
 * Progressive tax calculation:
 * - Each band applies only to income within that band range
 * - Tax is cumulative (band 1 + band 2 + ...)
 * - Result is annual tax, will be divided by 12 for monthly
 * 
 * Example for 1,500,000 annual (pre-2026):
 * - Band 1 (0-300k): 300,000 * 0.07 = 21,000
 * - Band 2 (300k-600k): 300,000 * 0.11 = 33,000
 * - Band 3 (600k-1.1M): 500,000 * 0.15 = 75,000
 * - Band 4 (1.1M-1.6M): 400,000 * 0.19 = 76,000
 * - Total: 21,000 + 33,000 + 75,000 + 76,000 = 205,000
 * 
 * @param taxableAnnual Annual taxable income
 * @param effectiveDate Effective date for rate selection
 * @returns PAYE tax amount (annual)
 */
function calculatePayeAnnual(taxableAnnual: number, effectiveDate: string): number {
  if (taxableAnnual <= 0) {
    return 0
  }

  const payeRates = getPayeRatesForDate(effectiveDate)
  let totalTax = 0
  let previousMax = -1

  for (let i = 0; i < payeRates.bands.length; i++) {
    const band = payeRates.bands[i]
    const bandMin = band.min
    const bandMax = band.max === null ? Infinity : band.max
    const bandRate = band.rate

    if (taxableAnnual <= bandMin) {
      // Income is below this band, no tax
      break
    }

    // Calculate how much income falls in this band
    // For progressive tax: each band only taxes income within its range
    // Bands are inclusive: bandMin to bandMax (both inclusive)
    // Example: if taxableAnnual=1,500,000 and band is 1,100,001-1,600,000
    // Then: incomeStart = max(1,100,001, previousMax+1) = 1,100,001
    //       incomeEnd = min(1,500,000, 1,600,000) = 1,500,000
    //       incomeInBand = 1,500,000 - 1,100,001 + 1 = 400,000 (inclusive count)
    // But for tax: we want to tax 400,000 units, so use: incomeEnd - incomeStart + 1
    const incomeStart = Math.max(bandMin, previousMax + 1)
    const incomeEnd = Math.min(taxableAnnual, bandMax)
    
    if (incomeEnd >= incomeStart) {
      // For inclusive range: if band is 1,100,001 to 1,500,000 (both inclusive)
      // That's 1,500,000 - 1,100,001 + 1 = 400,000 units
      const incomeInBand = incomeEnd - incomeStart + 1
      if (incomeInBand > 0) {
        const taxInBand = incomeInBand * bandRate
        totalTax += taxInBand
      }
    }

    previousMax = bandMax

    // If we've reached the top band or income is fully taxed, stop
    if (taxableAnnual <= bandMax) {
      break
    }
  }

  return roundPayroll(totalTax)
}

/**
 * Nigeria Payroll Engine
 */
export const nigeriaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const { basicSalary, allowances, otherDeductions, effectiveDate } = config

    // Use effectiveDate from config (defaults to payroll_month)
    const dateToUse = effectiveDate

    // Calculate monthly earnings
    const grossMonthly = roundPayroll(basicSalary + allowances)

    // Get rates for effective date
    const pensionRates = getPensionRatesForDate(dateToUse)
    const nhfRates = getNhfRatesForDate(dateToUse)
    const nsitfRates = getNsitfRatesForDate(dateToUse)

    // Calculate monthly deductions
    const pensionEmployeeMonthly = roundPayroll(grossMonthly * pensionRates.employeeRate)
    const nhfMonthly = roundPayroll(basicSalary * nhfRates.employeeRate)

    // Annualize for tax calculation
    const grossAnnual = roundPayroll(grossMonthly * 12)
    const pensionAnnual = roundPayroll(pensionEmployeeMonthly * 12)
    const nhfAnnual = roundPayroll(nhfMonthly * 12)

    // Calculate CRA (pre-2026 only)
    let craAnnual = 0
    if (!isPostTaxReform(dateToUse)) {
      craAnnual = calculateCRA(grossAnnual, pensionAnnual)
    }
    // Note: Rent relief exists post-2026 but requires rent input which is not available
    // Setting rent relief to 0 (no implementation)

    // Calculate annual taxable income
    // Pre-2026: grossAnnual - pensionAnnual - nhfAnnual - CRA
    // 2026+: grossAnnual - pensionAnnual - nhfAnnual (no CRA, no rent relief)
    const taxableAnnual = roundPayroll(grossAnnual - pensionAnnual - nhfAnnual - craAnnual)

    // Calculate annual PAYE (PIT)
    const payeAnnual = calculatePayeAnnual(taxableAnnual, dateToUse)

    // Convert annual PAYE to monthly
    const payeMonthly = roundPayroll(payeAnnual / 12)

    // Calculate monthly taxable income (for output)
    const taxableIncomeMonthly = roundPayroll(taxableAnnual / 12)

    // Calculate employer contributions
    const pensionEmployerMonthly = roundPayroll(grossMonthly * pensionRates.employerRate)
    const nsitfEmployerMonthly = roundPayroll(grossMonthly * nsitfRates.employerRate)

    // Calculate net salary (monthly taxable income - PAYE - other deductions, never negative)
    const netSalary = Math.max(0, roundPayroll(taxableIncomeMonthly - payeMonthly - otherDeductions))

    // Build statutory deductions
    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: 'PENSION_EMPLOYEE',
        name: 'Pension Employee Contribution',
        rate: pensionRates.employeeRate,
        base: roundPayroll(grossMonthly),
        amount: pensionEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: true, // Pension is deductible from taxable income
      },
      {
        code: 'NHF_EMPLOYEE',
        name: 'National Housing Fund (Employee)',
        rate: nhfRates.employeeRate,
        base: roundPayroll(basicSalary),
        amount: nhfMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: true, // NHF is deductible from taxable income
      },
      {
        code: 'PAYE',
        name: 'PAYE',
        rate: 0, // PAYE uses progressive bands, no single rate
        base: roundPayroll(taxableIncomeMonthly),
        amount: payeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // PAYE is calculated on taxable income (after pension, NHF, CRA)
      },
    ]

    // Build employer contributions
    const employerContributions: EmployerContribution[] = [
      {
        code: 'PENSION_EMPLOYER',
        name: 'Pension Employer Contribution',
        rate: pensionRates.employerRate,
        base: roundPayroll(grossMonthly),
        amount: pensionEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
      {
        code: 'NSITF_EMPLOYER',
        name: 'NSITF Employer Contribution',
        rate: nsitfRates.employerRate,
        base: roundPayroll(grossMonthly),
        amount: nsitfEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
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
        grossSalary: roundPayroll(grossMonthly),
      },
      statutoryDeductions,
      otherDeductions: roundPayroll(otherDeductions),
      employerContributions,
      totals: {
        grossSalary: roundPayroll(grossMonthly),
        totalStatutoryDeductions,
        totalOtherDeductions: roundPayroll(otherDeductions),
        taxableIncome: roundPayroll(taxableIncomeMonthly),
        netSalary,
        totalEmployerContributions,
      },
    }
  },
}
