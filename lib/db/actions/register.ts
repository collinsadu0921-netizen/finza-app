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

function parsePaymentLines(raw: unknown): Array<{ method?: string; amount?: number }> {
  if (!raw) return []
  let arr: unknown[] = []
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) arr = p
    } catch {
      return []
    }
  } else if (Array.isArray(raw)) {
    arr = raw
  }
  return arr.map((row) => row as { method?: string; amount?: number })
}

/** Cash tender from `payment_lines` when legacy rows omit cash_amount / cash_received */
function cashTenderFromPaymentLines(raw: unknown): number {
  return parsePaymentLines(raw).reduce((sum, row) => {
    const m = String(row.method ?? "")
      .trim()
      .toLowerCase()
    if (m !== "cash" && m !== "cash_tender") return sum
    const amt = Number(row.amount ?? 0)
    return sum + (Number.isFinite(amt) ? amt : 0)
  }, 0)
}

/**
 * Net physical cash movement for one sale row (paid sales only).
 * Prefers cash_received − change_given; falls back to cash_amount / payment_lines.
 */
function netCashDrawerDeltaFromSale(sale: Record<string, unknown>): number {
  const changeGiven = Number(sale.change_given ?? 0) || 0
  const crRaw = sale.cash_received
  if (crRaw != null && crRaw !== "") {
    const cr = Number(crRaw)
    if (Number.isFinite(cr)) return cr - changeGiven
  }
  const ca = Number(sale.cash_amount ?? 0) || 0
  if (ca > 0 || changeGiven > 0) return ca - changeGiven
  const fromLines = cashTenderFromPaymentLines(sale.payment_lines)
  return fromLines - changeGiven
}

/**
 * Expected cash in the drawer for one cashier session (operational, not business-wide ledger).
 *
 * opening_float (or opening_cash) + net cash from paid sales for this session
 * − cash removed via cash_drops for this session.
 *
 * This must not use the global Cash (1000) ledger balance — that mixes all registers/sessions
 * and repeats the same “expected” after a prior close.
 */
export async function calculateExpectedCash(
  supabase: SupabaseClient,
  sessionId: string
): Promise<number> {
  const { data: session, error: sessionError } = await supabase
    .from("cashier_sessions")
    .select("opening_float, opening_cash")
    .eq("id", sessionId)
    .single()

  if (sessionError || !session) {
    throw new Error("Session not found")
  }

  const of = session.opening_float
  const opening =
    of !== null && of !== undefined && !Number.isNaN(Number(of))
      ? Number(of)
      : Number((session as { opening_cash?: unknown }).opening_cash ?? 0) || 0

  const { data: sales, error: salesError } = await supabase
    .from("sales")
    .select("cash_received, cash_amount, change_given, payment_lines, payment_status")
    .eq("cashier_session_id", sessionId)
    .eq("payment_status", "paid")

  if (salesError) {
    console.error("calculateExpectedCash sales query:", salesError)
  }

  let netFromSales = 0
  for (const row of sales || []) {
    netFromSales += netCashDrawerDeltaFromSale(row as Record<string, unknown>)
  }

  const { data: drops, error: dropsError } = await supabase
    .from("cash_drops")
    .select("amount")
    .eq("session_id", sessionId)

  if (dropsError) {
    console.error("calculateExpectedCash cash_drops query:", dropsError)
  }

  const dropTotal = (drops || []).reduce((sum, d) => sum + Number((d as { amount?: unknown }).amount || 0), 0)

  const expected = opening + netFromSales - dropTotal
  if (!Number.isFinite(expected)) {
    return opening
  }
  return expected
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
