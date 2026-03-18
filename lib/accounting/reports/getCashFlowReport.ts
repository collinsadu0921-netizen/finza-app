/**
 * Statement of Cash Flows — IAS 7, Indirect Method.
 *
 * Derives cash flows from the ledger via get_account_movements().
 * Three-section structure: Operating | Investing | Financing.
 *
 * Operating (Indirect Method):
 *   Net profit for the period
 *   + Depreciation & amortisation (non-cash add-back from contra_asset movements)
 *   ± Changes in working capital (current assets 1100-1599, current liabilities 2000-2499)
 *
 * Investing:
 *   Net movement in fixed asset accounts (1600-1999, type=asset)
 *   Positive = proceeds; negative = purchases.
 *
 * Financing:
 *   Net movement in long-term liability accounts (2500+)
 *   Net movement in equity accounts (3000+), excluding accounts handled via retained-earnings roll-forward.
 *
 * Cash reconciliation:
 *   Opening cash (1000-1099, cumulative to period_start - 1 day)
 *   + Net cash movement (operating + investing + financing)
 *   = Closing cash (1000-1099, cumulative to period_end)
 *
 * Period resolution: canonical via resolveAccountingPeriodForReport().
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { getCurrencySymbol, getCurrencyName } from "@/lib/currency"

// ─── Input / Output types ────────────────────────────────────────────────────

export type CashFlowReportInput = {
  businessId: string
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
}

export type CashFlowLine = {
  account_id?: string
  account_code: string
  account_name: string
  amount: number              // positive = inflow, negative = outflow
  is_adjustment?: boolean     // true for non-cash adjustments (depreciation)
}

export type CashFlowSectionKey = "operating" | "investing" | "financing"

export type CashFlowSection = {
  key: CashFlowSectionKey
  label: string
  lines: CashFlowLine[]
  adjustments: CashFlowLine[]      // non-cash items and working-capital changes (operating only)
  net: number                      // sum of lines + adjustments
}

export type CashFlowReportResponse = {
  period: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: string
  }
  currency: { code: string; symbol: string; name: string }
  sections: CashFlowSection[]
  cash_reconciliation: {
    opening_cash: number
    net_cash_movement: number
    closing_cash_ledger: number
    closing_cash_computed: number
    reconciles: boolean
    difference: number
  }
  totals: {
    net_operating: number
    net_investing: number
    net_financing: number
    net_change_in_cash: number
  }
  telemetry: {
    resolved_period_reason: string
    resolved_period_start: string
    resolved_period_end: string
    source: "ledger"
    version: number
  }
}

// ─── Account classification helpers ─────────────────────────────────────────

type AccountMovementRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  opening_balance?: number
  period_debit?: number
  period_credit?: number
  period_movement?: number
  closing_balance?: number
}

function codeNum(row: AccountMovementRow): number {
  return parseInt(String(row.account_code ?? "0"), 10) || 0
}

function r(v: number | undefined | null): number {
  return Math.round(Number(v ?? 0) * 100) / 100
}

function toCashFlowLine(row: AccountMovementRow, amount: number): CashFlowLine {
  return {
    account_id:   row.account_id != null ? String(row.account_id) : undefined,
    account_code: String(row.account_code ?? ""),
    account_name: String(row.account_name ?? ""),
    amount:       Math.round(amount * 100) / 100,
  }
}

// ─── Main report function ────────────────────────────────────────────────────

export async function getCashFlowReport(
  supabase: SupabaseClient,
  input: CashFlowReportInput
): Promise<{ data: CashFlowReportResponse | null; error: string }> {
  const { businessId } = input
  if (!businessId?.trim()) {
    return { data: null, error: "Missing required parameter: business_id" }
  }

  // ── 1. Resolve accounting period ──────────────────────────────────────────
  const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
    supabase,
    {
      businessId,
      period_id:    input.period_id,
      period_start: input.period_start,
      as_of_date:   input.as_of_date,
      start_date:   input.start_date,
      end_date:     input.end_date,
    }
  )
  if (resolveError || !resolvedPeriod) {
    return { data: null, error: resolveError ?? "Accounting period could not be resolved" }
  }

  const { period_start, period_end } = resolvedPeriod

  // ── 2. Fetch account movements ─────────────────────────────────────────────
  const { data: movRows, error: movError } = await supabase.rpc("get_account_movements", {
    p_business_id: businessId,
    p_start_date:  period_start,
    p_end_date:    period_end,
  })
  if (movError) {
    return { data: null, error: movError.message ?? "Failed to fetch account movements" }
  }
  const rows = (movRows ?? []) as AccountMovementRow[]

  // ── 3. Fetch net profit from P&L (indirect method starting point) ──────────
  const { data: pnlRows, error: pnlError } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
    // Fall back to direct date-based P&L if period_id variant is unavailable.
    // The canonical variant used by existing reports.
    p_period_id: resolvedPeriod.period_id,
  })
  let netProfit = 0
  if (!pnlError && pnlRows) {
    const pnl = pnlRows as Array<{ account_type?: string; period_total?: number }>
    netProfit = pnl.reduce((sum, r2) => {
      const t = Number(r2.period_total ?? 0)
      const isIncome = r2.account_type === "income" || r2.account_type === "revenue"
      return sum + (isIncome ? t : r2.account_type === "expense" ? -t : 0)
    }, 0)
  } else {
    // Fallback: compute from account movements (income/expense accounts)
    for (const row of rows) {
      const type = String(row.account_type ?? "")
      if (type === "income" || type === "revenue") {
        netProfit += r(row.period_movement)
      } else if (type === "expense") {
        netProfit -= r(row.period_movement)
      }
    }
  }
  netProfit = Math.round(netProfit * 100) / 100

  // ── 4. Currency ───────────────────────────────────────────────────────────
  const { data: biz } = await supabase
    .from("businesses")
    .select("default_currency")
    .eq("id", businessId)
    .single()
  const currencyCode = biz?.default_currency ?? "GHS"
  const currency = {
    code:   currencyCode,
    symbol: getCurrencySymbol(currencyCode) || currencyCode,
    name:   getCurrencyName(currencyCode)   || currencyCode,
  }

  // ── 5. Classify accounts into cash flow sections ──────────────────────────
  const operatingLines:      CashFlowLine[] = []
  const operatingAdjustments: CashFlowLine[] = []  // depreciation + working capital
  const investingLines:      CashFlowLine[] = []
  const financingLines:      CashFlowLine[] = []

  let openingCash   = 0
  let closingCash   = 0
  let depAddBack    = 0

  for (const row of rows) {
    const n    = codeNum(row)
    const type = String(row.account_type ?? "")
    const pm   = r(row.period_movement)   // signed per normal-balance direction
    const ob   = r(row.opening_balance)
    const cb   = r(row.closing_balance)

    // ── Cash & cash equivalents (1000–1099) ──────────────────────────────────
    // Excluded from adjustments; used only for opening/closing cash reconciliation.
    if (type === "asset" && n >= 1000 && n < 1100) {
      openingCash += ob
      closingCash += cb
      continue
    }

    // ── Contra-asset (accumulated depreciation) ───────────────────────────────
    // IAS 7 §20(b): add back depreciation and amortisation.
    // Handles both explicit contra_asset type AND asset accounts with a net credit
    // closing balance (e.g. code 1650 Accumulated Depreciation — typed 'asset' in
    // Finza's chart but carries a credit/negative balance under the debit-normal formula).
    // For such accounts: period_movement (debit-normal) = debit − credit.
    // When depreciation is charged: credit > debit → period_movement < 0.
    // Add-back = −period_movement (converts the negative to a positive add-back).
    const isAccumDepreciation =
      type === "contra_asset" ||
      (type === "asset" && n >= 1600 && n < 2000 && r(row.closing_balance) < 0)

    if (isAccumDepreciation) {
      // contra_asset (credit-normal): pm already positive when depreciation charged.
      // asset typed with negative closing balance: pm is negative when depreciation charged → negate.
      depAddBack += type === "contra_asset" ? pm : -pm
      continue
    }

    // ── Current assets (non-cash, 1100–1599) — working capital ───────────────
    // CF impact: increase in asset = cash outflow → -(period_movement)
    if (type === "asset" && n >= 1100 && n < 1600) {
      const cfAmt = -pm  // negate: asset increase (positive pm) = outflow (negative cf)
      if (cfAmt !== 0) {
        operatingAdjustments.push({ ...toCashFlowLine(row, cfAmt), is_adjustment: true })
      }
      continue
    }

    // ── Fixed assets (1600–1999) — investing ─────────────────────────────────
    // Only PPE cost accounts (closing_balance >= 0 = debit-normal = cost of asset).
    // Accumulated depreciation accounts already captured above (closing_balance < 0).
    // CF impact: asset increase (purchase) = outflow → -(period_movement)
    //            asset decrease (disposal at cost) = inflow → -(period_movement)
    if (type === "asset" && n >= 1600 && n < 2000) {
      const cfAmt = -pm
      if (cfAmt !== 0) {
        investingLines.push(toCashFlowLine(row, cfAmt))
      }
      continue
    }

    // ── Current liabilities (2000–2499) — working capital ────────────────────
    // CF impact: increase in liability = cash inflow → +(period_movement)
    if (type === "liability" && n >= 2000 && n < 2500) {
      const cfAmt = pm
      if (cfAmt !== 0) {
        operatingAdjustments.push({ ...toCashFlowLine(row, cfAmt), is_adjustment: true })
      }
      continue
    }

    // ── Long-term liabilities (2500+) — financing ────────────────────────────
    // CF impact: increase = inflow → +(period_movement)
    if (type === "liability" && n >= 2500) {
      const cfAmt = pm
      if (cfAmt !== 0) {
        financingLines.push(toCashFlowLine(row, cfAmt))
      }
      continue
    }

    // ── Equity (3000+) — financing ────────────────────────────────────────────
    // Share capital injections: credit → positive pm → cash inflow ✓
    // Dividends paid: debit to retained earnings → negative pm → cash outflow ✓
    // NOTE: retained-earnings movement from a formal period-close (Dr Income Summary,
    //       Cr Retained Earnings) would also appear here. To avoid double-counting
    //       with net profit, we show the ledger equity movement as-is; accountants
    //       should ensure period-close entries are excluded from open periods.
    if (type === "equity" && n >= 3000) {
      const cfAmt = pm
      if (cfAmt !== 0) {
        financingLines.push(toCashFlowLine(row, cfAmt))
      }
      continue
    }

    // income, revenue, expense — captured via net profit; skip.
  }

  // ── 6. Build operating section ────────────────────────────────────────────
  openingCash  = Math.round(openingCash * 100) / 100
  closingCash  = Math.round(closingCash * 100) / 100
  depAddBack   = Math.round(depAddBack * 100)  / 100

  // Net profit line (always first in operating)
  operatingLines.push({
    account_code: "",
    account_name: "Net profit for the period",
    amount:       netProfit,
  })

  // Depreciation add-back (single aggregated line)
  if (depAddBack !== 0) {
    operatingAdjustments.unshift({
      account_code: "",
      account_name: "Depreciation and amortisation",
      amount:       depAddBack,
      is_adjustment: true,
    })
  }

  const netOperating = Math.round(
    [...operatingLines, ...operatingAdjustments].reduce((s, l) => s + l.amount, 0) * 100
  ) / 100

  const netInvesting = Math.round(
    investingLines.reduce((s, l) => s + l.amount, 0) * 100
  ) / 100

  const netFinancing = Math.round(
    financingLines.reduce((s, l) => s + l.amount, 0) * 100
  ) / 100

  const netChangeCash = Math.round((netOperating + netInvesting + netFinancing) * 100) / 100

  // ── 7. Cash reconciliation ────────────────────────────────────────────────
  const closingCashComputed = Math.round((openingCash + netChangeCash) * 100) / 100
  const difference          = Math.round((closingCashComputed - closingCash) * 100) / 100
  const reconciles          = Math.abs(difference) < 0.01

  // ── 8. Assemble sections ──────────────────────────────────────────────────
  const sections: CashFlowSection[] = [
    {
      key:         "operating",
      label:       "Operating Activities",
      lines:       operatingLines,
      adjustments: operatingAdjustments,
      net:         netOperating,
    },
    {
      key:         "investing",
      label:       "Investing Activities",
      lines:       investingLines,
      adjustments: [],
      net:         netInvesting,
    },
    {
      key:         "financing",
      label:       "Financing Activities",
      lines:       financingLines,
      adjustments: [],
      net:         netFinancing,
    },
  ]

  return {
    data: {
      period: {
        period_id:          resolvedPeriod.period_id,
        period_start:       period_start,
        period_end:         period_end,
        resolution_reason:  resolvedPeriod.resolution_reason,
      },
      currency,
      sections,
      cash_reconciliation: {
        opening_cash:           openingCash,
        net_cash_movement:      netChangeCash,
        closing_cash_ledger:    closingCash,
        closing_cash_computed:  closingCashComputed,
        reconciles,
        difference,
      },
      totals: {
        net_operating:       netOperating,
        net_investing:       netInvesting,
        net_financing:       netFinancing,
        net_change_in_cash:  netChangeCash,
      },
      telemetry: {
        resolved_period_reason: resolvedPeriod.resolution_reason,
        resolved_period_start:  period_start,
        resolved_period_end:    period_end,
        source:                 "ledger",
        version:                1,
      },
    },
    error: "",
  }
}
