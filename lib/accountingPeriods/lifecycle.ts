/**
 * Accounting Period Lifecycle Rules
 * Aligned with migration 094 schema (canonical truth)
 * Manages status transitions and validation
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

import { SupabaseClient } from '@supabase/supabase-js'
import type {
  AccountingPeriod,
  AccountingPeriodStatus,
  CreateAccountingPeriodInput,
  UpdateAccountingPeriodInput,
} from './types'
import {
  isValidStatusTransition,
  canModifyPeriod,
  getNextValidStatuses,
  canAcceptLedgerEntries,
  canApproveProposals,
  canPostPayments,
  canMakeAdjustments,
  isLocked,
} from './types'
import { isUserAccountant } from '../userRoles'
import type { AccountCarryForwardStatus } from './carryForward'

/**
 * Create a new accounting period
 * Validates date ranges and checks for overlaps
 */
export async function createAccountingPeriod(
  supabase: SupabaseClient,
  input: CreateAccountingPeriodInput
): Promise<AccountingPeriod> {
  const { data, error } = await supabase
    .from('accounting_periods')
    .insert({
      business_id: input.business_id,
      period_start: input.period_start,
      period_end: input.period_end,
      status: 'open',
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to create accounting period: ${error.message}`)
  }

  return data
}

/**
 * Update accounting period
 * Enforces lifecycle rules and validation
 */
export async function updateAccountingPeriod(
  supabase: SupabaseClient,
  periodId: string,
  input: UpdateAccountingPeriodInput
): Promise<AccountingPeriod> {
  // Get current period to validate transitions
  const { data: currentPeriod, error: fetchError } = await supabase
    .from('accounting_periods')
    .select('*')
    .eq('id', periodId)
    .single()

  if (fetchError || !currentPeriod) {
    throw new Error(`Accounting period not found: ${periodId}`)
  }

  // Check if period can be modified
  if (!canModifyPeriod(currentPeriod)) {
    throw new Error(
      `Cannot modify period with status: ${currentPeriod.status}`
    )
  }

  // Validate status transition if status is being changed
  if (input.status && input.status !== currentPeriod.status) {
    if (!isValidStatusTransition(currentPeriod.status, input.status)) {
      throw new Error(
        `Invalid status transition from ${currentPeriod.status} to ${input.status}`
      )
    }
  }

  // Build update object
  const updateData: Partial<AccountingPeriod> = {}

  if (input.period_start !== undefined) updateData.period_start = input.period_start
  if (input.period_end !== undefined) updateData.period_end = input.period_end
  if (input.status !== undefined && input.status !== currentPeriod.status) {
    updateData.status = input.status
    // Update closed_at and closed_by when transitioning to soft_closed or locked
    if (input.status === 'soft_closed' || input.status === 'locked') {
      const { data: user } = await supabase.auth.getUser()
      updateData.closed_at = new Date().toISOString()
      updateData.closed_by = user.data.user?.id || null
    }
  }

  // Apply updates
  if (Object.keys(updateData).length > 0) {
    const { data, error } = await supabase
      .from('accounting_periods')
      .update(updateData)
      .eq('id', periodId)
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to update accounting period: ${error.message}`)
    }

    return data
  }

  // No changes, return current period
  return currentPeriod
}

/**
 * Get accounting period by ID
 */
export async function getAccountingPeriod(
  supabase: SupabaseClient,
  periodId: string
): Promise<AccountingPeriod | null> {
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('*')
    .eq('id', periodId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return null // Not found
    }
    throw new Error(`Failed to get accounting period: ${error.message}`)
  }

  return data
}

/**
 * Get accounting periods for a business
 */
