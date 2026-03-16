/**
 * Tanzania Payroll Engine Implementation
 * Implements Tanzania's payroll structure with PAYE tax bands, NSSF contributions, and employer-side liabilities
 * 
 * Version A (effective from 1970-01-01):
 * - NSSF Employee: 10% of gross salary (tax-deductible per TRA guidance)
 * - NSSF Employer: 10% of gross salary
 * - WCF Employer: 0.5% of gross salary (Workers Compensation Fund)
 * - SDL Employer: 3.5% of gross salary (Skills Development Levy)
 * - PAYE: Progressive tax bands on monthly taxable income (resident rules)
 * 
 * ASSUMPTIONS (documented):
 * - Employee is treated as RESIDENT (non-resident flat 15% deferred until we add residency flag)
 * - Apply Tanzania Mainland PAYE bands (Zanzibar differs for SDL, not for PAYE table used here)
 * - SDL (Skills Development Levy) is legally applicable when employer has 10+ employees
 *   Gate SDL by employer headcount once config includes employeeCount / employerSize.
 *   For audit-ready reporting, SDL is INCLUDED by default (employer must verify headcount threshold externally)
 * 
 * Taxable Income (Monthly):
 * - Employee statutory social security (NSSF) is deductible from employment income per TRA guidance
 * - grossMonthly = basicSalary + allowances
 * - nssfEmployee = 0.10 * grossMonthly
 * - taxableMonthly = max(0, grossMonthly - nssfEmployee)
 * 
 * PAYE Calculation (Residents - Monthly, TRA bands):
 * - If taxableMonthly <= 270,000: paye = 0
 * - 270,000 < taxableMonthly <= 520,000: paye = (taxableMonthly - 270,000) * 0.08
 * - 520,000 < taxableMonthly <= 760,000: paye = 20,000 + (taxableMonthly - 520,000) * 0.20
 * - 760,000 < taxableMonthly <= 1,000,000: paye = 68,000 + (taxableMonthly - 760,000) * 0.25
 * - taxableMonthly > 1,000,000: paye = 128,000 + (taxableMonthly - 1,000,000) * 0.30
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/**
 * Tanzania NSSF contribution rates
 */
interface TanzaniaNssfRates {
  employeeRate: number // 10%
  employerRate: number // 10%
}

/**
 * Tanzania payroll rate versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: rates for that version
 */
const TANZANIA_NSSF_VERSIONS: Record<string, TanzaniaNssfRates> = {
  // Version A: Current NSSF rates (effective from beginning)
  '1970-01-01': {
    employeeRate: 0.10, // 10%
    employerRate: 0.10, // 10%
  },
}

/**
 * Get NSSF rates for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns NSSF rates for the effective date
 */
function getNssfRatesForDate(effectiveDate: string): TanzaniaNssfRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(TANZANIA_NSSF_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return TANZANIA_NSSF_VERSIONS[latestVersion]
}

/**
 * Calculate PAYE tax using progressive tax bands (monthly, residents)
 * 
 * PAYE bands (TRA):
 * - If taxableMonthly <= 270,000: paye = 0
 * - 270,000 < taxableMonthly <= 520,000: paye = (taxableMonthly - 270,000) * 0.08
 * - 520,000 < taxableMonthly <= 760,000: paye = 20,000 + (taxableMonthly - 520,000) * 0.20
 * - 760,000 < taxableMonthly <= 1,000,000: paye = 68,000 + (taxableMonthly - 760,000) * 0.25
 * - taxableMonthly > 1,000,000: paye = 128,000 + (taxableMonthly - 1,000,000) * 0.30
 * 
 * @param taxableMonthly Monthly taxable income
 * @returns PAYE tax amount (monthly)
 */
function calculatePaye(taxableMonthly: number): number {
  if (taxableMonthly <= 0) {
    return 0
  }

  const taxable = taxableMonthly

  if (taxable <= 270000) {
    return 0
  } else if (taxable <= 520000) {
    // 270,000 < taxable <= 520,000: paye = (taxable - 270,000) * 0.08
    return roundPayroll((taxable - 270000) * 0.08)
  } else if (taxable <= 760000) {
    // 520,000 < taxable <= 760,000: paye = 20,000 + (taxable - 520,000) * 0.20
    return roundPayroll(20000 + (taxable - 520000) * 0.20)
  } else if (taxable <= 1000000) {
    // 760,000 < taxable <= 1,000,000: paye = 68,000 + (taxable - 760,000) * 0.25
    return roundPayroll(68000 + (taxable - 760000) * 0.25)
  } else {
    // taxable > 1,000,000: paye = 128,000 + (taxable - 1,000,000) * 0.30
    return roundPayroll(128000 + (taxable - 1000000) * 0.30)
  }
}

/**
 * Tanzania Payroll Engine
 */
