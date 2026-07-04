import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import { formatMoney } from "@/lib/money"
import { formatMoneyForContext } from "../formatCurrency"
import { resolveCurrencyCode, resolveCurrencyDisplay } from "../resolveCurrencyDisplay"
import { MOJIBAKE_GHS_CEDI } from "../normalizeCurrencySymbol"

describe("resolveCurrencyCode", () => {
  it("uses document currency_code when present", () => {
    expect(resolveCurrencyCode({ currency_code: "USD" })).toBe("USD")
  })

  it("uses business default_currency when document code is missing", () => {
    expect(resolveCurrencyCode({ default_currency: "KES" })).toBe("KES")
  })

  it("prefers document currency_code over default_currency", () => {
    expect(
      resolveCurrencyCode(
        { currency_code: "USD", default_currency: "GHS" },
        { default_currency: "EUR" }
      )
    ).toBe("USD")
  })

  it("falls back to platform default when all contexts are empty", () => {
    expect(resolveCurrencyCode(null, { currency_code: "" }, { default_currency: null })).toBe(
      DEFAULT_PLATFORM_CURRENCY_CODE
    )
  })
})

describe("formatMoneyForContext (proforma totals)", () => {
  it("formats with business default_currency when present", () => {
    expect(formatMoneyForContext(1250.5, { default_currency: "GHS" })).toBe("₵1,250.50")
  })

  it("formats with fallback currency when default_currency is missing", () => {
    expect(formatMoneyForContext(1250.5, { default_currency: null })).toBe("₵1,250.50")
    expect(formatMoneyForContext(1250.5, { currency_code: null })).toBe("₵1,250.50")
  })

  it("does not render em dash for valid numeric totals when currency is missing", () => {
    const formatted = formatMoneyForContext(99, { currency_code: null, default_currency: null })
    expect(formatted).not.toBe("—")
    expect(formatted).toBe("₵99.00")
  })

  it("still renders em dash when amount is invalid", () => {
    expect(formatMoneyForContext(null, { default_currency: "GHS" })).toBe("—")
    expect(formatMoneyForContext(undefined, { currency_code: "USD" })).toBe("—")
  })

  it("uses proforma row currency when set", () => {
    expect(
      formatMoneyForContext(
        500,
        { currency_code: "USD" },
        { default_currency: null }
      )
    ).toBe("$500.00")
  })
})

describe("resolveCurrencyDisplay (invoice/quote pattern unchanged)", () => {
  it("still falls back to GHS symbol when currency is missing", () => {
    expect(resolveCurrencyDisplay({ currency_code: null })).toBe("₵")
  })

  it("repairs corrupted stored GHS symbol using currency_code", () => {
    expect(
      resolveCurrencyDisplay({ currency_code: "GHS", currency_symbol: MOJIBAKE_GHS_CEDI })
    ).toBe("₵")
  })

  it("maps ISO code to symbol when stored symbol is absent", () => {
    expect(resolveCurrencyDisplay({ currency_code: "USD" })).toBe("$")
  })

  it("formatMoney without context still shows em dash for missing currency", () => {
    expect(formatMoney(100, null)).toBe("—")
  })
})
