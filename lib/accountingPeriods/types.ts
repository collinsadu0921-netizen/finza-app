/**
 * Accounting Period Types
 * Aligned with migration 094 schema (canonical truth)
 * Periods are identified by (business_id, period_start)
 * 
 * Period States (Canonical - migration 094):
 * 
 * 🟢 Open
 * - New ledger entries allowed
 * - Payments can be posted
 * 
 * 🟡 Soft Closed
 * - Ledger entries still allowed (soft close allows posting)
 * - Period is closed but not locked yet
 * 
 * 🔴 Locked
 * - Immutable forever
 * - Ledger posting is BLOCKED
 * - Used for tax filings and final reporting
 * - Can never be reopened
 */

export type AccountingPeriodStatus = 'open' | 'soft_closed' | 'locked'

export interface AccountingPeriod {
  id: string
  business_id: string
  period_start: string // ISO date string (YYYY-MM-DD) - first day of month
  period_end: string // ISO date string (YYYY-MM-DD) - last day of same month
  status: AccountingPeriodStatus
  closed_at: string | null // ISO timestamp - set when soft_closed or locked
  closed_by: string | null // User ID - set when soft_closed or locked
  created_at: string // ISO timestamp
}

export interface CreateAccountingPeriodInput {
  business_id: string
  period_start: string // ISO date string (YYYY-MM-DD) - first day of month
  period_end: string // ISO date string (YYYY-MM-DD) - last day of same month
}

export interface UpdateAccountingPeriodInput {
  period_start?: string
  period_end?: string
  status?: AccountingPeriodStatus
}

/**
 * Lifecycle status transition rules (ONLY FORWARD):
 * 
 * open → soft_closed → locked
 * 
 * No backward transitions. Ever.
 */
export const PERIOD_STATUS_TRANSITIONS: Record<
  AccountingPeriodStatus,
  AccountingPeriodStatus[]
> = {
  open: ['soft_closed'], // Only can go to soft_closed
  soft_closed: ['locked'], // Only can go to locked
  locked: [], // Final state - immutable forever
}

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  from: AccountingPeriodStatus,
  to: AccountingPeriodStatus
): boolean {
  return PERIOD_STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Check if period can be modified (not locked)
 */
export function canModifyPeriod(period: AccountingPeriod): boolean {
  return period.status !== 'locked'
}

/**
 * Entry Admission Rules (aligned with migration 094):
 * 
 * Period Status | New Ledger Entries | Payments
 * Open          | ✅                  | ✅
 * Soft Closed   | ✅                  | ✅ (soft close allows posting)
 * Locked        | ❌                  | ❌ (immutable, blocked)
 * 
 * Only 'locked' status blocks posting (migration 094 assert_accounting_period_is_open)
 */

/**
 * Check if period can accept new ledger entries
 * ✅ Open: Yes
 * ✅ Soft Closed: Yes (soft close allows posting)
 * ❌ Locked: No (immutable, blocked)
 */
export function canAcceptLedgerEntries(period: AccountingPeriod): boolean {
  return period.status !== 'locked'
}

/**
 * Check if period can approve new proposals
 * ✅ Open: Yes
 * ✅ Soft Closed: Yes
 * ❌ Locked: No (immutable)
 */
export function canApproveProposals(period: AccountingPeriod): boolean {
  return period.status !== 'locked'
}

/**
 * Check if period can post payments
 * ✅ Open: Yes
 * ✅ Soft Closed: Yes (soft close allows posting)
 * ❌ Locked: No (immutable, blocked)
 */
export function canPostPayments(period: AccountingPeriod): boolean {
  return period.status !== 'locked'
}

/**
 * Check if period allows adjustments
 * ❌ ALL: Adjustments are NOT allowed in any period
 * Adjustments always go to next open period.
 */
export function canMakeAdjustments(period: AccountingPeriod): boolean {
  return false // Adjustments always go to next open period, not to current period
}

/**
 * Check if period is soft closed (allows posting but marked as closed)
 */
export function isSoftClosed(period: AccountingPeriod): boolean {
  return period.status === 'soft_closed'
}

/**
 * Check if period is locked (immutable forever, used for tax filings)
 */
export function isLocked(period: AccountingPeriod): boolean {
  return period.status === 'locked'
}

/**
 * Check if period can accept transactions (open or closing)
 * @deprecated Use specific functions: canAcceptLedgerEntries, canApproveProposals, canPostPayments
 */
export function canAcceptTransactions(period: AccountingPeriod): boolean {
  return canAcceptLedgerEntries(period)
}

/**
 * Get the next valid statuses for a period
 */
export function getNextValidStatuses(
  currentStatus: AccountingPeriodStatus
): AccountingPeriodStatus[] {
  return PERIOD_STATUS_TRANSITIONS[currentStatus]
}

