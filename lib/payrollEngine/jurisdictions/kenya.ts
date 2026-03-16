/**
 * Kenya Payroll Engine Implementation
 * Implements Kenya's payroll structure with PAYE tax bands, NSSF contributions, SHIF deductions, and AHL
 * 
 * Version A (legacy, before 2024-07-01):
 * - PAYE: Progressive tax bands (KRA standard rates)
 * - NSSF Employee: 6% (Tier I + Tier II combined)
 * - NSSF Employer: 6% (Tier I + Tier II combined)
 * - NHIF: Flat amount based on gross salary bands
 * 
 * Version B (current, from 2024-07-01):
 * - PAYE: Progressive tax bands (KRA standard rates)
 * - NSSF Employee: 6% (Tier I + Tier II combined)
 * - NSSF Employer: 6% (Tier I + Tier II combined)
 * - SHIF: 2.75% of gross salary (replaces NHIF)
 * - AHL Employee: 1.5% of gross salary
 * - AHL Employer: 1.5% of gross salary
 * 
 * Effective date versioning:
 * - Dates before 2024-07-01: Use Version A (NHIF-based)
 * - Dates on/after 2024-07-01: Use Version B (SHIF + AHL)
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/**
 * Kenya PAYE tax rate version
 */
interface KenyaPayeRates {
  bands: Array<{
    min: number
    max: number | null // null = no upper limit
    rate: number
  }>
}

/**
 * Kenya NSSF contribution rates
 */
interface KenyaNssfRates {
  employeeRate: number // 6% (Tier I + Tier II combined)
  employerRate: number // 6% (Tier I + Tier II combined)
  tier1Limit: number // KES 9,000
  tier2Limit: number // KES 108,000
}

/**
 * Kenya NHIF rate version (legacy, before SHIF)
 */
interface KenyaNhifRates {
  bands: Array<{
    min: number
    max: number | null // null = no upper limit
    amount: number // Flat amount
  }>
}

/**
 * Kenya SHIF contribution rates (current, replaces NHIF)
 */
interface KenyaShifRates {
  rate: number // 2.75%
}

/**
 * Kenya AHL contribution rates (current)
 */
interface KenyaAhlRates {
  employeeRate: number // 1.5%
  employerRate: number // 1.5%
}

/**
 * SHIF introduction date - when SHIF replaced NHIF and AHL was introduced
 */
const SHIF_INTRODUCTION_DATE = '2024-07-01'

/**
 * Personal Relief - KES 2,400 per month (mandatory relief applied to PAYE)
 * Applied after gross PAYE calculation: netPAYE = max(0, grossPAYE - PERSONAL_RELIEF)
 */
const PERSONAL_RELIEF = 2400

/**
 * Kenya payroll rate versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: rates for that version
 */
const KENYA_PAYE_VERSIONS: Record<string, KenyaPayeRates> = {
  // Version A: Current KRA PAYE tax bands (effective from beginning)
  // Standard progressive tax bands (no reliefs)
  '1970-01-01': {
    bands: [
      { min: 0, max: 24000, rate: 0.10 }, // 10% - 0 to 24,000
      { min: 24001, max: 32333, rate: 0.25 }, // 25% - 24,001 to 32,333
      { min: 32334, max: 500000, rate: 0.30 }, // 30% - 32,334 to 500,000
      { min: 500001, max: 800000, rate: 0.325 }, // 32.5% - 500,001 to 800,000
      { min: 800001, max: null, rate: 0.35 }, // 35% - 800,001+ (no upper limit)
    ],
  },
}

const KENYA_NSSF_VERSIONS: Record<string, KenyaNssfRates> = {
  // Version A: Current NSSF rates (effective from beginning)
  // Tier I + Tier II combined (6% employee, 6% employer)
  '1970-01-01': {
    employeeRate: 0.06, // 6%
    employerRate: 0.06, // 6%
    tier1Limit: 9000, // Tier I: up to KES 9,000
    tier2Limit: 108000, // Tier II: KES 9,001 to 108,000
  },
}

