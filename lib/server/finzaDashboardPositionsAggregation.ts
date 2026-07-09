/**
 * Pure aggregation contract for finza_dashboard_positions_as_of account 1100.
 * Mirrors SQL: SUM(debit - credit) per line — never MAX(single row).
 */

export type LedgerMovementLine = {
  accountCode: string
  accountType: "asset" | "liability" | "equity" | "income" | "expense"
  debit: number
  credit: number
}

export function aggregateAccountsReceivableFromLines(lines: LedgerMovementLine[]): number {
  let total = 0
  for (const line of lines) {
    if (line.accountCode === "1100" && line.accountType === "asset") {
      total += line.debit - line.credit
    }
  }
  return Math.round(total * 100) / 100
}

/** @deprecated Wrong pattern — kept in tests to document the prior bug. */
export function aggregateAccountsReceivableMaxWrong(lines: LedgerMovementLine[]): number {
  let max = 0
  for (const line of lines) {
    if (line.accountCode === "1100" && line.accountType === "asset") {
      const net = line.debit - line.credit
      if (net > max) max = net
    }
  }
  return Math.round(max * 100) / 100
}
