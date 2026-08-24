import {
  mapBalanceSheetTotals,
  mapProfitAndLossTotals,
} from "@/lib/accounting/reportClientTotals"

const STAGING_PNL_FIXTURE = {
  period: { period_start: "2026-08-01", period_end: "2026-08-31" },
  sections: [
    { key: "income", subtotal: 0 },
    { key: "other_income", subtotal: 0 },
    { key: "cogs", subtotal: 6441 },
  ],
  totals: { net_profit: -6441, gross_profit: -6441 },
}

const STAGING_BS_FIXTURE = {
  as_of_date: "2026-08-24",
  totals: {
    assets: 699059.32,
    liabilities: 158518.79,
    equity: 540540.54,
    liabilities_plus_equity: 699059.33,
    imbalance: 0.01,
    is_balanced: false,
  },
}

describe("accounting report client mapping parity", () => {
  it("maps P&L totals without rounding drift", () => {
    expect(mapProfitAndLossTotals(STAGING_PNL_FIXTURE)).toEqual({
      revenue: 0,
      expenses: 6441,
      net: -6441,
      gross: -6441,
    })
  })

  it("maps Balance Sheet totals without rounding drift", () => {
    expect(mapBalanceSheetTotals(STAGING_BS_FIXTURE)).toEqual({
      assets: 699059.32,
      liabilities: 158518.79,
      equity: 540540.54,
      liabilitiesPlusEquity: 699059.33,
      difference: 0.01,
      isBalanced: false,
    })
  })
})
