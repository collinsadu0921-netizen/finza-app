/**
 * Data shapes for balances derived from operational tables
 * (invoices, payments, credit_notes). DATA SHAPE ONLY.
 */

export interface ExpectedBalanceByInvoice {
  invoiceId: string
  expectedBalance: number
}

export interface ExpectedBalanceByCustomer {
  customerId: string
  expectedBalance: number
}

export interface ExpectedBalanceForPeriod {
  periodId: string
  expectedBalance: number
}

export interface ExpectedBalanceReadResult {
  byInvoice?: ExpectedBalanceByInvoice[]
  byCustomer?: ExpectedBalanceByCustomer[]
  periodTotal?: ExpectedBalanceForPeriod
}