const KENYA_NHIF_VERSIONS: Record<string, KenyaNhifRates> = {
  // Version A: Legacy NHIF rates (effective before SHIF introduction)
  // Flat amount based on gross salary bands
  // Used for dates before 2024-07-01
  '1970-01-01': {
    bands: [
      { min: 0, max: 5999, amount: 150 }, // KES 150 - 0 to 5,999
      { min: 6000, max: 7999, amount: 300 }, // KES 300 - 6,000 to 7,999
      { min: 8000, max: 11999, amount: 400 }, // KES 400 - 8,000 to 11,999
      { min: 12000, max: 14999, amount: 500 }, // KES 500 - 12,000 to 14,999
      { min: 15000, max: 19999, amount: 600 }, // KES 600 - 15,000 to 19,999
      { min: 20000, max: 24999, amount: 750 }, // KES 750 - 20,000 to 24,999
      { min: 25000, max: 29999, amount: 850 }, // KES 850 - 25,000 to 29,999
      { min: 30000, max: 34999, amount: 900 }, // KES 900 - 30,000 to 34,999
      { min: 35000, max: 39999, amount: 950 }, // KES 950 - 35,000 to 39,999
      { min: 40000, max: 44999, amount: 1000 }, // KES 1,000 - 40,000 to 44,999
      { min: 45000, max: 49999, amount: 1100 }, // KES 1,100 - 45,000 to 49,999
      { min: 50000, max: 59999, amount: 1200 }, // KES 1,200 - 50,000 to 59,999
      { min: 60000, max: 69999, amount: 1300 }, // KES 1,300 - 60,000 to 69,999
      { min: 70000, max: 79999, amount: 1400 }, // KES 1,400 - 70,000 to 79,999
      { min: 80000, max: 89999, amount: 1500 }, // KES 1,500 - 80,000 to 89,999
      { min: 90000, max: 99999, amount: 1600 }, // KES 1,600 - 90,000 to 99,999
      { min: 100000, max: null, amount: 1700 }, // KES 1,700 - 100,000+ (no upper limit)
    ],
  },
}

const KENYA_SHIF_VERSIONS: Record<string, KenyaShifRates> = {
  // Version B: Current SHIF rates (effective from SHIF introduction)
  // SHIF: 2.75% of gross salary (replaces NHIF)
  // Used for dates on/after 2024-07-01
  [SHIF_INTRODUCTION_DATE]: {
    rate: 0.0275, // 2.75%
  },
}

const KENYA_AHL_VERSIONS: Record<string, KenyaAhlRates> = {
  // Version B: Current AHL rates (effective from SHIF introduction)
  // AHL Employee: 1.5% of gross salary
  // AHL Employer: 1.5% of gross salary
  // Used for dates on/after 2024-07-01
  [SHIF_INTRODUCTION_DATE]: {
    employeeRate: 0.015, // 1.5%
    employerRate: 0.015, // 1.5%
  },
}

/**
 * Get PAYE tax bands for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns PAYE tax bands for the effective date
 */
function getPayeRatesForDate(effectiveDate: string): KenyaPayeRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(KENYA_PAYE_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return KENYA_PAYE_VERSIONS[latestVersion]
}

/**
 * Get NSSF rates for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns NSSF rates for the effective date
 */
function getNssfRatesForDate(effectiveDate: string): KenyaNssfRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(KENYA_NSSF_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return KENYA_NSSF_VERSIONS[latestVersion]
}

/**
 * Get NHIF rates for a specific effective date (legacy, before SHIF)
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns NHIF rates for the effective date
 */
function getNhifRatesForDate(effectiveDate: string): KenyaNhifRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(KENYA_NHIF_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return KENYA_NHIF_VERSIONS[latestVersion]
}

/**
 * Get SHIF rates for a specific effective date (current, replaces NHIF)
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns SHIF rates for the effective date
 */
function getShifRatesForDate(effectiveDate: string): KenyaShifRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(KENYA_SHIF_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || SHIF_INTRODUCTION_DATE
  return KENYA_SHIF_VERSIONS[latestVersion]
}

