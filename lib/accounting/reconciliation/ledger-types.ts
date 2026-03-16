/**
 * Data shapes for ledger-derived balances.
 * No SQL, no RPCs, no fetch logic. DATA SHAPE ONLY.
 */

export interface LedgerBalanceByInvoice {
  invoiceId: string
  ledgerBalance: number
}

export interface LedgerBalanceByCustomer {
  customerId: string
  ledgerBalance: number
}

export interface LedgerBalanceForPeriod {
  periodId: string
  ledgerBalance: number
}

export interface LedgerBalanceReadResult {
  byInvoice?: LedgerBalanceByInvoice[]
  byCustomer?: LedgerBalanceByCustomer[]
  periodTotal?: LedgerBalanceForPeriod
}

export interface LedgerReadContext {
  businessId: string
  periodId?: string
  invoiceId?: string
  customerId?: string
}
