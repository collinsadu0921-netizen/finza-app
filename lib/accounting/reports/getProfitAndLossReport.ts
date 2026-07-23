/**
 * Canonical Profit & Loss report — ledger period movement (je.date in range).
 * Source: get_profit_and_loss_movement(business_id, start_date, end_date).
 * income/revenue: credits - debits; expense: debits - credits.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { getCurrencySymbol, getCurrencyName } from "@/lib/currency"
import { fetchProfitAndLossMovementRows, type PnLMovementRow } from "./pnlMovement"
import { resolvePnLMovementRange, type PnLMovementRange } from "./resolvePnLMovementRange"

export type PnLReportInput = {
  businessId: string
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
}

export type PnLSectionKey =
  | "income"
  | "cogs"
  | "operating_expenses"
  | "other_income"
  | "other_expenses"
  | "taxes"

export type PnLLine = {
  account_id: string
  account_code: string
  account_name: string
  amount: number
}

export type PnLSection = {
  key: PnLSectionKey
  label: string
  lines: PnLLine[]
  subtotal: number
}

export type PnLReportResponse = {
  period: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: string
  }
  currency: { code: string; symbol: string; name: string }
  sections: PnLSection[]
  totals: {
    gross_profit: number
    operating_profit: number
    profit_before_tax: number
    net_profit: number
  }
  telemetry: {
    resolved_period_reason: string
    resolved_period_start: string
    resolved_period_end: string
    source: "trial_balance" | "ledger" | "rpc" | "snapshot"
    version: number
  }
}

const SECTION_LABELS: Record<PnLSectionKey, string> = {
  income: "Income",
  cogs: "Cost of Goods Sold",
  operating_expenses: "Operating Expenses",
  other_income: "Other Income",
  other_expenses: "Other Expenses",
  taxes: "Taxes",
}

function sectionKeyFromAccount(code: string, accountType: string): PnLSectionKey {
  const n = parseInt(code, 10) || 0
  if (accountType === "income" || accountType === "revenue") {
    if (n >= 4000 && n < 5000) return "income"
    if (n >= 8000 && n < 9000) return "other_income"
    return "income"
  }
  if (accountType === "expense") {
    if (n >= 5000 && n < 6000) return "cogs"
    if (n >= 6000 && n < 8000) return "operating_expenses"
    if (n >= 8000 && n < 9000) return "other_expenses"
    if (n >= 9000 || code.toLowerCase().includes("tax")) return "taxes"
    return "operating_expenses"
  }
  return "operating_expenses"
}

function buildReportFromMovementRows(
  raw: PnLMovementRow[],
  resolvedPeriod: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: PnLReportResponse["period"]["resolution_reason"]
  },
  currency: PnLReportResponse["currency"],
  movementStart: string,
  movementEnd: string,
  movementSource: "snapshot" | "ledger" | "zero_initialized" = "ledger"
): PnLReportResponse {
  const sectionMap = new Map<PnLSectionKey, PnLLine[]>()
  const keys: PnLSectionKey[] = [
    "income",
    "other_income",
    "cogs",
    "operating_expenses",
    "other_expenses",
    "taxes",
  ]
  keys.forEach((k) => sectionMap.set(k, []))

  for (const row of raw) {
    const code = String(row.account_code ?? "").trim()
    const name = String(row.account_name ?? "").trim()
    const amount = Math.round(Number(row.period_total ?? 0) * 100) / 100
    const sk = sectionKeyFromAccount(code, row.account_type ?? "expense")
    const accountId = row.account_id != null ? String(row.account_id) : ""
    sectionMap.get(sk)!.push({ account_id: accountId, account_code: code, account_name: name, amount })
  }

  const sections: PnLSection[] = keys.map((key) => {
    const lines = sectionMap.get(key)!
    const subtotal = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
    return { key, label: SECTION_LABELS[key], lines, subtotal }
  })

  const totalIncome =
    sections.find((s) => s.key === "income")!.subtotal +
    sections.find((s) => s.key === "other_income")!.subtotal
  const totalCogs = sections.find((s) => s.key === "cogs")!.subtotal
  const grossProfit = Math.round((totalIncome - totalCogs) * 100) / 100
  const totalOperatingAndOther =
    sections.find((s) => s.key === "operating_expenses")!.subtotal +
    sections.find((s) => s.key === "other_expenses")!.subtotal
  const totalTaxes = sections.find((s) => s.key === "taxes")!.subtotal
  const profitBeforeTax = Math.round((grossProfit - totalOperatingAndOther) * 100) / 100
  const operatingProfit = Math.round((profitBeforeTax - totalTaxes) * 100) / 100
  const netProfit = operatingProfit

  return {
    period: {
      period_id: resolvedPeriod.period_id,
      period_start: movementStart,
      period_end: movementEnd,
      resolution_reason: resolvedPeriod.resolution_reason,
    },
    currency,
    sections,
    totals: {
      gross_profit: grossProfit,
      operating_profit: operatingProfit,
      profit_before_tax: profitBeforeTax,
      net_profit: netProfit,
    },
    telemetry: {
      resolved_period_reason: resolvedPeriod.resolution_reason,
      resolved_period_start: movementStart,
      resolved_period_end: movementEnd,
      source: movementSource === "snapshot" || movementSource === "zero_initialized" ? "snapshot" : "ledger",
      version: 2,
    },
  }
}

export type PnLReportLoadOptions = {
  /** When false, skip blocking try_refresh; still uses bounded live fallback when needed. */
  refreshOnRequest?: boolean
  scheduleBackground?: (promise: Promise<unknown>) => void
  /** When provided by the route, skip duplicate period resolution. */
  preResolvedRange?: PnLMovementRange
}

