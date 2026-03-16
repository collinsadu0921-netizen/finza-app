/**
 * Reconciliation engine interface. No implementation.
 * Use createReconciliationEngine from ./engine-impl to get an implementation.
 */

import type {
  ReconciliationScope,
  ReconciliationContext,
  ReconciliationResult,
  ReconciliationBatchResult,
} from "./types"

export interface ReconciliationEngine {
  /** Reconcile one invoice: ledger AR vs operational (invoice − payments − credits). */
  reconcileInvoice(
    scope: ReconciliationScope,
    context: ReconciliationContext
  ): Promise<ReconciliationResult>

  /** Reconcile one customer: sum of ledger AR vs sum of operational per-invoice balances. */
  reconcileCustomer(
    scope: ReconciliationScope,
    context: ReconciliationContext
  ): Promise<ReconciliationResult>

  /** Reconcile period: total AR from ledger vs total from operational in scope. */
  reconcilePeriod(
    scope: ReconciliationScope,
    context: ReconciliationContext
  ): Promise<ReconciliationResult>

  /** Run per-invoice and/or per-customer and/or period checks; return aggregated counts. */
  reconcileBatch(
    scope: ReconciliationScope,
    context: ReconciliationContext
  ): Promise<ReconciliationBatchResult>
}