/**
 * Get AHL rates for a specific effective date (current)
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns AHL rates for the effective date
 */
function getAhlRatesForDate(effectiveDate: string): KenyaAhlRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(KENYA_AHL_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || SHIF_INTRODUCTION_DATE
  return KENYA_AHL_VERSIONS[latestVersion]
}

/**
 * Check if SHIF regime is active for a given effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns true if SHIF regime is active, false if legacy NHIF regime
 */
function isShifRegime(effectiveDate: string): boolean {
  const date = extractDatePart(effectiveDate)
  return date >= SHIF_INTRODUCTION_DATE
}

/**
 * Calculate PAYE tax using progressive tax bands
 * 
 * Progressive tax calculation:
 * - Each band applies only to income within that band range
 * - Tax is cumulative (band 1 + band 2 + ...)
 * 
 * Example for 50,000 taxable income:
 * - Band 1 (0-24,000): 24,000 * 0.10 = 2,400
 * - Band 2 (24,001-32,333): 8,333 * 0.25 = 2,083.25
 * - Band 3 (32,334-500,000): (50,000 - 32,333) * 0.30 = 5,300.10
 * - Total: 2,400 + 2,083.25 + 5,300.10 = 9,783.35
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
  
  // Progressive tax calculation (matches KRA standard PAYE bands)
  // Band 1 (0-24,000): tax = income * 0.10 (up to 24,000)
  // Band 2 (24,001-32,333): tax = (24,000 * 0.10) + (income - 24,000) * 0.25
  // etc.
  
  // Progressive tax calculation (matches KRA standard PAYE bands)
  // Band 1 (0-24,000): tax = income * 0.10 (up to 24,000)
  // Band 2 (24,001-32,333): tax = (24,000 * 0.10) + (income - 24,000) * 0.25
  // Band 3 (32,334-500,000): tax = Band1 + Band2 + (income - 32,333) * 0.30
  // etc.
  
  if (taxableIncome <= 24000) {
    return roundPayroll(taxableIncome * 0.10)
  } else if (taxableIncome <= 32333) {
    // Band 1: 24,000 * 0.10 = 2,400
    // Band 2: (income - 24,000) * 0.25
    return roundPayroll(24000 * 0.10 + (taxableIncome - 24000) * 0.25)
  } else if (taxableIncome <= 500000) {
    // Band 1: 24,000 * 0.10 = 2,400
    // Band 2: 8,333 * 0.25 = 2,083.25
    // Band 3: (income - 32,333) * 0.30
    return roundPayroll(24000 * 0.10 + 8333 * 0.25 + (taxableIncome - 32333) * 0.30)
  } else if (taxableIncome <= 800000) {
    // Band 1: 24,000 * 0.10 = 2,400
    // Band 2: 8,333 * 0.25 = 2,083.25
    // Band 3: (500,000 - 32,333) * 0.30 = 140,000.10
    // Band 4: (income - 500,000) * 0.325
    return roundPayroll(
      24000 * 0.10 +
      8333 * 0.25 +
      (500000 - 32333) * 0.30 +
      (taxableIncome - 500000) * 0.325
    )
  } else {
    // Band 1: 24,000 * 0.10 = 2,400
    // Band 2: 8,333 * 0.25 = 2,083.25
    // Band 3: (500,000 - 32,333) * 0.30 = 140,000.10
    // Band 4: (800,000 - 500,000) * 0.325 = 97,500
    // Band 5: (income - 800,000) * 0.35
    return roundPayroll(
      24000 * 0.10 +
      8333 * 0.25 +
      (500000 - 32333) * 0.30 +
      (800000 - 500000) * 0.325 +
      (taxableIncome - 800000) * 0.35
    )
  }
}

/**
 * Calculate NSSF employee contribution
 * 
 * NSSF is calculated on pensionable earnings:
 * - Tier I: 6% of earnings up to KES 9,000 (max 540)
 * - Tier II: 6% of earnings between KES 9,001 and 108,000
 * - Combined: Total employee contribution
 * 
 * @param grossSalary Gross salary amount
 * @param effectiveDate Effective date for rate selection
 * @returns NSSF employee contribution amount
 */
