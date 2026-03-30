/**
 * Unit tests for lib/money.ts
 * 
 * Tests validate money formatting with both regex patterns (for structure)
 * and exact matching (for correctness). Since formatMoney uses Intl.NumberFormat
 * with fixed 'en-US' locale, output is deterministic: 1,234.56 format.
 */

import { formatMoney, formatMoneyWithCode, formatMoneyWithSymbol } from "../money"

/**
 * Validates money format structure with regex and exact value
 * Since locale is fixed to 'en-US', we can use exact matching for determinism
 * while regex provides additional resilience
 */
function validateMoneyFormat(
  actual: string,
  expectedSymbol: string,
  expectedValue: number,
  options?: { allowNegative?: boolean; decimalPlaces?: number; useGrouping?: boolean }
) {
  const { allowNegative = false, decimalPlaces = 2, useGrouping = true } = options || {}
  
  // Regex validation: ensures structure is correct (symbol + number format)
  const escapedSymbol = expectedSymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const signPattern = allowNegative ? "-?" : ""
  const groupingPattern = useGrouping ? "(?:\\d{1,3}(?:,\\d{3})*|\\d+)" : "\\d+"
  const decimalPattern = decimalPlaces > 0 ? `\\.\\d{${decimalPlaces}}` : ""
  const regex = new RegExp(`^${signPattern}${escapedSymbol}${groupingPattern}${decimalPattern}$`)
  
  expect(actual).toMatch(regex)
  
  // Exact match validation: ensures deterministic output (locale is fixed to en-US)
  const expected = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
    useGrouping,
  }).format(Math.abs(expectedValue))
  
  const sign = expectedValue < 0 ? "-" : ""
  expect(actual).toBe(`${sign}${expectedSymbol}${expected}`)
}

/**
 * Validates money format with currency code
 */
function validateMoneyFormatWithCode(
  actual: string,
  expectedCode: string,
  expectedValue: number,
  options?: { allowNegative?: boolean }
) {
  const { allowNegative = false } = options || {}
  
  // Regex validation
  const signPattern = allowNegative ? "-?" : ""
  const regex = new RegExp(`^${expectedCode} ${signPattern}(?:\\d{1,3}(?:,\\d{3})*|\\d+)\\.\\d{2}$`)
  expect(actual).toMatch(regex)
  
  // Exact match validation
  const expected = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(Math.abs(expectedValue))
  
  const sign = expectedValue < 0 ? "-" : ""
  expect(actual).toBe(`${expectedCode} ${sign}${expected}`)
}

