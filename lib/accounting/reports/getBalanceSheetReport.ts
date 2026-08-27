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

/** As-of date that can be known without period or timezone lookups. */
export function peekExplicitBalanceSheetAsOfDate(
  input: BalanceSheetReportInput
): string | null {
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

  return null
}

/** Effective cumulative as-of date for balance sheet positions. */
export async function resolveBalanceSheetAsOfDate(
  supabase: SupabaseClient,
  input: BalanceSheetReportInput,
  resolvedPeriod: { period_start: string; period_end: string }
): Promise<string> {
  const peeked = peekExplicitBalanceSheetAsOfDate(input)
  if (peeked) return peeked

  const rangeStart = input.start_date?.trim()
  const hasExplicitPeriod =
    Boolean(input.period_id?.trim()) ||
    Boolean(input.period_start?.trim()) ||
    (Boolean(rangeStart) && !input.end_date?.trim())

  if (hasExplicitPeriod) {
    return resolvedPeriod.period_end
  }

  return getBusinessToday(supabase, input.businessId)
}

export type BalanceSheetReportOptions = {
  /**
   * Client for get_balance_sheet_as_of / get_cumulative_net_income_as_of.
   * Must carry the authenticated user's JWT so 577 DEFINER auth.uid() resolves.
   * Defaults to `supabase` (period / businesses client).
   */
  rpcClient?: SupabaseClient
}

export type BalanceSheetComputeTimings = {
  period_ms: number
  as_of_ms: number
  bs_rpc_ms: number
  earnings_rpc_ms: number
  business_ms: number
  assemble_ms: number
  total_ms: number
  parallel_ledger_reads: boolean
}

export type BalanceSheetReportOptions = {
  /**
   * Client for get_balance_sheet_as_of / get_cumulative_net_income_as_of.
   * Must carry the authenticated user's JWT so 577 DEFINER auth.uid() resolves.
   * Defaults to `supabase` (period / businesses client).
   */
  rpcClient?: SupabaseClient
}

export async function getBalanceSheetReport(
  supabase: SupabaseClient,
  input: BalanceSheetReportInput,
  options?: BalanceSheetReportOptions
): Promise<{
  data: BalanceSheetReportResponse | null
  error: string
  timings?: BalanceSheetComputeTimings
}> {
  const { businessId } = input
  if (!businessId?.trim()) {
    return { data: null, error: "Missing required parameter: business_id" }
  }
  const rpcClient = options?.rpcClient ?? supabase

  const tAll = performance.now()
  const timings: BalanceSheetComputeTimings = {
    period_ms: 0,
    as_of_ms: 0,
    bs_rpc_ms: 0,
    earnings_rpc_ms: 0,
    business_ms: 0,
    assemble_ms: 0,
    total_ms: 0,
    parallel_ledger_reads: false,
  }
  const finish = <T extends { data: BalanceSheetReportResponse | null; error: string }>(
    result: T
  ) => ({
    ...result,
    timings: { ...timings, total_ms: Math.round((performance.now() - tAll) * 10) / 10 },
  })

  const periodInput = {
    businessId,
    period_id: input.period_id,
    period_start: input.period_start,
    as_of_date: input.as_of_date,
    start_date: input.start_date,
    end_date: input.end_date,
  }
  const explicitAsOf = peekExplicitBalanceSheetAsOfDate(input)

  let resolvedPeriod: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: string
  } | null = null
  let asOfDate = explicitAsOf ?? ""
  let raw: CumulativeBsRow[] = []
  let currentPeriodNetIncome = 0
  let biz: { default_currency?: string; business_type?: BusinessType } | null = null

  const loadBiz = async () => {
    const t = performance.now()
    const { data } = await supabase
      .from("businesses")
      .select("default_currency, business_type")
      .eq("id", businessId)
      .single()
    timings.business_ms = Math.round((performance.now() - t) * 10) / 10
    return data
  }
  const loadPeriod = async () => {
    const t = performance.now()
    const result = await resolveAccountingPeriodForReport(supabase, periodInput)
    timings.period_ms = Math.round((performance.now() - t) * 10) / 10
    return result
  }
  const loadRows = async (asOf: string) => {
    const t = performance.now()
    const result = await fetchCumulativeBalanceSheetRows(rpcClient, businessId, asOf)
    timings.bs_rpc_ms = Math.round((performance.now() - t) * 10) / 10
    return result
  }
  const loadEarnings = async (asOf: string) => {
    const t = performance.now()
    const result = await fetchCumulativeNetIncomeAsOf(rpcClient, businessId, asOf)
    timings.earnings_rpc_ms = Math.round((performance.now() - t) * 10) / 10
    return result
  }

  if (explicitAsOf) {
    // Period metadata and ledger reads are independent once as-of is known.
    timings.parallel_ledger_reads = true
    const [periodRes, bsRes, niRes, bizRow] = await Promise.all([
      loadPeriod(),
      loadRows(explicitAsOf),
      loadEarnings(explicitAsOf),
      loadBiz(),
    ])
    if (periodRes.error || !periodRes.period) {
      return finish({
        data: null,
        error: periodRes.error ?? "Accounting period could not be resolved",
      })
    }
    if (bsRes.error) return finish({ data: null, error: bsRes.error })
    if (niRes.error) return finish({ data: null, error: niRes.error })
    resolvedPeriod = periodRes.period
    raw = bsRes.rows
    currentPeriodNetIncome = niRes.netIncome
    biz = bizRow
  } else {
    const periodRes = await loadPeriod()
    if (periodRes.error || !periodRes.period) {
      return finish({
        data: null,
        error: periodRes.error ?? "Accounting period could not be resolved",
      })
    }
    resolvedPeriod = periodRes.period
    const tAsOf = performance.now()
    asOfDate = await resolveBalanceSheetAsOfDate(supabase, input, resolvedPeriod)
    timings.as_of_ms = Math.round((performance.now() - tAsOf) * 10) / 10
    timings.parallel_ledger_reads = true
    const [bsRes, niRes, bizRow] = await Promise.all([
      loadRows(asOfDate),
      loadEarnings(asOfDate),
      loadBiz(),
    ])
    if (bsRes.error) return finish({ data: null, error: bsRes.error })
    if (niRes.error) return finish({ data: null, error: niRes.error })
    raw = bsRes.rows
    currentPeriodNetIncome = niRes.netIncome
    biz = bizRow
  }

  const tAssemble = performance.now()
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

  timings.assemble_ms = Math.round((performance.now() - tAssemble) * 10) / 10

  return finish({
    data: {
      period: {
        period_id: resolvedPeriod!.period_id,
        period_start: resolvedPeriod!.period_start,
        period_end: resolvedPeriod!.period_end,
        resolution_reason: resolvedPeriod!.resolution_reason,
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
        resolved_period_reason: resolvedPeriod!.resolution_reason,
        resolved_period_start: resolvedPeriod!.period_start,
        resolved_period_end: resolvedPeriod!.period_end,
        source: "ledger",
        version: 2,
      },
    },
    error: "",
  })
}
