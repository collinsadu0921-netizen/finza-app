/**
 * Zambia Payroll Engine Implementation
 * Implements Zambia's payroll structure with PAYE tax bands, NAPSA pension contributions, NHIMA health insurance, and SDL
 * 
 * Version A (from 2025-01-01):
 * - NAPSA Employee: 5% of gross (capped at 1,708.20 per month)
 * - NAPSA Employer: 5% of gross (capped at 1,708.20 per month)
 * 
 * Version B (from 2026-01-01):
 * - NAPSA Employee: 5% of gross (capped at 1,861.80 per month)
 * - NAPSA Employer: 5% of gross (capped at 1,861.80 per month)
 * 
 * All versions:
 * - PAYE: Progressive tax bands on monthly chargeable income (ZRA bands)
 * - NHIMA Employee: 1% of basic salary only
 * - NHIMA Employer: 1% of basic salary only
 * - SDL Employer: 0.5% of gross (Skills Development Levy, employer-only)
 * 
 * ASSUMPTIONS (documented):
 * - Employee is treated as RESIDENT
 * - PAYE base = grossMonthly (chargeable income, no reliefs implemented here)
 * - NAPSA employee contribution is tax-deductible (statutory pension contribution)
 * - Sources:
 *   - PAYE bands: https://www.zra.org.zm/paye-calculator/
 *   - PAYE due date: https://www.zra.org.zm/payment-due-dates/ and https://www.zra.org.zm/wp-content/uploads/2021/08/Post-Registration.pdf
 *   - NAPSA 2025 cap: https://taxsummaries.pwc.com/zambia/corporate/other-taxes and https://www.napsa.co.zm/self-service/calculators
 *   - NAPSA 2026 ceiling: https://communityhub.sage.com/za/sage-vip-payroll-hr/f/announcements/261227/zambia-national-pension-scheme-authority-napsa-ceiling-for-2026
 *   - NHIMA: https://nhima.co.zm/membership/registration-steps and https://communityhub.sage.com/za/sage-payroll-professional/f/announcements/153251/zambia-new-nhima-contribution-schedule-report-available
 *   - SDL: https://www.zra.org.zm/wp-content/uploads/2021/08/Skills-Development.pdf
 * 
 * Taxable Income (Monthly):
 * - taxableIncome = grossMonthly - employeeNapsa (NAPSA employee is tax-deductible)
 * 
 * PAYE Calculation (Monthly, ZRA bands):
 * - If chargeable <= 5,100: paye = 0
 * - 5,100.01 <= chargeable <= 7,100: paye = (chargeable - 5,100) * 0.20
 * - 7,100.01 <= chargeable <= 9,200: paye = 400 + (chargeable - 7,100) * 0.30
 * - chargeable > 9,200: paye = 1,030 + (chargeable - 9,200) * 0.37
 * 
 * NAPSA Calculation:
 * - Base: grossMonthly (contributory earnings include most emoluments)
 * - Rate: 5% employee + 5% employer
 * - Capped by monthly earnings ceiling (versioned by effectiveDate)
 * 
 * NHIMA Calculation:
 * - Base: basicSalary (default) or grossMonthly (if nhimaBase='gross')
 * - Rate: 1% employee + 1% employer
 * 
 * SDL Calculation:
 * - Base: grossMonthly
 * - Rate: 0.5% employer-only
 * 
 * WCFCB Calculation (optional, employer-only):
 * - Base: grossMonthly
 * - Rate: configurable (wcfcRate, depends on risk classification)
 * - Only included if wcfcRate > 0
 * - Sources:
 *   - WCFCB scheme: https://www.workers.com.zm/
 *   - Historical rate variability: https://customerzone.sagevip.co.za/doclib/Legislation/Zambia%20Payroll%20Summary%202019.pdf
 *   - SDL: https://www.zra.org.zm/wp-content/uploads/2020/07/Skills-Dev.-Leaflet.pdf
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/**
 * Zambia NAPSA contribution caps
 */
interface ZambiaNapsaCaps {
  maxEmployee: number // Maximum employee contribution per month
  maxEmployer: number // Maximum employer contribution per month
}

/**
 * Zambia NAPSA cap versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: caps for that version
 */
const ZAMBIA_NAPSA_CAPS: Record<string, ZambiaNapsaCaps> = {
  // Version A: NAPSA caps from 2025-01-01 (max per side = 1,708.20)
  '2025-01-01': {
    maxEmployee: 1708.20,
    maxEmployer: 1708.20,
  },
  // Version B: NAPSA caps from 2026-01-01 (max per side = 1,861.80)
  '2026-01-01': {
    maxEmployee: 1861.80,
    maxEmployer: 1861.80,
  },
}

/**
 * Get NAPSA caps for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns NAPSA caps for the effective date
 */
