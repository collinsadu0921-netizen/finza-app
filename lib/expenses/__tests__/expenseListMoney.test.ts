import { expenseDocumentCurrency, expenseHomeTotal } from "@/lib/expenses/expenseListMoney"

describe("expense list money", () => {
  it("shows a USD expense in document currency", () => {
    expect(
      expenseDocumentCurrency({ total: 25, currency_code: "USD", home_currency_total: 375 }, "GHS")
    ).toBe("USD")
  })

  it("keeps a home-currency expense in GHS", () => {
    expect(expenseDocumentCurrency({ total: 45.5, currency_code: null }, "GHS")).toBe("GHS")
  })

  it("uses the stored home total for KPI sums", () => {
    expect(
      expenseHomeTotal(
        { total: 25, currency_code: "USD", fx_rate: 15, home_currency_total: 375.5 },
        "GHS"
      )
    ).toBe(375.5)
  })

  it("falls back to total times rate and never treats 25 USD as 25 GHS", () => {
    expect(expenseHomeTotal({ total: 25, currency_code: "USD", fx_rate: 15 }, "GHS")).toBe(375)
    expect(expenseHomeTotal({ total: 25, currency_code: "USD" }, "GHS")).toBeNull()
  })
})
