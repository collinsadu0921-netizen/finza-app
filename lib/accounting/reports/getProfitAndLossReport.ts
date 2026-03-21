/**
 * Canonical Profit & Loss report — ledger-derived from Trial Balance snapshot.
 * Single source of truth: get_profit_and_loss_from_trial_balance(period_id).
 * Period: resolved only via resolveAccountingPeriodForReport().
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { getCurrencySymbol, getCurrencyName } from "@/lib/currency"

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
    profit_before_tax: number  // gross_profit minus operating+other expenses; BEFORE taxes/CIT
    net_profit: number
  }
  telemetry: {
    resolved_period_reason: string
    resolved_period_start: string
    resolved_period_end: string
    source: "trial_balance" | "ledger" | "rpc"
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
  // Accept both "income" (accounts table) and "revenue" (chart_of_accounts table)
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

export async function getProfitAndLossReport(
  supabase: SupabaseClient,
  input: PnLReportInput
): Promise<{ data: PnLReportResponse | null; error: string }> {
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

  const { data: rows, error: rpcError } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
    p_period_id: resolvedPeriod.period_id,
  })
  if (rpcError) {
    return { data: null, error: rpcError.message ?? "Failed to fetch profit & loss" }
  }

  const raw = (rows ?? []) as Array<{
    account_id?: string
    account_code?: string
    account_name?: string
    account_type?: string
    period_total?: number
  }>

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
    const key = sectionKeyFromAccount(code, row.account_type ?? "expense")
    const accountId = row.account_id != null ? String(row.account_id) : ""
    sectionMap.get(key)!.push({ account_id: accountId, account_code: code, account_name: name, amount })
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
    data: {
      period: {
        period_id: resolvedPeriod.period_id,
        period_start: resolvedPeriod.period_start,
        period_end: resolvedPeriod.period_end,
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
        resolved_period_start: resolvedPeriod.period_start,
        resolved_period_end: resolvedPeriod.period_end,
        source: "trial_balance",
        version: 1,
      },
    },
    error: "",
  }
}
