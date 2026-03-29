/**
 * Payroll Engine Types
 * 
 * Authority: This module defines the contract for all payroll calculation engines.
 * All country-specific payroll plugins MUST implement PayrollEngine interface.
 */

/**
 * Payroll calculation configuration
 */
export interface PayrollEngineConfig {
  /**
   * ISO 3166-1 alpha-2 country code (e.g., "GH", "KE")
   */
  jurisdiction: string

  /**
   * Effective date for payroll calculation (ISO string YYYY-MM-DD)
   * Used to determine which version of tax/contribution rates to apply
   * Defaults to payroll_month if not provided
   */
  effectiveDate: string

  /**
   * Basic salary amount (before allowances)
   */
  basicSalary: number

  /**
   * Total recurring allowances (transport, housing, etc.)
   */
  allowances: number

  /**
   * Total recurring deductions (loans, advances, etc.)
   * Excludes statutory deductions (SSNIT, PAYE) which are calculated separately
   */
  otherDeductions: number

  /**
   * Optional: One-off/variable bonus for this payroll period
   * (Ghana-specific tax treatment supported by GH engine)
   * Default: 0
   */
  bonusAmount?: number

  /**
   * Optional: Overtime earnings for this payroll period
   * (Ghana-specific tax treatment supported by GH engine)
   * Default: 0
   */
  overtimeAmount?: number

  /**
   * Optional: Whether staff qualifies as junior employee for overtime concession
   * (Ghana-specific tax treatment supported by GH engine)
   * Default: false
   */
  isQualifyingJuniorEmployee?: boolean

  /**
   * Optional: Portion of allowances that is transport allowance
   * Used for base split calculations (e.g., Rwanda maternity excludes transport)
   * Default: 0
   */
  transportAllowance?: number

  /**
   * Optional: Health scheme selection
   * Default: 'CBHI' (Community Based Health Insurance)
   */
  healthScheme?: 'CBHI' | 'RAMA'

  /**
   * Optional: Whether employee is resident for tax purposes
   * Default: true
   * Note: Currently does not affect PAYE rates (same rates apply per PwC guidance)
   */
  isResident?: boolean

  /**
   * Optional: NHIMA base selection (Zambia)
   * Default: 'basic' (NHIMA calculated on basic salary only)
   * 'gross' option allows NHIMA on gross salary (basic + allowances)
   */
  nhimaBase?: 'basic' | 'gross'

  /**
   * Optional: WCFCB (Workers Compensation Fund) employer rate (Zambia)
   * Default: 0 (must be explicitly set for audit-ready compliance)
   * Rate depends on risk classification; must be configured per employer
   */
  wcfcRate?: number

  /**
   * Optional: WCFCB risk class label (Zambia)
   * Default: '' (empty string)
   * Used for audit notes/documentation only
   */
  wcfcRiskClass?: string
}

/**
 * Earnings breakdown
 */
export interface Earnings {
  /**
   * Basic salary (before allowances)
   */
  basicSalary: number

  /**
   * Total allowances (recurring only)
   */
  allowances: number

  /**
   * Gross salary (basicSalary + allowances)
   */
  grossSalary: number
}

/**
 * Statutory deduction (PAYE, SSNIT employee, etc.)
 */
export interface StatutoryDeduction {
  /**
   * Deduction code (e.g., "PAYE", "SSNIT_EMPLOYEE")
   */
  code: string

  /**
   * Human-readable name (e.g., "PAYE", "SSNIT Employee Contribution")
   */
  name: string

  /**
   * Rate (percentage as decimal, e.g., 0.055 for 5.5%)
   */
  rate: number

  /**
   * Base amount on which deduction is calculated
   */
  base: number

  /**
   * Deduction amount
   */
  amount: number

  /**
   * Ledger account code for liability (e.g., "2210" for PAYE)
   */
  ledgerAccountCode: string | null

  /**
   * Whether this deduction reduces taxable income
   */
  isTaxDeductible: boolean
}

/**
 * Employer contribution (SSNIT employer, etc.)
 */
export interface EmployerContribution {
  /**
   * Contribution code (e.g., "SSNIT_EMPLOYER")
   */
  code: string

  /**
   * Human-readable name (e.g., "SSNIT Employer Contribution")
   */
  name: string

  /**
   * Rate (percentage as decimal, e.g., 0.13 for 13%)
   */
  rate: number

  /**
   * Base amount on which contribution is calculated
   */
  base: number

  /**
   * Contribution amount (expense to employer, not deducted from employee)
   */
  amount: number

  /**
   * Ledger account code for expense (e.g., "6010" for Employer SSNIT)
   */
  ledgerExpenseAccountCode: string | null

  /**
   * Ledger account code for liability (e.g., "2230" for SSNIT Employer Payable)
   */
  ledgerLiabilityAccountCode: string | null
}

/**
 * Payroll calculation result
 */
export interface PayrollCalculationResult {
  /**
   * Earnings breakdown
   */
  earnings: Earnings

  /**
   * Statutory deductions (PAYE, SSNIT employee, etc.)
   */
  statutoryDeductions: StatutoryDeduction[]

  /**
   * Other deductions (loans, advances, penalties)
   * These are not calculated by the engine, but passed through from config
   */
  otherDeductions: number

  /**
   * Employer contributions (SSNIT employer, etc.)
   * These are expenses to the employer, not deducted from employee
   */
  employerContributions: EmployerContribution[]

  /**
   * Totals summary
   */
  totals: {
    /**
     * Gross salary (basicSalary + allowances)
     */
    grossSalary: number

    /**
     * Total statutory deductions
     */
    totalStatutoryDeductions: number

    /**
     * Total other deductions
     */
    totalOtherDeductions: number

    /**
     * Taxable income (grossSalary - tax-deductible statutory deductions)
     */
    taxableIncome: number

    /**
     * Net salary (taxableIncome - PAYE - otherDeductions)
     */
    netSalary: number

    /**
     * Total employer contributions (expense to employer)
     */
    totalEmployerContributions: number
  }

  /**
   * Optional component-level compliance breakdown for jurisdictions
   * that require explicit tax bucket disclosures (e.g., Ghana bonus/overtime).
   */
  complianceBreakdown?: {
    bonusAmount: number
    overtimeAmount: number
    regularAllowancesAmount: number
    isQualifyingJuniorEmployee: boolean
    bonusCapAmount: number
    bonusTax5: number
    bonusTaxGraduated: number
    overtimeThresholdAmount: number
    overtimeTax5: number
    overtimeTax10: number
    overtimeTaxGraduated: number
    graduatedPayeBase: number
    graduatedPayeAmount: number
    totalIncomeTax: number
  }
}

/**
 * Payroll Engine Interface
 * 
 * All country-specific payroll plugins MUST implement this interface.
 */
export interface PayrollEngine {
  /**
   * Calculate payroll for a single employee
   * 
   * @param config Payroll calculation configuration
   * @returns Payroll calculation result with earnings, deductions, and totals
   */
  calculate(config: PayrollEngineConfig): PayrollCalculationResult
}
