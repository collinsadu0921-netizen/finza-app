/**
 * Rwanda Payroll Engine Implementation
 * Implements Rwanda's payroll structure with PAYE tax bands, RSSB pension contributions, maternity benefits, health schemes, and occupational hazards
 * 
 * Version A (before 2025-01-01):
 * - Pension Employee: 3% of pension base (includes transport from 2025)
 * - Pension Employer: 3% of pension base
 * 
 * Version B (from 2025-01-01):
 * - Pension Employee: 6% of pension base (includes transport)
 * - Pension Employer: 6% of pension base
 * 
 * All versions:
 * - PAYE: Progressive tax bands on monthly taxable income (no relief for pension/maternity per PwC guidance)
 *   - Same rates apply to residents and non-residents per PwC: https://taxsummaries.pwc.com/rwanda/individual/taxes-on-personal-income
 *   - TODO: If future legal source confirms different PAYE for non-residents, implement using isResident flag
 * - Maternity Employee: 0.3% of maternity base (excludes transport allowances)
 * - Maternity Employer: 0.3% of maternity base (excludes transport allowances)
 * - Occupational Hazards: 2% of pension base (employer-only)
 * - Health Scheme: CBHI (0.5% of net) or RAMA (7.5%+7.5% of basic salary)
 * 
 * ASSUMPTIONS (documented):
 * - Employee is treated as RESIDENT by default (isResident flag available but does not change PAYE rates per PwC)
 * - PAYE base = grossMonthly (no relief for pension/maternity contributions per PwC: "No relief for pension contribution")
 * - Sources:
 *   - PAYE bands: https://taxsummaries.pwc.com/rwanda/individual/taxes-on-personal-income
 *   - PAYE remittance: https://taxsummaries.pwc.com/rwanda/individual/tax-administration
 *   - Pension reform: https://www.ey.com/en_gl/technical/tax-alerts/rwanda-gazettes-presidential-order-revising-contributions-to-compulsory-pension-scheme
 *   - Pension base includes transport (2025): https://visionsafrica.com/changes-to-rssb-pension-contributions-in-rwanda-for-2025/
 *   - Pension FAQ: https://www.rssb.rw/uploads/RSSB_FAQS_All_languages_2_760b75b195.pdf
 *   - Maternity base excludes transport: https://www.rssb.rw/fileadmin/Medical/2018_English_RSSB_Booklet_-Final_04012018.pdf
 *   - Maternity: https://www.rssb.rw/scheme/maternity-leave
 *   - Occupational hazards: https://www.rssb.rw/scheme/occupational-hazards
 *   - RAMA medical scheme: https://www.rssb.rw/scheme/medical-scheme and https://www.rra.gov.rw/en/domestic-tax-services/rssb-contributions/medical-scheme-contribution
 *   - CBHI: https://rwandalii.org/akn/rw/act/mo/2020/105
 *   - No relief: https://taxsummaries.pwc.com/rwanda/individual/income-determination
 * 
 * Taxable Income (Monthly):
 * - taxableMonthly = grossMonthly (no deductions reduce PAYE base)
 * 
 * PAYE Calculation (Monthly, progressive bands):
 * - If taxableMonthly <= 60,000: paye = 0
 * - 60,001 <= taxableMonthly <= 100,000: paye = (taxableMonthly - 60,000) * 0.10
 * - 100,001 <= taxableMonthly <= 200,000: paye = 4,000 + (taxableMonthly - 100,000) * 0.20
 * - taxableMonthly > 200,000: paye = 24,000 + (taxableMonthly - 200,000) * 0.30
 * 
 * Health Scheme Calculation:
 * - CBHI mode: 0.5% of netBeforeHealth (employee-only)
 *   netBeforeHealth = max(0, grossMonthly - PAYE - pensionEmployee - maternityEmployee - otherDeductions)
 *   netSalary = max(0, netBeforeHealth - cbhi)
 * - RAMA mode: 7.5% employee + 7.5% employer of basic salary only
 *   netSalary = max(0, grossMonthly - PAYE - pensionEmployee - maternityEmployee - ramaEmployee - otherDeductions)
 */

