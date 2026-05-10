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
   * Ghana: non-residents use flat 25% on regular employment income and 20% on bonus/overtime slices (Phase 1A).
   */
  isResident?: boolean

  /**
   * Optional: Ghana — include employee/employer pension (5.5% / 13%) on insurable basic.
   * Default: true. Set false when staff are not pensionable (schema flag TODO).
   */
  isPensionable?: boolean

  /**
   * Optional: Ghana staff `employment_type` (e.g. full_time, part_time, casual).
   * casual → 5% flat on taxable income after employee pension (Phase 1A).
   */
  employmentCategory?: string | null

  /**
   * Optional: Ghana — bonus already paid earlier in same calendar year (approved/locked runs), in GHS.
   * Used for 15%-of-annual-basic concessional room. Default 0 when omitted from API.
   */
  priorBonusPaidInCalendarYear?: number

  /**
   * Optional: Ghana statutory junior overtime — qualifying annual employment income YTD (GHS).
   * Overtime concession applies only when ≤ 18,000 and junior heuristic is true.
   * TODO Phase 1B: compute from payroll history; when omitted, concession does not apply.
   */
  annualQualifyingEmploymentIncomeYtd?: number

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
   * Optional chart-of-accounts code hint for this deduction’s liability side.
   * Actual posting is driven by jurisdiction-specific SQL/RPC (e.g. Finza Ghana PAYE → 2230 in post_payroll_to_ledger), not by this field.
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
   * Optional expense account code hint (e.g. Ghana employer pension → 5610 in Finza’s post_payroll_to_ledger).
   * Not authoritative: posting may use different codes or split lines in SQL.
   */
  ledgerExpenseAccountCode: string | null

  /**
   * Optional liability account code hint when a single counterparty line applies.
   * May be null when liabilities are split in ledger posting (e.g. Ghana employer pension → 2231 + 2232 via payroll entry snapshots).
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
    /** Ghana — bonus taxed at 5% within concessional room (same value used internally; exposed for payroll_entries snapshot). */
    bonusConcessionalAmount?: number
    /** Ghana — bonus above concessional room (graduated slice); same as internal split, not a formula change. */
    bonusGraduatedAmount?: number
    bonusTax5: number
    bonusTaxGraduated: number
    overtimeThresholdAmount: number
    overtimeTax5: number
    overtimeTax10: number
    overtimeTaxGraduated: number
    graduatedPayeBase: number
    graduatedPayeAmount: number
    totalIncomeTax: number
    /** Ghana Phase 1A — bonus YTD used for concessional room */
    priorBonusPaidInCalendarYear?: number
    bonusConcessionalRoomBeforeRun?: number
    /** Ghana — junior overtime concession applied (needs income YTD from API) */
    juniorOvertimeConcessionApplies?: boolean
    /** Ghana — statutory junior overtime income ceiling check input */
    annualQualifyingEmploymentIncomeYtd?: number
    casualWorkerFlatTaxApplied?: boolean
    isResident?: boolean
    pensionable?: boolean
    ssnitBase?: number
    employeePensionContribution?: number
    employerPensionContribution?: number
    totalMandatoryPension?: number
    tier1SsnitRemittance?: number
    tier2PensionRemittance?: number
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
