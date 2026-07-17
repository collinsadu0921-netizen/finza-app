/**
 * finza_dashboard_positions_as_of — AR must SUM ledger lines, not MAX.
 */

import {
  aggregateAccountsReceivableFromLines,
  aggregateAccountsReceivableMaxWrong,
  type LedgerMovementLine,
} from "@/lib/server/finzaDashboardPositionsAggregation"

const asset1100 = (debit: number, credit: number): LedgerMovementLine => ({
  accountCode: "1100",
  accountType: "asset",
  debit,
  credit,
})

describe("aggregateAccountsReceivableFromLines", () => {
  it("sums multiple AR ledger rows for one business", () => {
    const lines = [asset1100(5000, 0), asset1100(3000, 500), asset1100(0, 200)]
    expect(aggregateAccountsReceivableFromLines(lines)).toBe(7300)
  })

  it("does not use MAX of a single row (prior bug)", () => {
    const lines = [asset1100(4969, 0), asset1100(3000, 0), asset1100(2000, 500)]
    expect(aggregateAccountsReceivableFromLines(lines)).toBe(9469)
    expect(aggregateAccountsReceivableMaxWrong(lines)).toBe(4969)
    expect(aggregateAccountsReceivableFromLines(lines)).not.toBe(
      aggregateAccountsReceivableMaxWrong(lines)
    )
  })

  it("ignores non-1100 accounts", () => {
    const lines: LedgerMovementLine[] = [
      asset1100(1000, 0),
      { accountCode: "1000", accountType: "asset", debit: 50000, credit: 0 },
    ]
    expect(aggregateAccountsReceivableFromLines(lines)).toBe(1000)
  })
})
