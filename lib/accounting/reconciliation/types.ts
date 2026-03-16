/**
 * Reconciliation engine interface contract.
 * Types only — no implementation, no DB calls.
 */

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export interface ReconciliationScope {
  businessId: string
  periodId?: string
  invoiceId?: string
  customerId?: string
}

// ---------------------------------------------------------------------------
// Context (determines tolerance)
// ---------------------------------------------------------------------------

export enum ReconciliationContext {
  /** Display / soft checks — tolerance 0.01 */
  DISPLAY = "DISPLAY",
  /** Validation / blocking (payments, credits, mark-paid) — tolerance 0 */
  VALIDATE = "VALIDATE",
  /** Period close — tolerance 0 */
  PERIOD_CLOSE = "PERIOD_CLOSE",
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export enum ReconciliationStatus {
  OK = "OK",
  WARN = "WARN",
  FAIL = "FAIL",
  /** Engine/system failure; not an accounting mismatch. Excluded from mismatches list and dashboard. */
  ERROR = "ERROR",
}

// ---------------------------------------------------------------------------
// Single result
// ---------------------------------------------------------------------------

export interface ReconciliationResult {
  scope: ReconciliationScope
  context: ReconciliationContext
  expectedBalance: number
  ledgerBalance: number
  /** Null only when status === ERROR (engine failure; delta was never computed). */
  delta: number | null
  tolerance: number
  status: ReconciliationStatus
  /** Human-readable reasons (e.g. why WARN/FAIL/ERROR) */
  notes?: string[]
}

// ---------------------------------------------------------------------------
// Batch result
// ---------------------------------------------------------------------------

export interface ReconciliationBatchResult {
  results: ReconciliationResult[]
  okCount: number
  warnCount: number
  failCount: number
}
