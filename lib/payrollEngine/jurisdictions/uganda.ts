/**
 * Uganda Payroll Engine Implementation
 * Implements Uganda's payroll structure with PAYE tax bands, NSSF contributions, and Local Service Tax (LST)
 * 
 * Version A (effective from 1970-01-01):
 * - NSSF Employee: 5% of gross salary (NOT tax-deductible per URA guidance)
 * - NSSF Employer: 10% of gross salary
 * - LST: Annual tax determined in July, paid in 4 equal instalments (Jul-Oct), tax-deductible
 * - PAYE: Progressive tax bands on monthly chargeable income (resident rules)
 * 
 * ASSUMPTIONS (documented):
 * - Employee is treated as RESIDENT (non-resident rules can be added later when residency flag is available)
 * 
 * Local Service Tax (LST):
 * - LST is assessed annually from monthly cash earnings (gross), determined in July
 * - Paid in first 4 months (Jul-Oct) in 4 equal instalments
 * - LST reduces PAYE base (tax-deductible, limited to actual monthly contribution)
 * - Sources:
 *   - KCCA LST FAQ: https://www.kcca.go.ug/uDocs/Local_Service_Tax_FAQs.pdf
 *   - KPMG TIES Uganda: https://assets.kpmg.com/content/dam/kpmgsites/xx/pdf/2023/01/TIES-Uganda.pdf.coredownload.inline.pdf
 *   - Sage Uganda Tax Summary: https://za-kb.sage.com/portal/app/portlets/results/viewdocument.jsp?solutionid=240927131809127
 * 
 * PAYE Calculation (Residents - Monthly):
 * - If CI <= 235,000: tax = 0
 * - 235,000 < CI <= 335,000: tax = (CI - 235,000) * 0.10
 * - 335,000 < CI <= 410,000: tax = (CI - 335,000) * 0.20 + 10,000
 * - 410,000 < CI <= 10,000,000: tax = (CI - 410,000) * 0.30 + 25,000
 * - CI > 10,000,000: tax = ((CI - 410,000) * 0.30 + 25,000) + ((CI - 10,000,000) * 0.10)
 * 
 * Chargeable Income:
 * - chargeableMonthly = max(0, grossMonthly - lstMonthly)
 * - NSSF employee is NOT tax-deductible per URA guidance
 * - LST is tax-deductible (reduces PAYE base by actual monthly contribution)
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/**
 * Uganda NSSF contribution rates
 */
interface UgandaNssfRates {
  employeeRate: number // 5%
  employerRate: number // 10%
}

/**
 * Uganda payroll rate versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: rates for that version
 */
const UGANDA_NSSF_VERSIONS: Record<string, UgandaNssfRates> = {
  // Version A: Current NSSF rates (effective from beginning, unchanged since 2012)
  '1970-01-01': {
    employeeRate: 0.05, // 5%
    employerRate: 0.10, // 10%
  },
}

/**
 * Get NSSF rates for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns NSSF rates for the effective date
 */
function getNssfRatesForDate(effectiveDate: string): UgandaNssfRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(UGANDA_NSSF_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return UGANDA_NSSF_VERSIONS[latestVersion]
}

/**
 * Calculate annual Local Service Tax (LST) amount based on monthly gross salary
 * 
 * LST Schedule (from KCCA/KPMG sources):
 * - <= 100,000: 0
 * - > 100,000 and <= 200,000: 5,000
 * - > 200,000 and <= 300,000: 10,000
 * - > 300,000 and <= 400,000: 20,000
 * - > 400,000 and <= 500,000: 30,000
 * - > 500,000 and <= 600,000: 40,000
 * - > 600,000 and <= 700,000: 60,000
 * - > 700,000 and <= 800,000: 70,000
 * - > 800,000 and <= 900,000: 80,000
 * - > 900,000 and <= 1,000,000: 90,000
 * - > 1,000,000: 100,000
 * 
 * @param grossMonthly Monthly gross salary (basicSalary + allowances)
 * @returns Annual LST amount
 */
function calculateLstAnnual(grossMonthly: number): number {
  if (grossMonthly <= 100000) {
    return 0
  } else if (grossMonthly <= 200000) {
    return 5000
  } else if (grossMonthly <= 300000) {
    return 10000
  } else if (grossMonthly <= 400000) {
    return 20000
  } else if (grossMonthly <= 500000) {
    return 30000
  } else if (grossMonthly <= 600000) {
    return 40000
  } else if (grossMonthly <= 700000) {
    return 60000
  } else if (grossMonthly <= 800000) {
    return 70000
  } else if (grossMonthly <= 900000) {
    return 80000
  } else if (grossMonthly <= 1000000) {
    return 90000
  } else {
    return 100000
  }
}

/**
 * Check if effective date falls in LST payment months (July, August, September, October)
 * 
 * LST is paid in 4 equal instalments during Jul-Oct
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns true if month is 07, 08, 09, or 10
 */
function isLstPaymentMonth(effectiveDate: string): boolean {
  const date = extractDatePart(effectiveDate)
  const month = date.substring(5, 7) // Extract MM from YYYY-MM-DD
  return month === '07' || month === '08' || month === '09' || month === '10'
}

/**
 * Calculate monthly LST amount
 * 
 * LST is paid in 4 equal instalments during Jul-Oct
 * Per Sage guidance: deduction is limited to actual monthly contribution
 * 
 * @param grossMonthly Monthly gross salary
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns Monthly LST amount (annualLST / 4 if in payment months, else 0)
 */
