import { decideReceiptCurrency } from "@/lib/ocr/receiptCurrencyMode"

describe("decideReceiptCurrency", () => {
  it("keeps home currency when the receipt matches the business", () => {
    expect(decideReceiptCurrency("GHS", "GHS")).toEqual({ action: "home" })
    expect(decideReceiptCurrency("ghs", "GHS")).toEqual({ action: "home" })
  })

  it("turns on foreign mode without inventing a rate", () => {
    expect(decideReceiptCurrency("USD", "GHS")).toEqual({ action: "foreign", currency: "USD" })
    expect(decideReceiptCurrency(" usd ", "ghs")).toEqual({ action: "foreign", currency: "USD" })
  })

  it("ignores a missing or non-ISO currency", () => {
    expect(decideReceiptCurrency(null, "GHS")).toEqual({ action: "ignore" })
    expect(decideReceiptCurrency(".", "GHS")).toEqual({ action: "ignore" })
  })
})