function calculateNssfEmployee(grossSalary: number, effectiveDate: string): number {
  if (grossSalary <= 0) {
    return 0
  }

  const nssfRates = getNssfRatesForDate(effectiveDate)
  
  // Calculate Tier I contribution (6% of first 9,000, max 540)
  const tier1Base = Math.min(grossSalary, nssfRates.tier1Limit)
  const tier1Contribution = tier1Base * nssfRates.employeeRate
  
  // Calculate Tier II contribution (6% of earnings between 9,001 and 108,000)
  // Only applies if gross salary exceeds Tier I limit
  let tier2Contribution = 0
  if (grossSalary > nssfRates.tier1Limit) {
    // Tier II base is the amount between tier1Limit and tier2Limit, capped at grossSalary
    const tier2UpperLimit = Math.min(grossSalary, nssfRates.tier2Limit)
    const tier2Base = tier2UpperLimit - nssfRates.tier1Limit
    tier2Contribution = tier2Base * nssfRates.employeeRate
  }
  
  return roundPayroll(tier1Contribution + tier2Contribution)
}

/**
 * Calculate NSSF employer contribution
 * 
 * NSSF employer contribution matches employee contribution:
 * - Tier I: 6% of earnings up to KES 9,000 (max 540)
 * - Tier II: 6% of earnings between KES 9,001 and 108,000
 * - Combined: Total employer contribution
 * 
 * @param grossSalary Gross salary amount
 * @param effectiveDate Effective date for rate selection
 * @returns NSSF employer contribution amount
 */
function calculateNssfEmployer(grossSalary: number, effectiveDate: string): number {
  // Employer contribution is same as employee contribution
  return calculateNssfEmployee(grossSalary, effectiveDate)
}

/**
 * Calculate NHIF contribution (legacy, before SHIF)
 * 
 * NHIF is a flat amount based on gross salary bands
 * Only used for dates before SHIF introduction
 * 
 * @param grossSalary Gross salary amount
 * @param effectiveDate Effective date for rate selection
 * @returns NHIF contribution amount
 */
function calculateNhif(grossSalary: number, effectiveDate: string): number {
  if (grossSalary <= 0) {
    return 0
  }

  const nhifRates = getNhifRatesForDate(effectiveDate)
  
  // Find the appropriate NHIF band
  for (const band of nhifRates.bands) {
    const bandMax = band.max === null ? Infinity : band.max
    
    if (grossSalary >= band.min && grossSalary <= bandMax) {
      return band.amount
    }
  }
  
  // Fallback: use the highest band if salary exceeds all bands
  const highestBand = nhifRates.bands[nhifRates.bands.length - 1]
  return highestBand.amount
}

/**
 * Calculate SHIF contribution (current, replaces NHIF)
 * 
 * SHIF is 2.75% of gross salary
 * Only used for dates on/after SHIF introduction
 * 
 * @param grossSalary Gross salary amount
 * @param effectiveDate Effective date for rate selection
 * @returns SHIF contribution amount
 */
function calculateShif(grossSalary: number, effectiveDate: string): number {
  if (grossSalary <= 0) {
    return 0
  }

  const shifRates = getShifRatesForDate(effectiveDate)
  return roundPayroll(grossSalary * shifRates.rate)
}

/**
 * Calculate AHL employee contribution (current)
 * 
 * AHL employee is 1.5% of gross salary
 * Only used for dates on/after SHIF introduction
 * 
 * @param grossSalary Gross salary amount
 * @param effectiveDate Effective date for rate selection
 * @returns AHL employee contribution amount
 */
function calculateAhlEmployee(grossSalary: number, effectiveDate: string): number {
  if (grossSalary <= 0) {
    return 0
  }

  const ahlRates = getAhlRatesForDate(effectiveDate)
  return roundPayroll(grossSalary * ahlRates.employeeRate)
}

/**
 * Calculate AHL employer contribution (current)
 * 
 * AHL employer is 1.5% of gross salary
 * Only used for dates on/after SHIF introduction
 * 
 * @param grossSalary Gross salary amount
 * @param effectiveDate Effective date for rate selection
 * @returns AHL employer contribution amount
 */