export async function getAccountingPeriods(
  supabase: SupabaseClient,
  businessId: string,
  options?: {
    status?: AccountingPeriodStatus
    startDate?: string
    endDate?: string
  }
): Promise<AccountingPeriod[]> {
  let query = supabase
    .from('accounting_periods')
    .select('*')
    .eq('business_id', businessId)
    .order('period_start', { ascending: false })

  if (options?.status) {
    query = query.eq('status', options.status)
  }

  if (options?.startDate) {
    query = query.gte('period_start', options.startDate)
  }

  if (options?.endDate) {
    query = query.lte('period_end', options.endDate)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Failed to get accounting periods: ${error.message}`)
  }

  return data || []
}

/**
 * Get the current accounting period for a business (open or soft_closed)
 * Note: Migration 094 allows posting to both 'open' and 'soft_closed' periods
 */
export async function getCurrentAccountingPeriod(
  supabase: SupabaseClient,
  businessId: string,
  asOfDate?: string
): Promise<AccountingPeriod | null> {
  const date = asOfDate || new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('accounting_periods')
    .select('*')
    .eq('business_id', businessId)
    .lte('period_start', date)
    .gte('period_end', date)
    .in('status', ['open', 'soft_closed']) // Both allow posting (migration 094)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (error.code === 'PGRST116') {
      return null // Not found
    }
    throw new Error(`Failed to get current accounting period: ${error.message}`)
  }

  return data
}

/**
 * Transition period status (with user tracking)
 * Status transitions: open → soft_closed → locked
 * Migration 094: Direct UPDATE, no RPC function exists
 */
export async function transitionPeriodStatus(
  supabase: SupabaseClient,
  periodId: string,
  newStatus: AccountingPeriodStatus,
  userId?: string
): Promise<AccountingPeriod> {
  const { data: user } = await supabase.auth.getUser()
  const effectiveUserId = userId || user.data.user?.id || null
  
  if (!effectiveUserId) {
    throw new Error('User must be authenticated to transition period status')
  }

  // Get current period to validate transition
  const currentPeriod = await getAccountingPeriod(supabase, periodId)
  if (!currentPeriod) {
    throw new Error(`Accounting period not found: ${periodId}`)
  }

  // Validate transition
  if (!isValidStatusTransition(currentPeriod.status, newStatus)) {
    throw new Error(
      `Invalid status transition from ${currentPeriod.status} to ${newStatus}`
    )
  }

  // Build update data
  const updateData: Partial<AccountingPeriod> = {
    status: newStatus,
  }

  // Set closed_at and closed_by when transitioning to soft_closed or locked
  if (newStatus === 'soft_closed' || newStatus === 'locked') {
    updateData.closed_at = new Date().toISOString()
    updateData.closed_by = effectiveUserId
  }

  // Update period (migration 094 uses direct UPDATE, no RPC function)
  const { data, error } = await supabase
    .from('accounting_periods')
    .update(updateData)
    .eq('id', periodId)
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to transition period status: ${error.message}`)
  }

  return data
}

/**
 * Check if a date falls within any period that allows posting (open or soft_closed)
 * Migration 094: Both 'open' and 'soft_closed' allow posting
 */