export const tanzaniaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const { basicSalary, allowances, otherDeductions, effectiveDate } = config

    // Use effectiveDate from config (defaults to payroll_month)
    const dateToUse = effectiveDate

    // Calculate monthly earnings
    const grossMonthly = roundPayroll(basicSalary + allowances)

    // Get NSSF rates for effective date
    const nssfRates = getNssfRatesForDate(dateToUse)

    // Calculate NSSF employee contribution (10% of gross, tax-deductible per TRA guidance)
    const nssfEmployeeMonthly = roundPayroll(grossMonthly * nssfRates.employeeRate)

    // Calculate taxable income for PAYE
    // Per TRA guidance: NSSF employee is tax-deductible
    // taxableMonthly = max(0, grossMonthly - nssfEmployeeMonthly)
    const taxableMonthly = Math.max(0, roundPayroll(grossMonthly - nssfEmployeeMonthly))

    // Calculate PAYE tax (monthly, residents)
    const payeMonthly = calculatePaye(taxableMonthly)

    // Calculate NSSF employer contribution (10% of gross, expense to employer)
    const nssfEmployerMonthly = roundPayroll(grossMonthly * nssfRates.employerRate)

    // Calculate WCF employer contribution (0.5% of gross, expense to employer)
    const wcfEmployerMonthly = roundPayroll(grossMonthly * 0.005)

    // Calculate SDL employer contribution (3.5% of gross, expense to employer)
    // TODO: Gate SDL by employer headcount once config includes employeeCount / employerSize
    // SDL is legally applicable when employer has 10+ employees
    // For audit-ready reporting, SDL is INCLUDED by default
    const sdlEmployerMonthly = roundPayroll(grossMonthly * 0.035)

    // Calculate net salary
    // netSalary = grossMonthly - nssfEmployee - paye - otherDeductions (never negative)
    // NOTE: Employer costs (NSSF, WCF, SDL) must NOT reduce netSalary
    const netSalary = Math.max(0, roundPayroll(grossMonthly - nssfEmployeeMonthly - payeMonthly - otherDeductions))

    // Build statutory deductions (ordered: NSSF_EMPLOYEE, PAYE)
    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: 'NSSF_EMPLOYEE',
        name: 'NSSF Employee Contribution',
        rate: nssfRates.employeeRate,
        base: roundPayroll(grossMonthly),
        amount: nssfEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: true, // NSSF is tax-deductible per TRA guidance
      },
      {
        code: 'PAYE',
        name: 'PAYE',
        rate: 0, // PAYE uses progressive bands, no single rate
        base: roundPayroll(taxableMonthly),
        amount: payeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // PAYE is calculated on taxable income
      },
    ]

    // Build employer contributions (ordered: NSSF_EMPLOYER, WCF_EMPLOYER, SDL_EMPLOYER)
    const employerContributions: EmployerContribution[] = [
      {
        code: 'NSSF_EMPLOYER',
        name: 'NSSF Employer Contribution',
        rate: nssfRates.employerRate,
        base: roundPayroll(grossMonthly),
        amount: nssfEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
      {
        code: 'WCF_EMPLOYER',
        name: 'Workers Compensation Fund (Employer)',
        rate: 0.005, // 0.5%
        base: roundPayroll(grossMonthly),
        amount: wcfEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
      {
        code: 'SDL_EMPLOYER',
        name: 'Skills Development Levy (Employer)',
        rate: 0.035, // 3.5%
        base: roundPayroll(grossMonthly),
        amount: sdlEmployerMonthly,
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

    // taxableIncome = grossMonthly - nssfEmployeeMonthly (NSSF is tax-deductible)
    const taxableIncome = roundPayroll(taxableMonthly)

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
        taxableIncome: roundPayroll(taxableIncome),
        netSalary,
        totalEmployerContributions,
      },
    }
  },
}

/**
 * Tanzania Payroll Compliance Warnings
 * 
 * Returns array of compliance warning strings for UI/workspace flagging.
 * Does NOT affect calculation amounts.
 * 
 * @param config Payroll calculation configuration
 * @returns Array of warning strings (empty if no warnings)
 */
export function getTanzaniaComplianceWarnings(config: PayrollEngineConfig): string[] {
  const warnings: string[] = []
  const { basicSalary, allowances, effectiveDate } = config

  // Calculate gross monthly
  const grossMonthly = roundPayroll(basicSalary + allowances)

  // Minimum wage compliance check (effective 2026-01-01)
  const dateToUse = extractDatePart(effectiveDate)
  if (dateToUse >= '2026-01-01') {
    // Minimum wage floor: TZS 175,000 per month (lowest statutory floor)
    // Note: Minimum wages are sector-specific and can be higher (up to 765,900);
    // we only enforce the lowest floor without sector input
    if (grossMonthly < 175000) {
      warnings.push(
        'TZ_MIN_WAGE_RISK: Gross salary below statutory minimum wage floor (TZS 175,000) for 2026+.'
      )
    }
  }

  return warnings
}

/**
 * Tanzania Payroll Due Date Constants
 * 
 * These constants are exported for UI to use for filing reminders.
 * Do not implement UI now; just export values.
 */
export const TANZANIA_PAYROLL_DUE_DATES = {
  /** PAYE and SDL are due on the 7th of the following month */
  PAYE_SDL_DUE_DAY: 7,
  /** NSSF is due on the 15th of the following month */
  NSSF_DUE_DAY: 15,
} as const
