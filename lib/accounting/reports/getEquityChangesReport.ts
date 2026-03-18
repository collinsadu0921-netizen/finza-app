/**
 * Statement of Changes in Equity — IAS 1.
 *
 * Shows movements in each equity component across the period:
 *   Share Capital    (3000–3099)
 *   Retained Earnings (3100–3199)
 *   Other Reserves    (3200+)
 *
 * Rows per IAS 1 §106:
 *   Opening balance
 *   Profit for the period (from P&L — added to Retained Earnings column)
 *   Other comprehensive income (nil for Finza SMEs — not applicable)
 *   Ledger movements (dividends, share issuances, explicit adjustments)
 *   Closing balance (provisional — net profit not yet formally closed to RE)
 *
 * NOTE on retained earnings:
 *   Finza does not auto-post a period-close entry (Dr Income Summary, Cr RE)
 *   during an open period. Net profit is shown as a separate row and added
 *   to the closing-balance computation so the statement agrees with the
 *   provisional balance sheet.
 *
 * Period resolution: canonical via resolveAccountingPeriodForReport().
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { getCurrencySymbol, getCurrencyName } from "@/lib/currency"

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquityChangesReportInput = {
  businessId: string
  period_id?: string | null
  period_start?: string | null
  as_of_date?: string | null
  start_date?: string | null
  end_date?: string | null
}

/** One column in the equity-changes table (share_capital | retained_earnings | other_equity) */
export type EquityColumnKey = "share_capital" | "retained_earnings" | "other_equity"

/** A single account's contribution to one column */
export type EquityAccountDetail = {
  account_id?: string
  account_code: string
  account_name: string
  opening_balance: number
  period_movement: number   // ledger movements only (dividends, injections, etc.)
  closing_balance: number   // period_movement only; profit row is separate
}

/** Aggregated column totals */
export type EquityColumn = {
  key: EquityColumnKey
  label: string
  accounts: EquityAccountDetail[]
  opening_total: number
  profit_allocation: number   // net profit allocated to this column (RE only)
  period_movement_total: number
  closing_total: number       // opening + profit_allocation + period_movement_total
}

export type EquityChangesRow = {
  label: string
  share_capital: number
  retained_earnings: number
  other_equity: number
  total: number
  row_type: "opening" | "profit" | "movement" | "closing" | "account_detail"
  account_code?: string
}

