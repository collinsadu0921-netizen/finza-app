/**
 * Net effect of a single journal line on the account balance,
 * matching get_general_ledger line_balance_change semantics.
 */
export function ledgerLineNetEffect(
  debit: number,
  credit: number,
  accountType: string
): number {
  if (accountType === "asset" || accountType === "expense") {
    return Number(debit || 0) - Number(credit || 0)
  }
  return Number(credit || 0) - Number(debit || 0)
}

export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
