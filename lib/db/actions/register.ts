import { SupabaseClient } from "@supabase/supabase-js"

export interface RegisterVariance {
  id: string
  register_id: string
  session_id: string
  user_id: string
  supervisor_id: string | null
  expected: number
  counted: number
  difference: number
  note: string | null
  created_at: string
}

export interface CashierSession {
  id: string
  register_id: string
  user_id: string
  business_id: string
  opening_float: number
  closing_amount: number | null
  closing_cash: number | null
  opening_cash: number
  status: "open" | "closed"
  started_at: string
  ended_at: string | null
}

/**
 * Calculate expected cash for a cashier session
 * LEDGER-BASED: Expected cash = Cash account (1000) ledger balance
 */
export async function calculateExpectedCash(
  supabase: SupabaseClient,
  sessionId: string
): Promise<number> {
  // Get session to find business_id
  const { data: session, error: sessionError } = await supabase
    .from("cashier_sessions")
    .select("business_id, opening_float")
    .eq("id", sessionId)
    .single()

  if (sessionError || !session) {
    throw new Error("Session not found")
  }

  const businessId = session.business_id
  if (!businessId) {
    throw new Error("Business ID not found for session")
  }

  // LEDGER-BASED: Get Cash account (account_code '1000')
  const { data: cashAccount } = await supabase
    .from("accounts")
    .select("id")
    .eq("business_id", businessId)
    .eq("code", "1000")
    .is("deleted_at", null)
    .single()

  if (!cashAccount) {
    // Fallback to opening float if cash account not found
    return Number(session.opening_float || 0)
  }

  // Calculate Cash account balance: SUM(debit) - SUM(credit) for asset account
  const { data: cashLines } = await supabase
    .from("journal_entry_lines")
    .select(
      `
      debit,
      credit,
      journal_entries!inner (
        business_id
      )
    `
    )
    .eq("account_id", cashAccount.id)
    .eq("journal_entries.business_id", businessId)

  if (!cashLines) {
    // Fallback to opening float if no ledger entries
    return Number(session.opening_float || 0)
  }

  // For asset accounts: balance = debit - credit
  const cashBalance = cashLines.reduce(
    (sum: number, line: any) => sum + Number(line.debit || 0) - Number(line.credit || 0),
    0
  )

  // Ensure we return a valid number
  if (isNaN(cashBalance) || !isFinite(cashBalance)) {
    return Number(session.opening_float || 0) // Fallback to opening float if calculation fails
  }
  
  return Math.max(0, cashBalance)
}

/**
 * Get register variance by session ID
 */
export async function getRegisterVariance(
  supabase: SupabaseClient,
  sessionId: string
): Promise<RegisterVariance | null> {
  const { data, error } = await supabase
    .from("register_variances")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle()

  if (error) throw error
  return data as RegisterVariance | null
}

/**
 * Create a register variance record
 */
export async function createRegisterVariance(
  supabase: SupabaseClient,
  variance: {
    register_id: string
    session_id: string
    user_id: string
    supervisor_id: string | null
    expected: number
    counted: number
    difference: number
    note?: string
  }
): Promise<RegisterVariance> {
  const { data, error } = await supabase
    .from("register_variances")
    .insert(variance)
    .select()
    .single()

  if (error) throw error
  return data as RegisterVariance
}


