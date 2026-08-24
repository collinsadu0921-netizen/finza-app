/** Client-only mapping of already-computed report payloads. No arithmetic changes. */

export function mapProfitAndLossTotals(data: {
  sections?: Array<{ key: string; subtotal: number }>
  totals?: { net_profit?: number; gross_profit?: number }
}): {
  revenue: number
  expenses: number
  net: number
  gross: number | null
} {
  const allSections = data.sections ?? []
  const income = allSections.filter((s) => s.key === "income" || s.key === "other_income")
  const expense = allSections.filter((s) => s.key !== "income" && s.key !== "other_income")
  return {
    revenue: income.reduce((sum, s) => sum + s.subtotal, 0),
    expenses: expense.reduce((sum, s) => sum + s.subtotal, 0),
    net: data.totals?.net_profit ?? 0,
    gross: typeof data.totals?.gross_profit === "number" ? data.totals.gross_profit : null,
  }
}

export function mapBalanceSheetTotals(data: {
  totals?: {
    assets?: number
    liabilities?: number
    equity?: number
    liabilities_plus_equity?: number
    imbalance?: number
    is_balanced?: boolean
  }
}): {
  assets: number
  liabilities: number
  equity: number
  liabilitiesPlusEquity: number
  difference: number
  isBalanced: boolean
} {
  return {
    assets: data.totals?.assets ?? 0,
    liabilities: data.totals?.liabilities ?? 0,
    equity: data.totals?.equity ?? 0,
    liabilitiesPlusEquity: data.totals?.liabilities_plus_equity ?? 0,
    difference: data.totals?.imbalance ?? 0,
    isBalanced: data.totals?.is_balanced ?? false,
  }
}
