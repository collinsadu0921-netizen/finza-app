/**
 * P&L export helpers — CSV/PDF use getProfitAndLossReport (ledger movement).
 */

import type { PnLReportInput, PnLReportResponse } from "./getProfitAndLossReport"

export type PnLExportLine = {
  account_code: string
  account_name: string
  account_type: string
  period_total: number
}

export type PnLExportView = {
  periodStart: string
  periodEnd: string
  resolutionReason: string
  incomeLines: PnLExportLine[]
  expenseLines: PnLExportLine[]
  totalRevenue: number
  totalExpenses: number
  netProfit: number
  rowCount: number
}

export function parsePnLReportQuery(
  businessId: string,
  searchParams: { get: (key: string) => string | null }
): PnLReportInput {
  return {
    businessId,
    period_id: searchParams.get("period_id") ?? undefined,
    period_start: searchParams.get("period_start") ?? undefined,
    as_of_date: searchParams.get("as_of_date") ?? undefined,
    start_date: searchParams.get("start_date") ?? undefined,
    end_date: searchParams.get("end_date") ?? undefined,
  }
}

const INCOME_KEYS = new Set(["income", "other_income"])
const EXPENSE_KEYS = new Set(["cogs", "operating_expenses", "other_expenses", "taxes"])

export function toPnLExportView(data: PnLReportResponse): PnLExportView {
  const incomeLines: PnLExportLine[] = []
  const expenseLines: PnLExportLine[] = []

  for (const section of data.sections) {
    const isIncome = INCOME_KEYS.has(section.key)
    const isExpense = EXPENSE_KEYS.has(section.key)
    for (const line of section.lines) {
      const row: PnLExportLine = {
        account_code: line.account_code,
        account_name: line.account_name,
        account_type: isIncome ? "income" : "expense",
        period_total: line.amount,
      }
      if (isIncome) incomeLines.push(row)
      else if (isExpense) expenseLines.push(row)
    }
  }

  const totalRevenue = Math.round(
    data.sections
      .filter((s) => INCOME_KEYS.has(s.key))
      .reduce((sum, s) => sum + s.subtotal, 0) * 100
  ) / 100
  const totalExpenses = Math.round(
    data.sections
      .filter((s) => EXPENSE_KEYS.has(s.key))
      .reduce((sum, s) => sum + s.subtotal, 0) * 100
  ) / 100

  return {
    periodStart: data.period.period_start,
    periodEnd: data.period.period_end,
    resolutionReason: data.period.resolution_reason,
    incomeLines,
    expenseLines,
    totalRevenue,
    totalExpenses,
    netProfit: data.totals.net_profit,
    rowCount: incomeLines.length + expenseLines.length,
  }
}
