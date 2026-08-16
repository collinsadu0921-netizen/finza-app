/**
 * Pure helpers for loan principal subledger outstanding (mirrors DB finza_loan_outstanding).
 */

export type LoanPrincipalLedgerKind =
  | "drawdown"
  | "repayment"
  | "reversal_drawdown"
  | "reversal_repayment"

export type LoanPrincipalLedgerRow = {
  entry_kind: LoanPrincipalLedgerKind
  amount: number
}

export function computeLoanOutstandingFromLedger(
  rows: LoanPrincipalLedgerRow[]
): number {
  let total = 0
  for (const row of rows) {
    const amount = Number(row.amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    switch (row.entry_kind) {
      case "drawdown":
      case "reversal_repayment":
        total += amount
        break
      case "repayment":
      case "reversal_drawdown":
        total -= amount
        break
      default:
        break
    }
  }
  return Math.max(0, Math.round(total * 100) / 100)
}
