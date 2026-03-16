/**
 * Carry-forward & Opening Balances
 * 
 * Core Principle: Closing a period does not move money.
 * It only freezes the ledger and defines the next period's opening position.
 * Carry-forward is a derived snapshot, not new "fake transactions" in the closed period.
 * 
 * What Gets Carried Forward:
 * - Balance Sheet accounts: Assets, Liabilities, Equity (carry forward)
 * - Income Statement accounts: Revenue, Expenses (reset to 0, net becomes Retained Earnings)
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type { AccountingPeriod } from './types'

export interface PeriodOpeningBalance {
  id: string
  period_id: string // UUID reference to accounting_periods.id (not TEXT period_id field)
  account_id: string
  business_id: string
  opening_balance: number
  created_at: string
}

// Note: This interface references period_opening_balances table which was DROPPED by migration 094.
// The RPC functions (compute_period_closing_balances, create_period_opening_balances) may not exist.
// These are legacy references - not part of Phase 1 alignment.

export interface AccountCarryForwardStatus {
  account_id: string
  opening_balance: number
  carried_forward: boolean // true for Balance Sheet, false for Income Statement
}

/**
 * Determine if an account type carries forward (Balance Sheet) or resets (Income Statement)
 */
export function accountCarriesForward(accountType: string): boolean {
  // Balance Sheet accounts carry forward
  if (['asset', 'liability', 'equity'].includes(accountType)) {
    return true
  }
  
  // Income Statement accounts reset
  if (['income', 'expense'].includes(accountType)) {
    return false
  }
  
  return false
}

/**
 * Compute and store closing balances when period moves to Closed
 * Called automatically when period status changes to 'closed'
 * Computes: ending_balance for all Balance Sheet accounts, net_income, retained_earnings_delta
 * All values are reproducible from the ledger at any time
 */
export async function computePeriodClosingBalances(
  supabase: SupabaseClient,
  periodId: string,
  businessId: string,
  periodStartDate: string,
  periodEndDate: string,
  retainedEarningsAccountCode: string = '3100'
): Promise<AccountCarryForwardStatus[]> {
  const { data, error } = await supabase.rpc('compute_period_closing_balances', {
    p_period_id: periodId,
    p_business_id: businessId,
    p_period_start_date: periodStartDate,
    p_period_end_date: periodEndDate,
    p_retained_earnings_account_code: retainedEarningsAccountCode,
  })

  if (error) {
    throw new Error(`Failed to compute closing balances: ${error.message}`)
  }

  return data || []
}

/**
 * Create opening balances for next period from prior period's ending balances
 * Called when the next period is created or opened
 * 
 * For Balance Sheet accounts: opening_balance = prior_period.ending_balance
 * For Retained Earnings: opening includes prior_period.net_income (already in ending_balance)
 * Income Statement accounts don't carry forward (opening_balance = 0)
 */
export async function createPeriodOpeningBalances(
  supabase: SupabaseClient,
  periodId: string,
  businessId: string,
  priorPeriodId: string
): Promise<AccountCarryForwardStatus[]> {
  const { data, error } = await supabase.rpc('create_period_opening_balances', {
    p_period_id: periodId,
    p_business_id: businessId,
    p_prior_period_id: priorPeriodId,
  })

  if (error) {
    throw new Error(`Failed to create opening balances: ${error.message}`)
  }

  return data || []
}

/**
 * Get opening balance for an account in a period
 * Returns 0 if no opening balance snapshot exists
 */
export async function getAccountOpeningBalance(
  supabase: SupabaseClient,
  periodId: string,
  accountId: string
): Promise<number> {
  const { data, error } = await supabase.rpc('get_account_opening_balance', {
    p_period_id: periodId,
    p_account_id: accountId,
  })

  if (error) {
    throw new Error(`Failed to get opening balance: ${error.message}`)
  }

  return data || 0
}

/**
 * Calculate account balance for a period including opening balance
 * This is the balance as of a date within the period, including the opening balance
 * from the period's opening balance snapshot
 */
export async function calculateAccountBalanceInPeriod(
  supabase: SupabaseClient,
  businessId: string,
  accountId: string,
  periodId: string,
  asOfDate: string
): Promise<number> {
  const { data, error } = await supabase.rpc('calculate_account_balance_in_period', {
    p_business_id: businessId,
    p_account_id: accountId,
    p_period_id: periodId,
    p_as_of_date: asOfDate,
  })

  if (error) {
    throw new Error(`Failed to calculate balance in period: ${error.message}`)
  }

  return data || 0
}

/**
 * Calculate net income/loss from Income Statement accounts for a period
 * Sum of Income - Sum of Expenses = Net Income (or Net Loss if negative)
 * This becomes the change to Retained Earnings
 */
export async function calculatePeriodNetIncome(
  supabase: SupabaseClient,
  businessId: string,
  periodStartDate: string,
  periodEndDate: string
): Promise<number> {
  const { data, error } = await supabase.rpc('calculate_period_net_income', {
    p_business_id: businessId,
    p_period_start_date: periodStartDate,
    p_period_end_date: periodEndDate,
  })

  if (error) {
    throw new Error(`Failed to calculate net income: ${error.message}`)
  }

  return data || 0
}

/**
 * Get all opening balances for a period
 */
export async function getPeriodOpeningBalances(
  supabase: SupabaseClient,
  periodId: string
): Promise<PeriodOpeningBalance[]> {
  const { data, error } = await supabase
    .from('period_opening_balances')
    .select('*')
    .eq('period_id', periodId)
    .order('created_at')

  if (error) {
    throw new Error(`Failed to get opening balances: ${error.message}`)
  }

  return data || []
}

/**
 * Get closing balances for a closed period
 */
export async function getPeriodClosingBalances(
  supabase: SupabaseClient,
  periodId: string
): Promise<Array<{
  account_id: string
  ending_balance: number
  computed_at: string
}>> {
  const { data, error } = await supabase
    .from('period_closing_balances')
    .select('account_id, ending_balance, computed_at')
    .eq('period_id', periodId)
    .order('computed_at')

  if (error) {
    throw new Error(`Failed to get closing balances: ${error.message}`)
  }

  return data || []
}