import type { PayrollEngine, PayrollEngineConfig, PayrollCalculationResult, StatutoryDeduction, EmployerContribution } from '../types'
import { roundPayroll, extractDatePart } from '../versioning'

/**
 * Rwanda Pension contribution rates
 */
interface RwandaPensionRates {
  employeeRate: number // 3% (before 2025) or 6% (from 2025)
  employerRate: number // 3% (before 2025) or 6% (from 2025)
}

/**
 * Rwanda pension rate versions
 * Key: effective date (YYYY-MM-DD) - date when this version becomes active
 * Value: rates for that version
 */
const RWANDA_PENSION_VERSIONS: Record<string, RwandaPensionRates> = {
  // Version A: Pension rates before 2025 (3% + 3% = 6% total)
  '1970-01-01': {
    employeeRate: 0.03, // 3%
    employerRate: 0.03, // 3%
  },
  // Version B: Pension rates from 2025-01-01 (6% + 6% = 12% total)
  '2025-01-01': {
    employeeRate: 0.06, // 6%
    employerRate: 0.06, // 6%
  },
}

/**
 * Get pension rates for a specific effective date
 * 
 * @param effectiveDate ISO date string (YYYY-MM-DD)
 * @returns Pension rates for the effective date
 */
function getPensionRatesForDate(effectiveDate: string): RwandaPensionRates {
  const date = extractDatePart(effectiveDate)
  const versions = Object.keys(RWANDA_PENSION_VERSIONS)
    .filter(versionDate => versionDate <= date)
    .sort()
    .reverse() // Most recent first
  
  const latestVersion = versions[0] || '1970-01-01'
  return RWANDA_PENSION_VERSIONS[latestVersion]
}

/**
 * Calculate PAYE tax using progressive tax bands (monthly)
 * 
 * PAYE bands:
 * - If taxableMonthly <= 60,000: paye = 0
 * - 60,001 <= taxableMonthly <= 100,000: paye = (taxableMonthly - 60,000) * 0.10
 * - 100,001 <= taxableMonthly <= 200,000: paye = 4,000 + (taxableMonthly - 100,000) * 0.20
 * - taxableMonthly > 200,000: paye = 24,000 + (taxableMonthly - 200,000) * 0.30
 * 
 * @param taxableMonthly Monthly taxable income
 * @returns PAYE tax amount (monthly)
 */
function calculatePaye(taxableMonthly: number): number {
  if (taxableMonthly <= 0) {
    return 0
  }

  const taxable = taxableMonthly

  if (taxable <= 60000) {
    return 0
  } else if (taxable <= 100000) {
    // 60,001 <= taxable <= 100,000: paye = (taxable - 60,000) * 0.10
    return roundPayroll((taxable - 60000) * 0.10)
  } else if (taxable <= 200000) {
    // 100,001 <= taxable <= 200,000: paye = 4,000 + (taxable - 100,000) * 0.20
    return roundPayroll(4000 + (taxable - 100000) * 0.20)
  } else {
    // taxable > 200,000: paye = 24,000 + (taxable - 200,000) * 0.30
    return roundPayroll(24000 + (taxable - 200000) * 0.30)
  }
}

/**
 * Rwanda Payroll Engine
 */
