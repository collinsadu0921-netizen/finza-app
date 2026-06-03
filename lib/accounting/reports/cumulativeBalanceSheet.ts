/**
 * Cumulative balance-sheet positions and ledger rows (je.date <= as_of_date).
 * Used by Financial Overview and canonical Balance Sheet report (Phase 2H).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export const CASH_ACCOUNT_CODES = ["1000", "1010", "1020", "1030"] as const
export const AR_ACCOUNT_CODE = "1100"
const CASH_CODE_SET = new Set<string>(CASH_ACCOUNT_CODES)

export type CumulativeBsRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  balance?: number
}

export type FinancialOverviewPositions = {
  cashBalance: number
  accountsReceivable: number
  accountsPayable: number
  asOfDate: string
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

export function extractCashFromCumulativeRows(rows: CumulativeBsRow[]): number {
  let sum = 0
  for (const row of rows) {
    const code = String(row.account_code ?? "").trim()
    if (CASH_CODE_SET.has(code)) sum += Number(row.balance ?? 0)
  }
  return roundMoney(sum)
}

export function extractARFromCumulativeRows(rows: CumulativeBsRow[]): number {
  for (const row of rows) {
    if (String(row.account_code ?? "").trim() === AR_ACCOUNT_CODE) {
      return roundMoney(Number(row.balance ?? 0))
    }
  }
  return 0
}

export function extractCurrentLiabilitiesFromCumulativeRows(rows: CumulativeBsRow[]): number {
  let sum = 0
  for (const row of rows) {
    if (String(row.account_type ?? "").trim() !== "liability") continue
    const n = parseInt(String(row.account_code ?? ""), 10) || 0
    if (n >= 2000 && n < 2500) sum += Number(row.balance ?? 0)
  }
  return roundMoney(sum)
}

export function financialOverviewFromRows(
  rows: CumulativeBsRow[],
  asOfDate: string
): FinancialOverviewPositions {
  return {
    cashBalance: extractCashFromCumulativeRows(rows),
    accountsReceivable: extractARFromCumulativeRows(rows),
    accountsPayable: extractCurrentLiabilitiesFromCumulativeRows(rows),
    asOfDate,
  }
}

/** Ledger-derived cumulative balance sheet rows as of a calendar date. */
export async function fetchCumulativeBalanceSheetRows(
  supabase: SupabaseClient,
  businessId: string,
  asOfDate: string
): Promise<{ rows: CumulativeBsRow[]; error: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    return { rows: [], error: "Invalid as_of_date" }
  }

  const { data, error } = await supabase.rpc("get_balance_sheet_as_of", {
    p_business_id: businessId,
    p_as_of_date: asOfDate,
  })

  if (error) {
    return { rows: [], error: error.message ?? "Failed to fetch cumulative balance sheet" }
  }

  return { rows: (data ?? []) as CumulativeBsRow[], error: "" }
}

/** Cumulative net income (income − expense) through as_of_date from the ledger. */
export async function fetchCumulativeNetIncomeAsOf(
  supabase: SupabaseClient,
  businessId: string,
  asOfDate: string
): Promise<{ netIncome: number; error: string }> {
  const { data, error } = await supabase.rpc("get_cumulative_net_income_as_of", {
    p_business_id: businessId,
    p_as_of_date: asOfDate,
  })

  if (error) {
    return { netIncome: 0, error: error.message ?? "Failed to fetch cumulative net income" }
  }

  return { netIncome: roundMoney(Number(data ?? 0)), error: "" }
}

export async function getFinancialOverviewPositions(
  supabase: SupabaseClient,
  businessId: string,
  asOfDate: string
): Promise<{ data: FinancialOverviewPositions | null; error: string }> {
  const { rows, error } = await fetchCumulativeBalanceSheetRows(supabase, businessId, asOfDate)
  if (error) return { data: null, error }
  return { data: financialOverviewFromRows(rows, asOfDate), error: "" }
}
