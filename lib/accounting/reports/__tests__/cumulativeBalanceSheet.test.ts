import {
  extractARFromCumulativeRows,
  extractCashFromCumulativeRows,
  extractCurrentLiabilitiesFromCumulativeRows,
  financialOverviewFromRows,
} from "../cumulativeBalanceSheet"

const ROWS = [
  { account_code: "1000", account_type: "asset", balance: -63933.77 },
  { account_code: "1010", account_type: "asset", balance: 5564.32 },
  { account_code: "1020", account_type: "asset", balance: -3854.06 },
  { account_code: "1100", account_type: "asset", balance: 2 },
  { account_code: "2100", account_type: "liability", balance: 7043.11 },
  { account_code: "2230", account_type: "liability", balance: 1171 },
  { account_code: "2500", account_type: "liability", balance: 9999 },
]

describe("cumulativeBalanceSheet extractors", () => {
  it("matches Phase 2G benchmark totals for test fixture rows", () => {
    const overview = financialOverviewFromRows(ROWS, "2026-06-02")
    expect(extractCashFromCumulativeRows(ROWS)).toBe(-62223.51)
    expect(extractARFromCumulativeRows(ROWS)).toBe(2)
    expect(extractCurrentLiabilitiesFromCumulativeRows(ROWS)).toBe(8214.11)
    expect(overview.cashBalance).toBe(-62223.51)
    expect(overview.accountsReceivable).toBe(2)
    expect(overview.accountsPayable).toBe(8214.11)
  })

  it("excludes long-term liabilities (2500+) from current liabilities subtotal", () => {
    expect(extractCurrentLiabilitiesFromCumulativeRows(ROWS)).toBe(8214.11)
  })
})