function calculateAhlEmployer(grossSalary: number, effectiveDate: string): number {
  if (grossSalary <= 0) {
    return 0
  }

  const ahlRates = getAhlRatesForDate(effectiveDate)
  return roundPayroll(grossSalary * ahlRates.employerRate)
}

/**
 * Kenya Payroll Engine
 */
export const kenyaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const { basicSalary, allowances, otherDeductions, effectiveDate } = config

    // Use effectiveDate from config (defaults to payroll_month)
    const dateToUse = effectiveDate

    // Calculate earnings
    const grossSalary = basicSalary + allowances

    // Get rates for effective date
    const nssfRates = getNssfRatesForDate(dateToUse)

    // Calculate NSSF employee contribution (6% on pensionable earnings, tax-deductible)
    const nssfEmployeeAmount = calculateNssfEmployee(grossSalary, dateToUse)

    // Determine which regime to use based on effective date
    const useShifRegime = isShifRegime(dateToUse)

    let taxableIncome: number
    let statutoryDeductions: StatutoryDeduction[]
    let employerContributions: EmployerContribution[]

    if (useShifRegime) {
      // Current regime: SHIF + AHL (on/after 2024-07-01)
      const shifRates = getShifRatesForDate(dateToUse)
      const ahlRates = getAhlRatesForDate(dateToUse)

      // Calculate SHIF contribution (2.75% of gross, tax-deductible)
      const shifAmount = calculateShif(grossSalary, dateToUse)

      // Calculate AHL employee contribution (1.5% of gross, tax-deductible)
      const ahlEmployeeAmount = calculateAhlEmployee(grossSalary, dateToUse)

      // Calculate taxable income (gross - NSSF employee - SHIF - AHL employee, all tax-deductible)
      taxableIncome = roundPayroll(grossSalary - nssfEmployeeAmount - shifAmount - ahlEmployeeAmount)

      // Calculate gross PAYE tax using progressive bands
      const grossPayeAmount = calculatePaye(taxableIncome, dateToUse)

      // Apply Personal Relief after PAYE calculation (KES 2,400/month)
      // Net PAYE = max(0, gross PAYE - Personal Relief)
      const payeAmount = Math.max(0, roundPayroll(grossPayeAmount - PERSONAL_RELIEF))

      // Calculate NSSF employer contribution (6% on pensionable earnings, expense to employer)
      const nssfEmployerAmount = calculateNssfEmployer(grossSalary, dateToUse)

      // Calculate AHL employer contribution (1.5% of gross, expense to employer)
      const ahlEmployerAmount = calculateAhlEmployer(grossSalary, dateToUse)

      // Build statutory deductions (current regime)
      statutoryDeductions = [
        {
          code: 'NSSF_EMPLOYEE',
          name: 'NSSF Employee Contribution',
          rate: nssfRates.employeeRate,
          base: roundPayroll(grossSalary),
          amount: nssfEmployeeAmount,
          ledgerAccountCode: '2221', // NSSF Employee Contribution Payable
          isTaxDeductible: true, // NSSF is deductible from taxable income
        },
        {
          code: 'SHIF',
          name: 'SHIF Contribution',
          rate: shifRates.rate,
          base: roundPayroll(grossSalary),
          amount: shifAmount,
          ledgerAccountCode: '2223', // SHIF Contribution Payable
          isTaxDeductible: true, // SHIF is deductible from taxable income
        },
        {
          code: 'AHL_EMPLOYEE',
          name: 'Affordable Housing Levy (Employee)',
          rate: ahlRates.employeeRate,
          base: roundPayroll(grossSalary),
          amount: ahlEmployeeAmount,
          ledgerAccountCode: '2224', // AHL Employee Contribution Payable
          isTaxDeductible: true, // AHL employee is deductible from taxable income
        },
        {
          code: 'PAYE',
          name: 'PAYE',
          rate: 0, // PAYE uses progressive bands, no single rate
          base: roundPayroll(taxableIncome),
          amount: payeAmount,
          ledgerAccountCode: '2211', // PAYE Liability (Kenya)
          isTaxDeductible: false, // PAYE is calculated on taxable income (after NSSF, SHIF, and AHL)
        },
      ]

      // Build employer contributions (current regime)
      employerContributions = [
        {
          code: 'NSSF_EMPLOYER',
          name: 'NSSF Employer Contribution',
          rate: nssfRates.employerRate,
          base: roundPayroll(grossSalary),
          amount: nssfEmployerAmount,
          ledgerExpenseAccountCode: '6011', // Employer NSSF Contribution (expense)
          ledgerLiabilityAccountCode: '2231', // NSSF Employer Contribution Payable
        },
        {
          code: 'AHL_EMPLOYER',
          name: 'Affordable Housing Levy (Employer)',
          rate: ahlRates.employerRate,
          base: roundPayroll(grossSalary),
          amount: ahlEmployerAmount,
          ledgerExpenseAccountCode: '6012', // Employer AHL Contribution (expense)
          ledgerLiabilityAccountCode: '2232', // AHL Employer Contribution Payable
        },
      ]
    } else {
      // Legacy regime: NHIF (before 2024-07-01)
      // Calculate NHIF contribution (flat amount based on gross salary bands, tax-deductible)
      const nhifAmount = calculateNhif(grossSalary, dateToUse)

      // Calculate taxable income (gross - NSSF employee - NHIF, both are tax-deductible)
      taxableIncome = roundPayroll(grossSalary - nssfEmployeeAmount - nhifAmount)

      // Calculate gross PAYE tax using progressive bands
      const grossPayeAmount = calculatePaye(taxableIncome, dateToUse)

      // Apply Personal Relief after PAYE calculation (KES 2,400/month)
      // Net PAYE = max(0, gross PAYE - Personal Relief)
      const payeAmount = Math.max(0, roundPayroll(grossPayeAmount - PERSONAL_RELIEF))

      // Calculate NSSF employer contribution (6% on pensionable earnings, expense to employer)
      const nssfEmployerAmount = calculateNssfEmployer(grossSalary, dateToUse)

      // Build statutory deductions (legacy regime)
      statutoryDeductions = [
        {
          code: 'NSSF_EMPLOYEE',
          name: 'NSSF Employee Contribution',
          rate: nssfRates.employeeRate,
          base: roundPayroll(grossSalary),
          amount: nssfEmployeeAmount,
          ledgerAccountCode: '2221', // NSSF Employee Contribution Payable
          isTaxDeductible: true, // NSSF is deductible from taxable income
        },
        {
          code: 'NHIF',
          name: 'NHIF Contribution',
          rate: 0, // NHIF uses flat amounts, not a rate
          base: roundPayroll(grossSalary),
          amount: nhifAmount,
          ledgerAccountCode: '2222', // NHIF Contribution Payable
          isTaxDeductible: true, // NHIF is deductible from taxable income
        },
        {
          code: 'PAYE',
          name: 'PAYE',
          rate: 0, // PAYE uses progressive bands, no single rate
          base: roundPayroll(taxableIncome),
          amount: payeAmount,
          ledgerAccountCode: '2211', // PAYE Liability (Kenya)
          isTaxDeductible: false, // PAYE is calculated on taxable income (after NSSF and NHIF)
        },
      ]

      // Build employer contributions (legacy regime)
      employerContributions = [
        {
          code: 'NSSF_EMPLOYER',
          name: 'NSSF Employer Contribution',
          rate: nssfRates.employerRate,
          base: roundPayroll(grossSalary),
          amount: nssfEmployerAmount,
          ledgerExpenseAccountCode: '6011', // Employer NSSF Contribution (expense)
          ledgerLiabilityAccountCode: '2231', // NSSF Employer Contribution Payable
        },
      ]
    }

    // Calculate net salary (taxable income - PAYE - other deductions)
    const payeAmount = statutoryDeductions.find(d => d.code === 'PAYE')?.amount || 0
    const netSalary = Math.max(0, roundPayroll(taxableIncome - payeAmount - otherDeductions))

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
