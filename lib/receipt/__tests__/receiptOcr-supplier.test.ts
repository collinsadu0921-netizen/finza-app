/**
 * Regression tests for supplier_name extraction (address vs business name).
 */

import { describe, it, expect, beforeEach } from "@jest/globals"
import { parseReceiptText, setReceiptOcrProvider } from "../receiptOcr"

describe("receiptOcr supplier_name heuristics", () => {
  beforeEach(() => {
    setReceiptOcrProvider({ extractText: async () => "" })
  })

  it("prefers business name over following street address", () => {
    const text = [
      "SUNRISE ENTERPRISES LIMITED",
      "Plot 14 Independence Avenue, East Legon",
      "Accra, Ghana",
      "Tel: +233 24 555 1212",
      "TOTAL GHS 450.00",
    ].join("\n")
    const { suggestions } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBe("SUNRISE ENTERPRISES LIMITED")
  })

  it("does not pick street line when it appears first (OCR order) if a legal name follows", () => {
    const text = [
      "15 Ring Road East, Osu",
      "ACME TRADING LTD",
      "DATE 01/02/2026",
      "TOTAL GHS 88.00",
    ].join("\n")
    const { suggestions } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBe("ACME TRADING LTD")
  })

  it("skips email and phone lines as supplier", () => {
    const text = [
      "Blue Wave Services Ltd",
      "info@bluewave.example.com",
      "+233 20 123 4567",
      "TOTAL GHS 50",
    ].join("\n")
    const { suggestions } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBe("Blue Wave Services Ltd")
  })

  it("uses Merchant: label value when present", () => {
    const text = [
      "Receipt # 9001",
      "Merchant: Peak Logistics Ghana Ltd",
      "12 Spintex Road",
      "TOTAL GHS 300",
    ].join("\n")
    const { suggestions } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBe("Peak Logistics Ghana Ltd")
  })

  it("Finza-branded service receipt: prefers early non-Finza business line over address", () => {
    const text = [
      "Finza",
      "Payment receipt",
      "NORTH RIDGE AUTO PARTS",
      "No. 8 Kanda Highway, Accra",
      "support@finza.example",
      "TOTAL GHS 120.00",
    ].join("\n")
    const { suggestions } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBe("NORTH RIDGE AUTO PARTS")
  })

  it("fallback picks first plausible line when no legal suffix (sole trader)", () => {
    const text = ["Kwesi Mobile Repairs", "TOTAL GHS 25"].join("\n")
    const { suggestions, confidence } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBe("Kwesi Mobile Repairs")
    expect(confidence.supplier_name).toBeDefined()
  })

  it("does not use city, country line as supplier", () => {
    const text = ["Kumasi, Ghana", "VAT 10", "TOTAL GHS 40"].join("\n")
    const { suggestions } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBeUndefined()
  })
})