describe("formatMoney", () => {
  describe("with valid currency codes", () => {
    it("formats USD correctly", () => {
      const result = formatMoney(1234.56, "USD")
      validateMoneyFormat(result, "$", 1234.56)
    })

    it("formats GHS correctly", () => {
      const result = formatMoney(1234.56, "GHS")
      validateMoneyFormat(result, "₵", 1234.56)
    })

    it("formats KES correctly", () => {
      const result = formatMoney(1234.56, "KES")
      validateMoneyFormat(result, "KSh", 1234.56)
    })

    it("formats EUR correctly", () => {
      const result = formatMoney(1234.56, "EUR")
      validateMoneyFormat(result, "€", 1234.56)
    })

    it("formats GBP correctly", () => {
      const result = formatMoney(1234.56, "GBP")
      validateMoneyFormat(result, "£", 1234.56)
    })
  })

  describe("with null/undefined currency", () => {
    it("returns placeholder for null currency", () => {
      expect(formatMoney(1234.56, null)).toBe("—")
    })

    it("returns placeholder for undefined currency", () => {
      expect(formatMoney(1234.56, undefined)).toBe("—")
    })

    it("returns placeholder for empty string currency", () => {
      expect(formatMoney(1234.56, "")).toBe("—")
    })
  })

  describe("with null/undefined amount", () => {
    it("returns placeholder for null amount", () => {
      expect(formatMoney(null, "USD")).toBe("—")
    })

    it("returns placeholder for undefined amount", () => {
      expect(formatMoney(undefined, "USD")).toBe("—")
    })

    it("returns placeholder for NaN amount", () => {
      expect(formatMoney(NaN, "USD")).toBe("—")
    })
  })

  describe("with negative values", () => {
    it("formats negative amounts correctly", () => {
      const result = formatMoney(-1234.56, "USD")
      validateMoneyFormat(result, "$", -1234.56, { allowNegative: true })
    })

    it("formats negative amounts with GHS correctly", () => {
      const result = formatMoney(-1234.56, "GHS")
      validateMoneyFormat(result, "₵", -1234.56, { allowNegative: true })
    })
  })

  describe("with decimal precision", () => {
    it("formats with 2 decimal places by default", () => {
      const result = formatMoney(1234.5, "USD")
      validateMoneyFormat(result, "$", 1234.5)
    })

    it("formats whole numbers with 2 decimal places", () => {
      const result = formatMoney(1234, "USD")
      validateMoneyFormat(result, "$", 1234)
    })

    it("formats with custom decimal places", () => {
      const result = formatMoney(1234.5678, "USD", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
      validateMoneyFormat(result, "$", 1234.5678, { decimalPlaces: 4 })
    })
  })

  describe("with grouping", () => {
    it("uses thousands separator by default", () => {
      const result = formatMoney(1234567.89, "USD")
      validateMoneyFormat(result, "$", 1234567.89)
    })

    it("can disable grouping", () => {
      const result = formatMoney(1234567.89, "USD", { useGrouping: false })
      validateMoneyFormat(result, "$", 1234567.89, { useGrouping: false })
    })
  })

  describe("with custom placeholder", () => {
    it("uses custom placeholder for missing currency", () => {
      expect(
        formatMoney(1234.56, null, { missingPlaceholder: "N/A" })
      ).toBe("N/A")
    })
  })
})

describe("formatMoneyWithCode", () => {
  it("formats USD using symbol", () => {
    const result = formatMoneyWithCode(1234.56, "USD")
    validateMoneyFormat(result, "$", 1234.56)
  })

  it("formats GHS using cedi symbol", () => {
    const result = formatMoneyWithCode(1234.56, "GHS")
    validateMoneyFormat(result, "₵", 1234.56)
  })

  it("formats KES using symbol", () => {
    const result = formatMoneyWithCode(1234.56, "KES")
    validateMoneyFormat(result, "KSh", 1234.56)
  })

  it("formats unknown ISO code with code prefix", () => {
    const result = formatMoneyWithCode(1234.56, "XPD")
    validateMoneyFormatWithCode(result, "XPD", 1234.56)
  })

  it("returns placeholder for null currency", () => {
    expect(formatMoneyWithCode(1234.56, null)).toBe("—")
  })

  it("returns placeholder for null amount", () => {
    expect(formatMoneyWithCode(null, "USD")).toBe("—")
  })

  it("formats negative amounts with symbol", () => {
    const result = formatMoneyWithCode(-1234.56, "USD")
    validateMoneyFormat(result, "$", -1234.56, { allowNegative: true })
  })

  it("formats negative GHS with cedi symbol", () => {
    const result = formatMoneyWithCode(-1234.56, "GHS")
    validateMoneyFormat(result, "₵", -1234.56, { allowNegative: true })
  })
})

describe("formatMoneyWithSymbol", () => {
  it("formats with custom symbol", () => {
    const result = formatMoneyWithSymbol(1234.56, "₵")
    validateMoneyFormat(result, "₵", 1234.56)
  })

  it("formats with dollar sign", () => {
    const result = formatMoneyWithSymbol(1234.56, "$")
    validateMoneyFormat(result, "$", 1234.56)
  })

  it("returns placeholder for null amount", () => {
    expect(formatMoneyWithSymbol(null, "$")).toBe("—")
  })

  it("formats negative amounts", () => {
    const result = formatMoneyWithSymbol(-1234.56, "$")
    validateMoneyFormat(result, "$", -1234.56, { allowNegative: true })
  })

  it("uses custom placeholder", () => {
    expect(
      formatMoneyWithSymbol(null, "$", { missingPlaceholder: "N/A" })
    ).toBe("N/A")
  })
})

