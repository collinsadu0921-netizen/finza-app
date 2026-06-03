/**
 * Canonical Balance Sheet report — cumulative ledger as-of date.
 * Source: get_balance_sheet_as_of(business_id, as_of_date) + cumulative net income for equity.
 * Period metadata: resolveAccountingPeriodForReport() (P&L period context only).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getBusinessToday } from "@/lib/accounting/businessDate"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import {
  fetchCumulativeBalanceSheetRows,
  fetchCumulativeNetIncomeAsOf,
  type CumulativeBsRow,
} from "@/lib/accounting/reports/cumulativeBalanceSheet"
import { getCurrencySymbol, getCurrencyName } from "@/lib/currency"

export type BusinessType = "limited_company" | "sole_proprietorship"

export type BalanceSheetReportInput = {
  businessId: string
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
  /** Optional override — if omitted the value is read from the businesses table. */
  business_type?: BusinessType | null
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
  business_type: BusinessType
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

/** Effective cumulative as-of date for balance sheet positions. */
export async function resolveBalanceSheetAsOfDate(
  supabase: SupabaseClient,
  input: BalanceSheetReportInput,
  resolvedPeriod: { period_start: string; period_end: string }
): Promise<string> {
  const explicit = input.as_of_date?.trim()
  if (explicit && /^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
    return explicit
  }

  const rangeStart = input.start_date?.trim()
  const rangeEnd = input.end_date?.trim()
  if (
    rangeStart &&
    rangeEnd &&
    /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd)
  ) {
    return rangeEnd
  }

  const hasExplicitPeriod =
    Boolean(input.period_id?.trim()) ||
    Boolean(input.period_start?.trim()) ||
    (Boolean(rangeStart) && !rangeEnd)

  if (hasExplicitPeriod) {
    return resolvedPeriod.period_end
  }

  return getBusinessToday(supabase, input.businessId)
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

  const asOfDate = await resolveBalanceSheetAsOfDate(supabase, input, resolvedPeriod)

  const { rows: raw, error: bsError } = await fetchCumulativeBalanceSheetRows(
    supabase,
    businessId,
    asOfDate
  )
  if (bsError) {
    return { data: null, error: bsError }
  }

  const { netIncome: cumulativeNetIncome, error: niError } = await fetchCumulativeNetIncomeAsOf(
    supabase,
    businessId,
    asOfDate
  )
  if (niError) {
    return { data: null, error: niError }
  }
  const currentPeriodNetIncome = cumulativeNetIncome

  const { data: biz } = await supabase
    .from("businesses")
    .select("default_currency, business_type")
    .eq("id", businessId)
    .single()
  const currencyCode = (biz as { default_currency?: string })?.default_currency ?? "USD"
  const currency = {
    code: currencyCode,
    symbol: getCurrencySymbol(currencyCode) || currencyCode,
    name: getCurrencyName(currencyCode) || currencyCode,
  }
  const resolvedBusinessType: BusinessType =
    input.business_type ??
    ((biz as { business_type?: BusinessType })?.business_type as BusinessType | undefined) ??
    "limited_company"

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

  for (const row of raw as CumulativeBsRow[]) {
    const code = String(row.account_code ?? "").trim()
    const name = String(row.account_name ?? "").trim()
    const amount = Math.round(Number(row.balance ?? 0) * 100) / 100
    const type = String(row.account_type ?? "").trim()
    const groupKey = groupKeyFromAccount(code, type)
    const accountId = row.account_id != null ? String(row.account_id) : ""
    const line: BSLine = { account_id: accountId, account_code: code, account_name: name, amount }
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

  const isSoleProp = resolvedBusinessType === "sole_proprietorship"
  const equitySectionLabel = isSoleProp ? "Owner's Equity" : "Equity"
  const netIncomeLineLabel = isSoleProp
    ? "Net Profit (cumulative)"
    : "Net Income (cumulative)"

  const equityGroupWithNetIncome: BSGroup[] = equityGroups.map((g) => {
    if (g.key !== "equity") return g
    const syntheticLine: BSLine = {
      account_id: "__net_income__",
      account_code: "",
      account_name: netIncomeLineLabel,
      amount: currentPeriodNetIncome,
    }
    const lines =
      currentPeriodNetIncome !== 0 ? [...g.lines, syntheticLine] : g.lines
    return {
      ...g,
      label: equitySectionLabel,
      lines,
      subtotal: Math.round((g.subtotal + currentPeriodNetIncome) * 100) / 100,
    }
  })

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
      label: equitySectionLabel,
      groups: equityGroupWithNetIncome,
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
      as_of_date: asOfDate,
      business_type: resolvedBusinessType,
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
        source: "ledger",
        version: 2,
      },
    },
    error: "",
  }
}