function getNapsaCapsForDate(effectiveDate: string): ZambiaNapsaCaps {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(ZAMBIA_NAPSA_CAPS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  // Default to 2025 caps if date is before 2025
  const latestVersion = versions[0] || '2025-01-01'
  return ZAMBIA_NAPSA_CAPS[latestVersion]
}

/**
 * Calculate PAYE tax using progressive tax bands (monthly, ZRA bands)
 * 
 * PAYE bands (ZRA):
 * - If chargeable <= 5,100: paye = 0
 * - 5,100.01 <= chargeable <= 7,100: paye = (chargeable - 5,100) * 0.20
 * - 7,100.01 <= chargeable <= 9,200: paye = 400 + (chargeable - 7,100) * 0.30
 * - chargeable > 9,200: paye = 1,030 + (chargeable - 9,200) * 0.37
 * 
 * @param chargeableMonthly Monthly chargeable income
 * @returns PAYE tax amount (monthly)
 */
function calculatePaye(chargeableMonthly: number): number {
  if (chargeableMonthly <= 0) {
    return 0
  }

  const chargeable = chargeableMonthly

  if (chargeable <= 5100) {
    return 0
  } else if (chargeable <= 7100) {
    // 5,100.01 <= chargeable <= 7,100: paye = (chargeable - 5,100) * 0.20
    return roundPayroll((chargeable - 5100) * 0.20)
  } else if (chargeable <= 9200) {
    // 7,100.01 <= chargeable <= 9,200: paye = 400 + (chargeable - 7,100) * 0.30
    return roundPayroll(400 + (chargeable - 7100) * 0.30)
  } else {
    // chargeable > 9,200: paye = 1,030 + (chargeable - 9,200) * 0.37
    return roundPayroll(1030 + (chargeable - 9200) * 0.37)
  }
}

/**
 * Zambia Payroll Engine
 */
export const zambiaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const { 
      basicSalary, 
      allowances, 
      otherDeductions, 
      effectiveDate,
      nhimaBase = 'basic',
      wcfcRate = 0,
      wcfcRiskClass = '',
    } = config

    // Use effectiveDate from config (defaults to payroll_month)
    const dateToUse = effectiveDate

    // Calculate monthly earnings
    const grossMonthly = roundPayroll(basicSalary + allowances)

    // Get NAPSA caps for effective date
    const napsaCaps = getNapsaCapsForDate(dateToUse)

    // Calculate chargeable income for PAYE
    // chargeable = grossMonthly (no reliefs implemented here)
    const chargeableMonthly = roundPayroll(grossMonthly)

    // Calculate PAYE tax (monthly)
    const payeMonthly = calculatePaye(chargeableMonthly)

    // Calculate NAPSA contributions (5% each, capped)
    // Base: grossMonthly
    const napsaEmployeeUncapped = roundPayroll(grossMonthly * 0.05)
    const napsaEmployerUncapped = roundPayroll(grossMonthly * 0.05)
    const napsaEmployeeMonthly = Math.min(napsaEmployeeUncapped, napsaCaps.maxEmployee)
    const napsaEmployerMonthly = Math.min(napsaEmployerUncapped, napsaCaps.maxEmployer)

    // Calculate NHIMA contributions (1% each)
    // Base: basicSalary (default) or grossMonthly (if nhimaBase='gross')
    const nhimaBaseAmount = nhimaBase === 'gross' ? grossMonthly : basicSalary
    const nhimaEmployeeMonthly = roundPayroll(nhimaBaseAmount * 0.01)
    const nhimaEmployerMonthly = roundPayroll(nhimaBaseAmount * 0.01)

    // Calculate SDL (0.5% employer-only, on grossMonthly)
    const sdlEmployerMonthly = roundPayroll(grossMonthly * 0.005)

    // Calculate WCFCB (employer-only, on grossMonthly, only if wcfcRate > 0)
    // WCFCB rate depends on risk classification; must be configured per employer
    const wcfcbEmployerMonthly = wcfcRate > 0 ? roundPayroll(grossMonthly * wcfcRate) : 0

    // Calculate net salary
    // netSalary = max(0, grossMonthly - PAYE - napsaEmployee - nhimaEmployee - otherDeductions)
    const netSalary = Math.max(0, roundPayroll(
      grossMonthly - payeMonthly - napsaEmployeeMonthly - nhimaEmployeeMonthly - otherDeductions
    ))

    // Build statutory deductions (ordered: PAYE, NAPSA_EMPLOYEE, NHIMA_EMPLOYEE)
    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: 'PAYE',
        name: 'PAYE',
        rate: 0, // PAYE uses progressive bands, no single rate
        base: roundPayroll(chargeableMonthly),
        amount: payeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // PAYE is calculated on chargeable income
      },
      {
        code: 'NAPSA_EMPLOYEE',
        name: 'NAPSA Employee Contribution',
        rate: 0.05, // 5%
        base: roundPayroll(grossMonthly),
        amount: napsaEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: true, // NAPSA employee is tax-deductible (statutory pension contribution)
      },
      {
        code: 'NHIMA_EMPLOYEE',
        name: 'NHIMA Employee Contribution',
        rate: 0.01, // 1%
        base: roundPayroll(nhimaBaseAmount),
        amount: nhimaEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // NHIMA does not reduce PAYE base
      },
    ]

    // Build employer contributions (ordered: NAPSA_EMPLOYER, NHIMA_EMPLOYER, SDL_EMPLOYER)
    const employerContributions: EmployerContribution[] = [
      {
        code: 'NAPSA_EMPLOYER',
        name: 'NAPSA Employer Contribution',
        rate: 0.05, // 5%
        base: roundPayroll(grossMonthly),
        amount: napsaEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
      {
        code: 'NHIMA_EMPLOYER',
        name: 'NHIMA Employer Contribution',
        rate: 0.01, // 1%
        base: roundPayroll(nhimaBaseAmount),
        amount: nhimaEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
      {
        code: 'SDL_EMPLOYER',
        name: 'Skills Development Levy (Employer)',
        rate: 0.005, // 0.5%
        base: roundPayroll(grossMonthly),
        amount: sdlEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
    ]

    // Add WCFCB employer contribution if rate > 0
    // WCFCB rate depends on risk classification; must be configured per employer
    if (wcfcRate > 0) {
      employerContributions.push({
        code: 'WCFCB_EMPLOYER',
        name: 'Workers Compensation Fund (Employer Provision)',
        rate: wcfcRate,
        base: roundPayroll(grossMonthly),
        amount: wcfcbEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      })
    }

    // Calculate totals
    const totalStatutoryDeductions = roundPayroll(
      statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
    )
    const totalEmployerContributions = roundPayroll(
      employerContributions.reduce((sum, c) => sum + c.amount, 0)
    )

    // taxableIncome = grossMonthly - napsaEmployeeMonthly (NAPSA employee is tax-deductible)
    const taxableIncome = roundPayroll(grossMonthly - napsaEmployeeMonthly)

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
 * Zambia Payroll Due Date Constants
 * 
 * These constants are exported for UI to use for filing reminders.
 * Do not implement UI now; just export values.
 * 
 * Sources:
 * - PAYE due date: https://www.zra.org.zm/payment-due-dates/ and https://www.zra.org.zm/wp-content/uploads/2021/08/Post-Registration.pdf
 * - SDL due date: https://www.zra.org.zm/wp-content/uploads/2021/08/Skills-Development.pdf
 * - NHIMA due date: https://nhima.co.zm/membership/registration-steps
 */
export const ZAMBIA_PAYROLL_DUE_DATES = {
  /** PAYE is due on the 10th of the following month */
  ZM_PAYE_DUE_DAY: 10,
  /** SDL is due on the 10th of the following month */
  ZM_SDL_DUE_DAY: 10,
  /** NHIMA is due on the 10th of the following month */
  ZM_NHIMA_DUE_DAY: 10,
  /** NAPSA is due on the 10th of the following month */
  ZM_NAPSA_DUE_DAY: 10,
} as const

/**
 * Zambia Payroll Compliance Warnings
 * 
 * Returns array of compliance warning strings for UI/workspace flagging.
 * Does NOT affect calculation amounts.
 * 
 * @param config Payroll calculation configuration
 * @returns Array of warning strings (empty if no warnings)
 */
export function getZambiaComplianceWarnings(config: PayrollEngineConfig): string[] {
  const warnings: string[] = []
  const { basicSalary, allowances, effectiveDate, wcfcRate, nhimaBase } = config

  // Calculate gross monthly
  const grossMonthly = roundPayroll(basicSalary + allowances)

  // Check NAPSA cap application for 2026+ (informational)
  const dateToUse = extractDatePart(effectiveDate)
  if (dateToUse >= '2026-01-01' && grossMonthly > 50000) {
    // Informational: confirm NAPSA cap is applied for high earners in 2026+
    // This is just a reminder, not an error
    const napsaCaps = getNapsaCapsForDate(effectiveDate)
    const expectedNapsa = Math.min(grossMonthly * 0.05, napsaCaps.maxEmployee)
    if (expectedNapsa >= napsaCaps.maxEmployee) {
      warnings.push(
        `ZM_NAPSA_CAP_APPLIED: NAPSA contribution capped at ZMW ${napsaCaps.maxEmployee.toFixed(2)} per month (2026 ceiling).`
      )
    }
  }

  // Check WCFCB rate configuration
  if (wcfcRate === 0 || wcfcRate === undefined) {
    warnings.push(
      'ZM_WCFCB_MISSING_RATE: WCFCB employer rate not configured (risk-class based).'
    )
  }

  // Check NHIMA base default
  if (nhimaBase === undefined) {
    warnings.push(
      'ZM_NHIMA_BASE_DEFAULTED: NHIMA base defaulted to BASIC; verify employer policy/portal.'
    )
  }

  return warnings
}
