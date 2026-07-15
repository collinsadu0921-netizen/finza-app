/**
 * Read-only ledger expense breakdown for dashboard info popover.
 * Uses the same expense-account movement rules as finza_dashboard_pnl_totals.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  categoryKeyForReferenceType,
  EXPENSE_BREAKDOWN_CATEGORIES,
  roundExpenseMoney,
  type ExpenseBreakdownCategoryKey,
} from "@/lib/dashboard/expenseBreakdownCategories"

export type DashboardExpenseBreakdownLine = {
  key: ExpenseBreakdownCategoryKey
  label: string
  hint: string
  amount: number
}

export type DashboardExpenseBreakdownPayload = {
  period_start: string
  period_end: string
  total: number
  lines: DashboardExpenseBreakdownLine[]
}

type JournalRow = {
  id: string
  reference_type: string | null
}

type LineRow = {
  journal_entry_id: string
  debit: number | string | null
  credit: number | string | null
}

export function aggregateExpenseBreakdownByCategory(
  entries: JournalRow[],
  lines: LineRow[]
): Record<ExpenseBreakdownCategoryKey, number> {
  const refByJe = Object.fromEntries(entries.map((e) => [e.id, e.reference_type]))
  const totals: Record<ExpenseBreakdownCategoryKey, number> = {
    module: 0,
    bills: 0,
    payroll: 0,
    depreciation: 0,
    other: 0,
  }

  for (const line of lines) {
    const debit = Number(line.debit ?? 0)
    const credit = Number(line.credit ?? 0)
    const amount = debit - credit
    if (!Number.isFinite(amount) || amount === 0) continue

    const category = categoryKeyForReferenceType(refByJe[line.journal_entry_id])
    totals[category] = roundExpenseMoney(totals[category] + amount)
  }

  return totals
}

function buildPayload(
  periodStart: string,
  periodEnd: string,
  totals: Record<ExpenseBreakdownCategoryKey, number>
): DashboardExpenseBreakdownPayload {
  const lines = EXPENSE_BREAKDOWN_CATEGORIES.map((cat) => ({
    key: cat.key,
    label: cat.label,
    hint: cat.hint,
    amount: totals[cat.key],
  }))

  const total = roundExpenseMoney(lines.reduce((sum, line) => sum + line.amount, 0))

  return {
    period_start: periodStart,
    period_end: periodEnd,
    total,
    lines,
  }
}

const JE_BATCH = 200

export async function loadDashboardExpenseBreakdown(
  supabase: SupabaseClient,
  businessId: string,
  periodStart: string,
  periodEnd: string
): Promise<DashboardExpenseBreakdownPayload> {
  const { data: entries, error: entriesError } = await supabase
    .from("journal_entries")
    .select("id, reference_type")
    .eq("business_id", businessId)
    .gte("date", periodStart)
    .lte("date", periodEnd)

  if (entriesError) {
    throw new Error(entriesError.message ?? "Failed to load journal entries")
  }

  const journalRows = (entries ?? []) as JournalRow[]
  if (journalRows.length === 0) {
    return buildPayload(periodStart, periodEnd, {
      module: 0,
      bills: 0,
      payroll: 0,
      depreciation: 0,
      other: 0,
    })
  }

  const allLines: LineRow[] = []
  const jeIds = journalRows.map((row) => row.id)

  for (let i = 0; i < jeIds.length; i += JE_BATCH) {
    const chunk = jeIds.slice(i, i + JE_BATCH)
    const { data: lineRows, error: linesError } = await supabase
      .from("journal_entry_lines")
      .select("journal_entry_id, debit, credit, accounts!inner(type)")
      .in("journal_entry_id", chunk)
      .eq("accounts.type", "expense")

    if (linesError) {
      throw new Error(linesError.message ?? "Failed to load journal entry lines")
    }

    for (const row of lineRows ?? []) {
      allLines.push({
        journal_entry_id: row.journal_entry_id as string,
        debit: row.debit as number | string | null,
        credit: row.credit as number | string | null,
      })
    }
  }

  const totals = aggregateExpenseBreakdownByCategory(journalRows, allLines)
  return buildPayload(periodStart, periodEnd, totals)
}
