/**
 * Canonical Balance Sheet report — ledger-derived from Trial Balance snapshot.
 * Single source of truth: get_balance_sheet_from_trial_balance(period_id).
 * Period: resolved only via resolveAccountingPeriodForReport().
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { getCurrencySymbol, getCurrencyName } from "@/lib/currency"

export type BalanceSheetReportInput = {
  businessId: string
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
}

export type BSSectionKey = "assets" | "liabilities" | "equity"
export type BSGroupKey =
  | "current_assets"
  | "fixed_assets"
  | "current_liabilities"
  | "long_term_liabilities"
  | "equity"

export type BSLine = {
  account_id: string
  account_code: string
  account_name: string
  amount: number
}

export type BSGroup = {
  key: BSGroupKey
  label: string
  lines: BSLine[]
  subtotal: number
}

export type BSSection = {
  key: BSSectionKey
  label: string
  groups: BSGroup[]
  subtotal: number
}

export type BalanceSheetReportResponse = {
  period: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: string
  }
  currency: { code: string; symbol: string; name: string }
  as_of_date: string
  sections: BSSection[]
  totals: {
    assets: number
    liabilities: number
    equity: number
    liabilities_plus_equity: number
    is_balanced: boolean
    imbalance: number
  }
  telemetry: {
    resolved_period_reason: string
    resolved_period_start: string
    resolved_period_end: string
    source: "trial_balance" | "ledger" | "rpc"
    version: number
  }
}

const GROUP_LABELS: Record<BSGroupKey, string> = {
  current_assets: "Current Assets",
  fixed_assets: "Fixed Assets",
  current_liabilities: "Current Liabilities",
  long_term_liabilities: "Long Term Liabilities",
  equity: "Equity",
}

function groupKeyFromAccount(code: string, accountType: string): BSGroupKey {
  const n = parseInt(code, 10) || 0
  if (accountType === "asset") {
    if (n >= 1000 && n < 1600) return "current_assets"
    if (n >= 1600 && n < 2000) return "fixed_assets"
    return "current_assets"
  }
  // contra_asset (e.g. Accumulated Depreciation 1650) is grouped under fixed_assets as a deduction.
  // The RPC returns these with a negative balance so Σ(asset + contra_asset amounts) = net book value.
  if (accountType === "contra_asset") {
    return "fixed_assets"
  }
  if (accountType === "liability") {
    if (n >= 2000 && n < 2500) return "current_liabilities"
    return "long_term_liabilities"
  }
  if (accountType === "equity") return "equity"
  return "current_assets"
}

export async function getBalanceSheetReport(
  supabase: SupabaseClient,
  input: BalanceSheetReportInput
): Promise<{ data: BalanceSheetReportResponse | null; error: string }> {
  const { businessId } = input
  if (!businessId?.trim()) {
    return { data: null, error: "Missing required parameter: business_id" }
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
    return { data: null, error: resolveError ?? "Accounting period could not be resolved" }
  }

  const { data: bsRows, error: bsError } = await supabase.rpc("get_balance_sheet_from_trial_balance", {
    p_period_id: resolvedPeriod.period_id,
  })
  if (bsError) {
    return { data: null, error: bsError.message ?? "Failed to fetch balance sheet" }
  }

  const raw = (bsRows ?? []) as Array<{
    account_id?: string
    account_code?: string
    account_name?: string
    account_type?: string
    balance?: number
  }>

  const { data: pnlRows } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
    p_period_id: resolvedPeriod.period_id,
  })
  const pnl = (pnlRows ?? []) as Array<{ account_type?: string; period_total?: number }>
  const netIncome = pnl.reduce((sum, r) => {
    const t = Number(r.period_total ?? 0)
    const isIncome = r.account_type === "income" || r.account_type === "revenue"
    return sum + (isIncome ? t : r.account_type === "expense" ? -t : 0)
  }, 0)
  const currentPeriodNetIncome = Math.round(netIncome * 100) / 100

  const { data: biz } = await supabase
    .from("businesses")
    .select("default_currency")
    .eq("id", businessId)
    .single()
  const currencyCode = biz?.default_currency ?? "USD"
  const currency = {
    code: currencyCode,
    symbol: getCurrencySymbol(currencyCode) || currencyCode,
    name: getCurrencyName(currencyCode) || currencyCode,
  }

  const assetsByGroup = new Map<BSGroupKey, BSLine[]>()
  const liabilitiesByGroup = new Map<BSGroupKey, BSLine[]>()
  const equityByGroup = new Map<BSGroupKey, BSLine[]>()
  ;[
    "current_assets",
    "fixed_assets",
    "current_liabilities",
    "long_term_liabilities",
    "equity",
  ].forEach((k) => {
    assetsByGroup.set(k as BSGroupKey, [])
    liabilitiesByGroup.set(k as BSGroupKey, [])
    equityByGroup.set(k as BSGroupKey, [])
  })

  for (const row of raw) {
    const code = String(row.account_code ?? "").trim()
    const name = String(row.account_name ?? "").trim()
    const amount = Math.round(Number(row.balance ?? 0) * 100) / 100
    const type = String(row.account_type ?? "").trim()
    const groupKey = groupKeyFromAccount(code, type)
    const accountId = row.account_id != null ? String(row.account_id) : ""
    const line: BSLine = { account_id: accountId, account_code: code, account_name: name, amount }
    // contra_asset rows have negative balance (returned by RPC) and group under fixed_assets
    if (type === "asset" || type === "contra_asset") assetsByGroup.get(groupKey)!.push(line)
    else if (type === "liability") liabilitiesByGroup.get(groupKey)!.push(line)
    else if (type === "equity") equityByGroup.get(groupKey)!.push(line)
  }

  const toGroups = (map: Map<BSGroupKey, BSLine[]>, keys: BSGroupKey[]): BSGroup[] =>
    keys.map((key) => {
      const lines = map.get(key)!
      const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
      return { key, label: GROUP_LABELS[key], lines, subtotal }
    })

  const assetGroups = toGroups(assetsByGroup, ["current_assets", "fixed_assets"])
  const liabilityGroups = toGroups(liabilitiesByGroup, ["current_liabilities", "long_term_liabilities"])
  const equityGroups = toGroups(equityByGroup, ["equity"])

  const totalAssets = Math.round(assetGroups.reduce((s, g) => s + g.subtotal, 0) * 100) / 100
  const totalLiabilities = Math.round(liabilityGroups.reduce((s, g) => s + g.subtotal, 0) * 100) / 100
  const totalEquity = Math.round(equityGroups.reduce((s, g) => s + g.subtotal, 0) * 100) / 100
  const adjustedEquity = Math.round((totalEquity + currentPeriodNetIncome) * 100) / 100
  const liabilitiesPlusEquity = Math.round((totalLiabilities + adjustedEquity) * 100) / 100
  const imbalance = Math.round((totalAssets - liabilitiesPlusEquity) * 100) / 100
  const isBalanced = Math.abs(imbalance) < 0.01

  const sections: BSSection[] = [
    {
      key: "assets",
      label: "Assets",
      groups: assetGroups,
      subtotal: totalAssets,
    },
    {
      key: "liabilities",
      label: "Liabilities",
      groups: liabilityGroups,
      subtotal: totalLiabilities,
    },
    {
      key: "equity",
      label: "Equity",
      groups: equityGroups,
      subtotal: adjustedEquity,
    },
  ]

  return {
    data: {
      period: {
        period_id: resolvedPeriod.period_id,
        period_start: resolvedPeriod.period_start,
        period_end: resolvedPeriod.period_end,
        resolution_reason: resolvedPeriod.resolution_reason,
      },
      currency,
      as_of_date: resolvedPeriod.period_end,
      sections,
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity: totalEquity,
        liabilities_plus_equity: liabilitiesPlusEquity,
        is_balanced: isBalanced,
        imbalance,
      },
      telemetry: {
        resolved_period_reason: resolvedPeriod.resolution_reason,
        resolved_period_start: resolvedPeriod.period_start,
        resolved_period_end: resolvedPeriod.period_end,
        source: "trial_balance",
        version: 1,
      },
    },
    error: "",
  }
}