export type PnLReportLoadMeta = {
  movementSource: "snapshot" | "ledger" | "unavailable" | "zero_initialized"
  snapshotStale: boolean
  refreshJobId?: string | null
}

export async function getProfitAndLossReport(
  supabase: SupabaseClient,
  input: PnLReportInput,
  options?: PnLReportLoadOptions,
  loadMeta?: PnLReportLoadMeta
): Promise<{ data: PnLReportResponse | null; error: string }> {
  const { businessId } = input
  if (!businessId?.trim()) {
    return { data: null, error: "Missing required parameter: business_id" }
  }

  let range = options?.preResolvedRange ?? null
  if (!range) {
    const resolved = await resolvePnLMovementRange(supabase, input)
    if (resolved.error || !resolved.range) {
      return { data: null, error: resolved.error ?? "Accounting period could not be resolved" }
    }
    range = resolved.range
  }

  const refreshOnRequest = options?.refreshOnRequest !== false

  const { rows, error: fetchError, source: movementSource, snapshotStale, refreshJobId } =
    await fetchProfitAndLossMovementRows(
      supabase,
      businessId,
      range.movementStart,
      range.movementEnd,
      { refreshOnRequest, scheduleBackground: options?.scheduleBackground }
    )

  if (loadMeta) {
    loadMeta.movementSource = movementSource
    loadMeta.snapshotStale = snapshotStale
    loadMeta.refreshJobId = refreshJobId ?? null
  }

  if (movementSource === "unavailable") {
    return { data: null, error: "PNL_SNAPSHOT_UNAVAILABLE" }
  }

  if (fetchError) {
    return { data: null, error: fetchError }
  }

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

  return {
    data: buildReportFromMovementRows(
      rows,
      range.period,
      currency,
      range.movementStart,
      range.movementEnd,
      movementSource
    ),
    error: "",
  }
}

/** Shared period input for dependent reports (Cash Flow, Equity Changes, AFS). */
export type PnLPeriodInput = Pick<
  PnLReportInput,
  "businessId" | "period_id" | "period_start" | "as_of_date" | "start_date" | "end_date"
>

/** Canonical net profit for a period/range — same source as on-screen P&L. */
export async function fetchCanonicalPnLNetProfit(
  supabase: SupabaseClient,
  input: PnLPeriodInput
): Promise<{ netProfit: number; report: PnLReportResponse | null; error: string }> {
  const { data, error } = await getProfitAndLossReport(supabase, input)
  if (error || !data) {
    return { netProfit: 0, report: null, error: error ?? "Failed to fetch canonical P&L" }
  }
  return { netProfit: data.totals.net_profit, report: data, error: "" }
}

/** Dashboard/timeline helpers — revenue, expenses, net profit from canonical report. */
export function pnlTotalsFromReport(data: PnLReportResponse): {
  revenue: number
  expenses: number
  netProfit: number
} {
  const incomeSections = data.sections.filter((s) => s.key === "income" || s.key === "other_income")
  const expenseSections = data.sections.filter(
    (s) =>
      s.key === "cogs" ||
      s.key === "operating_expenses" ||
      s.key === "other_expenses" ||
      s.key === "taxes"
  )
  const revenue = Math.round(incomeSections.reduce((sum, s) => sum + s.subtotal, 0) * 100) / 100
  const expenses = Math.round(expenseSections.reduce((sum, s) => sum + s.subtotal, 0) * 100) / 100
  const netProfit = data.totals.net_profit
  return { revenue, expenses, netProfit }
}
