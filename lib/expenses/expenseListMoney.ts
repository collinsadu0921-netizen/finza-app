export type ExpenseListMoney = {
  total?: number | null
  currency_code?: string | null
  fx_rate?: number | null
  home_currency_code?: string | null
  home_currency_total?: number | null
}

export function expenseDocumentCurrency(expense: ExpenseListMoney, homeCurrency: string): string {
  const home = homeCurrency.trim().toUpperCase() || "GHS"
  const code = expense.currency_code?.trim().toUpperCase() || ""
  if (code && code !== home) return code
  return home
}

export function expenseIsForeign(expense: ExpenseListMoney, homeCurrency: string): boolean {
  return expenseDocumentCurrency(expense, homeCurrency) !== (homeCurrency.trim().toUpperCase() || "GHS")
}

/**
 * Amount to include in home-currency totals.
 * Foreign rows use the stored home total, then total × rate.
 * A document amount is never treated as home currency.
 */
export function expenseHomeTotal(expense: ExpenseListMoney, homeCurrency: string): number | null {
  if (!expenseIsForeign(expense, homeCurrency)) {
    const total = Number(expense.total)
    return Number.isFinite(total) ? total : null
  }
  const stored = Number(expense.home_currency_total)
  if (expense.home_currency_total != null && Number.isFinite(stored)) return stored
  const rate = Number(expense.fx_rate)
  const total = Number(expense.total)
  if (Number.isFinite(rate) && rate > 0 && Number.isFinite(total)) {
    return Math.round(total * rate * 100) / 100
  }
  return null
}