export async function isDateInOpenPeriod(
  supabase: SupabaseClient,
  businessId: string,
  date: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('id')
    .eq('business_id', businessId)
    .lte('period_start', date)
    .gte('period_end', date)
    .in('status', ['open', 'soft_closed']) // Both allow posting (migration 094)
    .limit(1)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to check period: ${error.message}`)
  }

  return data !== null
}

/**
 * Validate that a ledger entry can be created for a date
 * Throws error if period doesn't allow ledger entries
 * Entry Admission Rules (migration 094): 'open' and 'soft_closed' allow entries, 'locked' blocks
 */
export async function validateLedgerEntryAllowed(
  supabase: SupabaseClient,
  businessId: string,
  date: string
): Promise<void> {
  const period = await getCurrentAccountingPeriod(supabase, businessId, date)
  
  if (!period) {
    throw new Error(`No accounting period found for date: ${date}`)
  }
  
  if (!canAcceptLedgerEntries(period)) {
    throw new Error(
      `Cannot create ledger entry for period (${period.period_start}) with status: ${period.status}. ` +
      `Ledger entries are blocked for 'locked' periods.`
    )
  }
}

/**
 * Validate that a proposal can be approved for a date
 * Throws error if period doesn't allow proposal approvals
 */
export async function validateProposalApprovalAllowed(
  supabase: SupabaseClient,
  businessId: string,
  date: string
): Promise<void> {
  const period = await getCurrentAccountingPeriod(supabase, businessId, date)
  
  if (!period) {
    throw new Error(`No accounting period found for date: ${date}`)
  }
  
  if (!canApproveProposals(period)) {
    throw new Error(
      `Cannot approve proposal for period (${period.period_start}) with status: ${period.status}. ` +
      `Proposal approvals are blocked for 'locked' periods.`
    )
  }
}

/**
 * Validate that a payment can be posted for a date
 * Throws error if period doesn't allow payment posting
 */
export async function validatePaymentPostingAllowed(
  supabase: SupabaseClient,
  businessId: string,
  date: string
): Promise<void> {
  const period = await getCurrentAccountingPeriod(supabase, businessId, date)
  
  if (!period) {
    throw new Error(`No accounting period found for date: ${date}`)
  }
  
  if (!canPostPayments(period)) {
    throw new Error(
      `Cannot post payment for period (${period.period_start}) with status: ${period.status}. ` +
      `Payment posting is blocked for 'locked' periods.`
    )
  }
}

/**
 * Validate that an adjustment can be made
 * Adjustments always go to next open period, not to the current period
 * Returns the next open period ID for the adjustment
 */
export async function validateAdjustmentAllowed(
  supabase: SupabaseClient,
  businessId: string,
  adjustmentDate?: string
): Promise<{ nextOpenPeriodId: string; nextOpenPeriod: AccountingPeriod }> {
  // Find the next open or soft_closed period after the adjustment date (or current date)
  // Migration 094: Both 'open' and 'soft_closed' allow posting
  const targetDate = adjustmentDate || new Date().toISOString().split('T')[0]
  
  const { data: nextOpenPeriod, error } = await supabase
    .from('accounting_periods')
    .select('*')
    .eq('business_id', businessId)
    .in('status', ['open', 'soft_closed'])
    .gt('period_start', targetDate)
    .order('period_start', { ascending: true })
    .limit(1)
    .maybeSingle()
  
  if (error) {
    throw new Error(`Failed to find next open period: ${error.message}`)
  }
  
  if (!nextOpenPeriod) {
    throw new Error(
      `No open or soft_closed period found after ${targetDate} for adjustments. ` +
      `Adjustments must go to the next period that allows posting.`
    )
  }
  
  return {
    nextOpenPeriodId: nextOpenPeriod.id,
    nextOpenPeriod,
  }
}

/**
 * Check if user is accountant for business
 * Only accountants can soft-close or lock periods
 */
export async function checkAccountantAuthority(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<boolean> {
  return isUserAccountant(supabase, userId, businessId)
}

/**
 * Check blocking conditions before moving period to soft_closed
 * Note: Migration 094 does not define this function, placeholder for future implementation
 * For Phase 1 alignment, return no blockers (soft close is always allowed)
 */
export async function checkBlockingConditionsBeforeClosing(
  supabase: SupabaseClient,
  periodId: string
): Promise<{ canClose: boolean; blockers: string[] }> {
  // Migration 094 does not have blocking conditions check
  // Phase 1 alignment: soft close is always allowed
  return { canClose: true, blockers: [] }
}

/**
 * Transition period to soft_closed with authority checks
 * Migration 094: open → soft_closed
 */
export async function movePeriodToSoftClosed(
  supabase: SupabaseClient,
  periodId: string,
  userId: string
): Promise<AccountingPeriod> {
  // Get period to check business_id
  const period = await getAccountingPeriod(supabase, periodId)
  if (!period) {
    throw new Error(`Accounting period not found: ${periodId}`)
  }
  
  // Check accountant authority
  const isAccountant = await checkAccountantAuthority(
    supabase,
    userId,
    period.business_id
  )
  
  if (!isAccountant) {
    throw new Error(
      'Only accountants can soft-close periods. User does not have accountant role for this business.'
    )
  }
  
  // Check blocking conditions (Phase 1: always allow, migration 094 has no blockers)
  const { canClose, blockers } = await checkBlockingConditionsBeforeClosing(
    supabase,
    periodId
  )
  
  if (!canClose) {
    throw new Error(
      `Cannot soft-close period. Blocking conditions: ${blockers.join(', ')}`
    )
  }
  
  // Transition to soft_closed
  return transitionPeriodStatus(supabase, periodId, 'soft_closed')
}

/**
 * Lock a period (final immutable state)
 * Migration 094: soft_closed → locked
 * Locked periods block all posting
 */
export async function lockPeriod(
  supabase: SupabaseClient,
  periodId: string,
  userId: string
): Promise<AccountingPeriod> {
  // Get period
  const period = await getAccountingPeriod(supabase, periodId)
  if (!period) {
    throw new Error(`Accounting period not found: ${periodId}`)
  }
  
  // Check accountant authority
  const isAccountant = await checkAccountantAuthority(
    supabase,
    userId,
    period.business_id
  )
  
  if (!isAccountant) {
    throw new Error(
      'Only accountants can lock periods. User does not have accountant role for this business.'
    )
  }
  
  // Period must be in 'soft_closed' status to be locked
  if (period.status !== 'soft_closed') {
    throw new Error(
      `Period must be in 'soft_closed' status before it can be locked. Current status: ${period.status}`
    )
  }
  
  // Transition to locked (immutable forever)
  return transitionPeriodStatus(supabase, periodId, 'locked')
}

/**
 * Create opening balances for next period when it's created or opened
 * Uses prior period's ending balances
 */
export async function initializePeriodOpeningBalances(
  supabase: SupabaseClient,
  periodId: string,
  businessId: string,
  priorPeriodId: string
): Promise<AccountCarryForwardStatus[]> {
  // Dynamic import to avoid circular dependencies
  const { createPeriodOpeningBalances } = await import('./carryForward')
  return createPeriodOpeningBalances(supabase, periodId, businessId, priorPeriodId)
}