function calculateLstMonthly(grossMonthly: number, effectiveDate: string): number {
  const annualLst = calculateLstAnnual(grossMonthly)
  
  if (isLstPaymentMonth(effectiveDate)) {
    // LST paid in 4 equal instalments during Jul-Oct
    return roundPayroll(annualLst / 4)
  } else {
    // LST not paid outside payment months
    return 0
  }
}

/**
 * Calculate PAYE tax using progressive tax bands (monthly, residents)
 * 
 * PAYE bands (from Grant Thornton table):
 * - If CI <= 235,000: tax = 0
 * - 235,000 < CI <= 335,000: tax = (CI - 235,000) * 0.10
 * - 335,000 < CI <= 410,000: tax = (CI - 335,000) * 0.20 + 10,000
 * - 410,000 < CI <= 10,000,000: tax = (CI - 410,000) * 0.30 + 25,000
 * - CI > 10,000,000: tax = ((CI - 410,000) * 0.30 + 25,000) + ((CI - 10,000,000) * 0.10)
 * 
 * @param chargeableMonthly Monthly chargeable income
 * @returns PAYE tax amount (monthly)
 */
function calculatePaye(chargeableMonthly: number): number {
  if (chargeableMonthly <= 0) {
    return 0
  }

  const CI = chargeableMonthly

  if (CI <= 235000) {
    return 0
  } else if (CI <= 335000) {
    // 235,000 < CI <= 335,000: tax = (CI - 235,000) * 0.10
    return roundPayroll((CI - 235000) * 0.10)
  } else if (CI <= 410000) {
    // 335,000 < CI <= 410,000: tax = (CI - 335,000) * 0.20 + 10,000
    return roundPayroll((CI - 335000) * 0.20 + 10000)
  } else if (CI <= 10000000) {
    // 410,000 < CI <= 10,000,000: tax = (CI - 410,000) * 0.30 + 25,000
    return roundPayroll((CI - 410000) * 0.30 + 25000)
  } else {
    // CI > 10,000,000: tax = ((CI - 410,000) * 0.30 + 25,000) + ((CI - 10,000,000) * 0.10)
    const baseTax = (CI - 410000) * 0.30 + 25000
    const surcharge = (CI - 10000000) * 0.10
    return roundPayroll(baseTax + surcharge)
  }
}

/**
 * Uganda Payroll Engine
 */
export const ugandaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const { basicSalary, allowances, otherDeductions, effectiveDate } = config

    // Use effectiveDate from config (defaults to payroll_month)
    const dateToUse = effectiveDate

    // Calculate monthly earnings
    const grossMonthly = roundPayroll(basicSalary + allowances)

    // Get NSSF rates for effective date
    const nssfRates = getNssfRatesForDate(dateToUse)

    // Calculate NSSF employee contribution (5% of gross, NOT tax-deductible per URA guidance)
    const nssfEmployeeMonthly = roundPayroll(grossMonthly * nssfRates.employeeRate)

    // Calculate Local Service Tax (LST)
    // LST is assessed annually, determined in July, paid in 4 equal instalments (Jul-Oct)
    // LST is tax-deductible (reduces PAYE base by actual monthly contribution)
    const lstMonthly = calculateLstMonthly(grossMonthly, dateToUse)

    // Calculate chargeable income for PAYE
    // Per URA guidance: NSSF employee is NOT tax-deductible
    // LST is tax-deductible (reduces PAYE base by actual monthly contribution)
    // chargeableMonthly = max(0, grossMonthly - lstMonthly)
    const chargeableMonthly = Math.max(0, roundPayroll(grossMonthly - lstMonthly))

    // Calculate PAYE tax (monthly, residents)
    const payeMonthly = calculatePaye(chargeableMonthly)

    // Calculate NSSF employer contribution (10% of gross, expense to employer)
    const nssfEmployerMonthly = roundPayroll(grossMonthly * nssfRates.employerRate)

    // Calculate net salary
    // netSalary = grossMonthly - nssfEmployee - lstMonthly - paye - otherDeductions (never negative)
    const netSalary = Math.max(0, roundPayroll(grossMonthly - nssfEmployeeMonthly - lstMonthly - payeMonthly - otherDeductions))

    // Build statutory deductions (ordered: NSSF_EMPLOYEE, LST, PAYE)
    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: 'NSSF_EMPLOYEE',
        name: 'NSSF Employee Contribution',
        rate: nssfRates.employeeRate,
        base: roundPayroll(grossMonthly),
        amount: nssfEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // NSSF is NOT tax-deductible per URA guidance
      },
      {
        code: 'LST',
        name: 'Local Service Tax',
        rate: 0, // LST uses banded/flat annual amounts, not a percentage rate
        base: roundPayroll(grossMonthly),
        amount: lstMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: true, // LST reduces PAYE base (limited to actual monthly contribution)
      },
      {
        code: 'PAYE',
        name: 'PAYE',
        rate: 0, // PAYE uses progressive bands, no single rate
        base: roundPayroll(chargeableMonthly),
        amount: payeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // PAYE is calculated on chargeable income
      },
    ]

    // Build employer contributions
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
    ]

    // Calculate totals
    const totalStatutoryDeductions = roundPayroll(
      statutoryDeductions.reduce((sum, d) => sum + d.amount, 0)
    )
    const totalEmployerContributions = roundPayroll(
      employerContributions.reduce((sum, c) => sum + c.amount, 0)
    )

    // taxableIncome = grossMonthly - lstMonthly (since NSSF is not tax-deductible, but LST is)
    const taxableIncome = Math.max(0, roundPayroll(grossMonthly - lstMonthly))

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