export const rwandaPayrollEngine: PayrollEngine = {
  calculate(config: PayrollEngineConfig): PayrollCalculationResult {
    const { 
      basicSalary, 
      allowances, 
      otherDeductions, 
      effectiveDate,
      transportAllowance = 0,
      healthScheme = 'CBHI',
      isResident = true,
    } = config

    // Use effectiveDate from config (defaults to payroll_month)
    const dateToUse = effectiveDate

    // Calculate monthly earnings
    const grossMonthly = roundPayroll(basicSalary + allowances)

    // Calculate transport allowance (clamped to 0 <= transport <= allowances for safety)
    const transport = Math.max(0, Math.min(roundPayroll(transportAllowance), allowances))

    // Base split calculations:
    // Pension base: includes transport (2025+ harmonized to include transport)
    const pensionBase = roundPayroll(grossMonthly)
    
    // Maternity base: excludes transport allowances
    const maternityBase = Math.max(0, roundPayroll(grossMonthly - transport))

    // Get pension rates for effective date
    const pensionRates = getPensionRatesForDate(dateToUse)

    // Calculate taxable income for PAYE
    // Per PwC guidance: no relief for pension/maternity contributions
    // taxableMonthly = grossMonthly (no deductions reduce PAYE base)
    // Note: PwC indicates same PAYE rates apply to residents and non-residents
    // TODO: If future legal source confirms different PAYE for non-residents, implement using isResident flag
    const taxableMonthly = roundPayroll(grossMonthly)

    // Calculate PAYE tax (monthly)
    const payeMonthly = calculatePaye(taxableMonthly)

    // Calculate pension contributions (on pensionBase which includes transport)
    const pensionEmployeeMonthly = roundPayroll(pensionBase * pensionRates.employeeRate)
    const pensionEmployerMonthly = roundPayroll(pensionBase * pensionRates.employerRate)

    // Calculate maternity contributions (on maternityBase which excludes transport)
    const maternityEmployeeMonthly = roundPayroll(maternityBase * 0.003) // 0.3%
    const maternityEmployerMonthly = roundPayroll(maternityBase * 0.003) // 0.3%

    // Calculate occupational hazards (2% employer-only, on pensionBase)
    const occupationalHazardsMonthly = roundPayroll(pensionBase * 0.02)

    // Calculate health scheme contributions
    let healthEmployeeMonthly = 0
    let healthEmployerMonthly = 0
    let netBeforeHealth = 0

    if (healthScheme === 'RAMA') {
      // RAMA: 7.5% employee + 7.5% employer of BASIC SALARY ONLY
      healthEmployeeMonthly = roundPayroll(basicSalary * 0.075)
      healthEmployerMonthly = roundPayroll(basicSalary * 0.075)
      // Calculate netBeforeHealth for netSalary calculation
      netBeforeHealth = Math.max(0, roundPayroll(
        grossMonthly - payeMonthly - pensionEmployeeMonthly - maternityEmployeeMonthly - healthEmployeeMonthly - otherDeductions
      ))
    } else {
      // CBHI: 0.5% of netBeforeCbhi (employee-only)
      // Calculate netBeforeCbhi (gross - PAYE - pension - maternity - otherDeductions)
      netBeforeHealth = Math.max(0, roundPayroll(
        grossMonthly - payeMonthly - pensionEmployeeMonthly - maternityEmployeeMonthly - otherDeductions
      ))
      healthEmployeeMonthly = roundPayroll(netBeforeHealth * 0.005)
    }

    // Calculate net salary
    // For CBHI: netSalary = netBeforeHealth - cbhi
    // For RAMA: netSalary = netBeforeHealth (RAMA already deducted)
    const netSalary = Math.max(0, roundPayroll(netBeforeHealth - (healthScheme === 'CBHI' ? healthEmployeeMonthly : 0)))

    // Build statutory deductions
    // Order: PAYE, RSSB_PENSION_EMPLOYEE, RSSB_MATERNITY_EMPLOYEE, health scheme (CBHI or RAMA)
    const statutoryDeductions: StatutoryDeduction[] = [
      {
        code: 'PAYE',
        name: 'PAYE',
        rate: 0, // PAYE uses progressive bands, no single rate
        base: roundPayroll(taxableMonthly),
        amount: payeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // PAYE is calculated on taxable income (no relief)
      },
      {
        code: 'RSSB_PENSION_EMPLOYEE',
        name: 'RSSB Pension Employee Contribution',
        rate: pensionRates.employeeRate,
        base: roundPayroll(pensionBase),
        amount: pensionEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // No relief for pension contribution per PwC guidance
      },
      {
        code: 'RSSB_MATERNITY_EMPLOYEE',
        name: 'RSSB Maternity Employee Contribution',
        rate: 0.003, // 0.3%
        base: roundPayroll(maternityBase),
        amount: maternityEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // No relief for maternity contribution
      },
    ]

    // Add health scheme deduction (CBHI or RAMA, but not both)
    if (healthScheme === 'RAMA') {
      statutoryDeductions.push({
        code: 'RSSB_MEDICAL_EMPLOYEE',
        name: 'RSSB Medical Scheme (RAMA) Employee Contribution',
        rate: 0.075, // 7.5%
        base: roundPayroll(basicSalary),
        amount: healthEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // No relief for medical scheme contribution
      })
    } else {
      // CBHI
      statutoryDeductions.push({
        code: 'CBHI',
        name: 'Community Based Health Insurance',
        rate: 0.005, // 0.5% (applied to netBeforeHealth, not a percentage of gross)
        base: roundPayroll(netBeforeHealth),
        amount: healthEmployeeMonthly,
        ledgerAccountCode: null, // To be assigned when ledger integration is updated
        isTaxDeductible: false, // CBHI is a net-based health solidarity contribution
      })
    }

    // Build employer contributions
    // Order: RSSB_PENSION_EMPLOYER, RSSB_MATERNITY_EMPLOYER, RSSB_OCCUPATIONAL_HAZARDS, health scheme (if RAMA)
    const employerContributions: EmployerContribution[] = [
      {
        code: 'RSSB_PENSION_EMPLOYER',
        name: 'RSSB Pension Employer Contribution',
        rate: pensionRates.employerRate,
        base: roundPayroll(pensionBase),
        amount: pensionEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
      {
        code: 'RSSB_MATERNITY_EMPLOYER',
        name: 'RSSB Maternity Employer Contribution',
        rate: 0.003, // 0.3%
        base: roundPayroll(maternityBase),
        amount: maternityEmployerMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
      {
        code: 'RSSB_OCCUPATIONAL_HAZARDS',
        name: 'RSSB Occupational Hazards (Employer)',
        rate: 0.02, // 2%
        base: roundPayroll(pensionBase),
        amount: occupationalHazardsMonthly,
        ledgerExpenseAccountCode: null, // To be assigned when ledger integration is updated
        ledgerLiabilityAccountCode: null, // To be assigned when ledger integration is updated
      },
    ]

    // Add RAMA employer contribution if applicable
    if (healthScheme === 'RAMA') {
      employerContributions.push({
        code: 'RSSB_MEDICAL_EMPLOYER',
        name: 'RSSB Medical Scheme (RAMA) Employer Contribution',
        rate: 0.075, // 7.5%
        base: roundPayroll(basicSalary),
        amount: healthEmployerMonthly,
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

    // taxableIncome = grossMonthly (no deductions reduce PAYE base)
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
 * Rwanda Payroll Due Date Constants
 * 
 * These constants are exported for UI to use for filing reminders.
 * Do not implement UI now; just export values.
 * 
 * Sources:
 * - PAYE remittance: https://taxsummaries.pwc.com/rwanda/individual/tax-administration
 * - RSSB medical scheme: https://www.rssb.rw/scheme/medical-scheme
 */
export const RWANDA_PAYROLL_DUE_DATES = {
  /** PAYE is due on the 15th of the following month */
  RW_PAYE_DUE_DAY: 15,
  /** RSSB contributions (pension, maternity, occupational hazards) are due on the 15th of the following month */
  RW_RSSB_DUE_DAY: 15,
  /** RSSB medical scheme (RAMA) is due on the 10th of the following month */
  RW_MEDICAL_DUE_DAY: 10,
} as const
