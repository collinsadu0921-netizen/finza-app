/**
 * Lightweight logger for reconciliation mismatches (READ-ONLY).
 * Logs when reconciliation.status !== OK. Does not block or mutate data.
 * Records: business_id, context, scope, expectedBalance, ledgerBalance, delta, status, timestamp.
 */

import type { ReconciliationResult } from "./types"
import { ReconciliationStatus } from "./types"

export type MismatchLogEntry = {
  business_id: string
  context: string
  scope: { invoiceId?: string; customerId?: string; periodId?: string }
  expectedBalance: number
  ledgerBalance: number
  delta: number | null
  status: string
  timestamp: string
}

/**
 * Log when status !== OK (including ERROR — engine failures are logged, not silenced).
 * ERROR results are excluded from mismatches list and dashboard; they are observable here.
 */
export function logReconciliationMismatch(result: ReconciliationResult): void {
  if (result.status === ReconciliationStatus.OK) return

  const entry: MismatchLogEntry = {
    business_id: result.scope.businessId,
    context: result.context,
    scope: {
      invoiceId: result.scope.invoiceId,
      customerId: result.scope.customerId,
      periodId: result.scope.periodId,
    },
    expectedBalance: result.expectedBalance,
    ledgerBalance: result.ledgerBalance,
    delta: result.delta,
    status: result.status,
    timestamp: new Date().toISOString(),
  }

  console.warn("[reconciliation-mismatch]", JSON.stringify(entry))
}