export type EquityChangesReportResponse = {
  period: {
    period_id: string
    period_start: string
    period_end: string
    resolution_reason: string
  }
  currency: { code: string; symbol: string; name: string }
  columns: EquityColumn[]
  rows: EquityChangesRow[]     // pre-built rows for UI rendering
  totals: {
    opening: number
    net_profit: number
    period_movements: number
    closing: number
  }
  note: string
  telemetry: {
    resolved_period_reason: string
    resolved_period_start: string
    resolved_period_end: string
    source: "ledger"
    version: number
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type AccountMovementRow = {
  account_id?: string
  account_code?: string
  account_name?: string
  account_type?: string
  opening_balance?: number
  period_movement?: number
  closing_balance?: number
}

function r(v: number | undefined | null): number {
  return Math.round(Number(v ?? 0) * 100) / 100
}

function equityColumnKey(code: string): EquityColumnKey {
  const n = parseInt(code, 10) || 0
  if (n >= 3000 && n < 3100) return "share_capital"
  if (n >= 3100 && n < 3200) return "retained_earnings"
  return "other_equity"
}

const COLUMN_LABELS: Record<EquityColumnKey, string> = {
  share_capital:     "Share Capital",
  retained_earnings: "Retained Earnings",
  other_equity:      "Other Reserves",
}

// ─── Main report function ─────────────────────────────────────────────────────

export async function getEquityChangesReport(
  supabase: SupabaseClient,
  input: EquityChangesReportInput
): Promise<{ data: EquityChangesReportResponse | null; error: string }> {
  const { businessId } = input
  if (!businessId?.trim()) {
    return { data: null, error: "Missing required parameter: business_id" }
  }

  // ── 1. Resolve period ──────────────────────────────────────────────────────
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

  // ── 3. Fetch net profit ────────────────────────────────────────────────────
  const { data: pnlRows, error: pnlError } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
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
    // Fallback: from movements
    for (const row of rows) {
      const type = String(row.account_type ?? "")
      if (type === "income" || type === "revenue") netProfit += r(row.period_movement)
      else if (type === "expense") netProfit -= r(row.period_movement)
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

  // ── 5. Build column maps ──────────────────────────────────────────────────
  const colAccounts: Record<EquityColumnKey, EquityAccountDetail[]> = {
    share_capital:     [],
    retained_earnings: [],
    other_equity:      [],
  }

  const equityRows = rows.filter((row) => row.account_type === "equity")

  for (const row of equityRows) {
    const code = String(row.account_code ?? "").trim()
    const key  = equityColumnKey(code)
    colAccounts[key].push({
      account_id:      row.account_id != null ? String(row.account_id) : undefined,
      account_code:    code,
      account_name:    String(row.account_name ?? "").trim(),
      opening_balance: r(row.opening_balance),
      period_movement: r(row.period_movement),
      closing_balance: r(row.closing_balance),
    })
  }

  // ── 6. Aggregate per column ──────────────────────────────────────────────
  const colKeys: EquityColumnKey[] = ["share_capital", "retained_earnings", "other_equity"]

  const columns: EquityColumn[] = colKeys.map((key) => {
    const accs           = colAccounts[key]
    const openingTotal   = Math.round(accs.reduce((s, a) => s + a.opening_balance, 0) * 100) / 100
    const movTotal       = Math.round(accs.reduce((s, a) => s + a.period_movement, 0) * 100) / 100
    // Net profit is allocated only to Retained Earnings column (IAS 1 §96)
    const profitAlloc    = key === "retained_earnings" ? netProfit : 0
    const closingTotal   = Math.round((openingTotal + profitAlloc + movTotal) * 100) / 100

    return {
      key,
      label:                 COLUMN_LABELS[key],
      accounts:              accs,
      opening_total:         openingTotal,
      profit_allocation:     profitAlloc,
      period_movement_total: movTotal,
      closing_total:         closingTotal,
    }
  })

  // ── 7. Build IAS 1–style rows for UI ─────────────────────────────────────
  function makeRow(
    label: string,
    sc: number,
    re: number,
    oe: number,
    rowType: EquityChangesRow["row_type"],
    accountCode?: string
  ): EquityChangesRow {
    return {
      label,
      share_capital:     Math.round(sc * 100) / 100,
      retained_earnings: Math.round(re * 100) / 100,
      other_equity:      Math.round(oe * 100) / 100,
      total:             Math.round((sc + re + oe) * 100) / 100,
      row_type:          rowType,
      account_code:      accountCode,
    }
  }

  const tableRows: EquityChangesRow[] = []

  // Opening balance row
  tableRows.push(makeRow(
    `Balance at ${period_start}`,
    columns.find((c) => c.key === "share_capital")!.opening_total,
    columns.find((c) => c.key === "retained_earnings")!.opening_total,
    columns.find((c) => c.key === "other_equity")!.opening_total,
    "opening"
  ))

  // Profit for the period (IAS 1 §106(d)(i))
  tableRows.push(makeRow(
    "Profit for the period",
    0,
    netProfit,
    0,
    "profit"
  ))

  // Other comprehensive income — nil for Finza SMEs (omit if zero)

  // Individual ledger movements for each column
  for (const col of columns) {
    for (const acc of col.accounts) {
      if (acc.period_movement !== 0) {
        // Place in correct column
        tableRows.push(makeRow(
          acc.account_name,
          col.key === "share_capital"     ? acc.period_movement : 0,
          col.key === "retained_earnings" ? acc.period_movement : 0,
          col.key === "other_equity"      ? acc.period_movement : 0,
          "movement",
          acc.account_code
        ))
      }
    }
  }

  // Closing balance row
  tableRows.push(makeRow(
    `Balance at ${period_end}`,
    columns.find((c) => c.key === "share_capital")!.closing_total,
    columns.find((c) => c.key === "retained_earnings")!.closing_total,
    columns.find((c) => c.key === "other_equity")!.closing_total,
    "closing"
  ))

  // ── 8. Top-level totals ───────────────────────────────────────────────────
  const openingTotal    = Math.round(columns.reduce((s, c) => s + c.opening_total,         0) * 100) / 100
  const movementsTotal  = Math.round(columns.reduce((s, c) => s + c.period_movement_total, 0) * 100) / 100
  const closingTotal    = Math.round(columns.reduce((s, c) => s + c.closing_total,         0) * 100) / 100

  return {
    data: {
      period: {
        period_id:         resolvedPeriod.period_id,
        period_start,
        period_end,
        resolution_reason: resolvedPeriod.resolution_reason,
      },
      currency,
      columns,
      rows: tableRows,
      totals: {
        opening:           openingTotal,
        net_profit:        netProfit,
        period_movements:  movementsTotal,
        closing:           closingTotal,
      },
      note: "Closing balance includes profit for the period. Profit will be formally transferred to Retained Earnings on period close.",
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
