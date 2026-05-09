/**
 * Canonical Trial Balance loader — shared by JSON, CSV, and PDF endpoints.
 * Single source of truth: get_trial_balance_from_snapshot(period_id).
 * Period: resolved only via resolveAccountingPeriodForReport().
 *
 * IMPORTANT: This loader does NOT mutate accounting math. It mirrors the
 * normalization logic that previously lived inline in the JSON route so
 * that JSON, CSV, and PDF exports return the exact same period, accounts,
 * totals, and balance status.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

export type TrialBalanceReportInput = {
  businessId: string
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
}

export type TrialBalanceAccount = {
  account_id?: string
  account_code: string
  account_name: string
  account_type: string
  opening_balance: number
  debit_total: number
  credit_total: number
  closing_balance: number
  // Legacy alias kept so existing JSON consumers (e.g. UI) keep working.
  ending_balance: number
}

export type TrialBalanceTotals = {
  totalDebits: number
  totalCredits: number
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  totalIncome: number
  totalExpenses: number
  netIncome: number
}

export type TrialBalanceReportData = {
  period: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: string
  }
  accounts: TrialBalanceAccount[]
  byType: Record<string, TrialBalanceAccount[]>
  totals: TrialBalanceTotals
  isBalanced: boolean
  /** Raw signed difference (totalDebits - totalCredits), rounded to cents. */
  imbalance: number
}

export type TrialBalanceReportResult =
  | { data: TrialBalanceReportData; error: null; status?: never }
  | { data: null; error: string; status: number }

const ACCOUNT_TYPE_KEYS = ["asset", "liability", "equity", "income", "expense"] as const

function normalizeNumber(v: unknown): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Loads the canonical Trial Balance for a period. Returns the same shape
 * that the JSON API exposes today, plus the raw signed imbalance so callers
 * (CSV/PDF) can format it as needed.
 *
 * On unbalanced ledgers this returns `error: "Trial Balance is unbalanced"`
 * with `status: 500`, matching the historical JSON-route behavior. Callers
 * that need to fail loudly on imbalance can simply forward `error` + `status`.
 */
export async function getTrialBalanceReport(
  supabase: SupabaseClient,
  input: TrialBalanceReportInput
): Promise<TrialBalanceReportResult> {
  const { businessId } = input
  if (!businessId?.trim()) {
    return { data: null, error: "Missing required parameter: business_id", status: 400 }
  }

  const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
    supabase,
    {
      businessId,
      period_id: input.period_id,
      period_start: input.period_start,
      as_of_date: input.as_of_date,
      start_date: input.start_date,
      end_date: input.end_date,
    }
  )
  if (resolveError || !resolvedPeriod) {
    return {
      data: null,
      error: resolveError ?? "Accounting period could not be resolved",
      status: 500,
    }
  }

  const { data: trialBalance, error: rpcError } = await supabase.rpc(
    "get_trial_balance_from_snapshot",
    { p_period_id: resolvedPeriod.period_id }
  )
  if (rpcError) {
    console.error("Error fetching trial balance:", rpcError)
    return {
      data: null,
      error: rpcError.message || "Failed to fetch trial balance",
      status: 500,
    }
  }

  const rawRows = (trialBalance ?? []) as Array<Record<string, unknown>>
  const accounts: TrialBalanceAccount[] = rawRows.map((acc) => {
    const closing = normalizeNumber(acc.closing_balance ?? acc.ending_balance)
    return {
      account_id: typeof acc.account_id === "string" ? acc.account_id : undefined,
      account_code: typeof acc.account_code === "string" ? acc.account_code : "",
      account_name: typeof acc.account_name === "string" ? acc.account_name : "",
      account_type: typeof acc.account_type === "string" ? acc.account_type : "",
      opening_balance: normalizeNumber(acc.opening_balance),
      debit_total: normalizeNumber(acc.debit_total),
      credit_total: normalizeNumber(acc.credit_total),
      closing_balance: closing,
      ending_balance: closing,
    }
  })

  const byType: Record<string, TrialBalanceAccount[]> = {}
  for (const k of ACCOUNT_TYPE_KEYS) byType[k] = []
  for (const acc of accounts) {
    const t = acc.account_type || "expense"
    if (!byType[t]) byType[t] = []
    byType[t].push(acc)
  }

  const sumBy = (rows: TrialBalanceAccount[], key: keyof TrialBalanceAccount): number =>
    rows.reduce((s, r) => s + (typeof r[key] === "number" ? (r[key] as number) : 0), 0)

  const totalDebits = sumBy(accounts, "debit_total")
  const totalCredits = sumBy(accounts, "credit_total")
  const totalAssets = sumBy(byType.asset ?? [], "closing_balance")
  const totalLiabilities = sumBy(byType.liability ?? [], "closing_balance")
  const totalEquity = sumBy(byType.equity ?? [], "closing_balance")
  const totalIncome = sumBy(byType.income ?? [], "closing_balance")
  const totalExpenses = sumBy(byType.expense ?? [], "closing_balance")
  const netIncome = totalIncome - totalExpenses

  const rawImbalance = totalDebits - totalCredits
  const isBalanced = Math.abs(rawImbalance) < 0.01

  return {
    data: {
      period: {
        period_id: resolvedPeriod.period_id,
        period_start: resolvedPeriod.period_start,
        period_end: resolvedPeriod.period_end,
        resolution_reason: resolvedPeriod.resolution_reason,
      },
      accounts,
      byType,
      totals: {
        totalDebits: round2(totalDebits),
        totalCredits: round2(totalCredits),
        totalAssets: round2(totalAssets),
        totalLiabilities: round2(totalLiabilities),
        totalEquity: round2(totalEquity),
        totalIncome: round2(totalIncome),
        totalExpenses: round2(totalExpenses),
        netIncome: round2(netIncome),
      },
      isBalanced,
      imbalance: round2(rawImbalance),
    },
    error: null,
  }
}
