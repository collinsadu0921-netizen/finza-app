/**
 * Parser tests for Africa-ready receipt OCR (suggestion-only).
 * Sample text blocks: Ghana, Nigeria, generic.
 */

import { describe, it, expect, beforeEach } from "@jest/globals"
import { parseReceiptText, setReceiptOcrProvider } from "../receiptOcr"

describe("receiptOcr parse", () => {
  beforeEach(() => {
    setReceiptOcrProvider({
      extractText: async () => "",
    })
  })

  it("extracts total and currency from Ghana receipt text", () => {
    const text = [
      "JSS LTD",
      "VAT 125.00",
      "NHIL 20.83",
      "GETFund 20.83",
      "TOTAL GHS 1000.00",
    ].join("\n")
    const { suggestions, confidence } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.total).toBe(1000)
    expect(suggestions.currency_code).toBe("GHS")
    expect(suggestions.vat_amount).toBe(125)
    expect(suggestions.nhil_amount).toBe(20.83)
    expect(suggestions.getfund_amount).toBe(20.83)
    expect(confidence.total).toBeDefined()
  })

  it("extracts total from Nigeria-style receipt", () => {
    const text = "Vendor Name\n₦ 5,500.00\nTOTAL 5500.00"
    const { suggestions } = parseReceiptText(text, "expense", "NGN")
    expect(suggestions.total).toBe(5500)
    expect(suggestions.currency_code).toBe("NGN")
  })

  it("extracts total from generic GHS line", () => {
    const text = "TOTAL GHS 120.00"
    const { suggestions } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.total).toBe(120)
    expect(suggestions.currency_code).toBe("GHS")
  })

  it("parses DD/MM/YYYY date", () => {
    const text = "Date: 29/01/2026\nTOTAL 100"
    const { suggestions, confidence } = parseReceiptText(text, "expense")
    expect(suggestions.document_date).toBe("2026-01-29")
    expect(confidence.document_date).toBeDefined()
  })

  it("parses YYYY-MM-DD date", () => {
    const text = "2026-01-29\nTOTAL 100"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.document_date).toBe("2026-01-29")
  })

  it("extracts document number", () => {
    const text = "Invoice No: INV-001\nTOTAL 50"
    const { suggestions } = parseReceiptText(text, "supplier_bill")
    expect(suggestions.document_number).toBe("INV-001")
  })

  it("extracts supplier from top lines and skips noise", () => {
    const text = "ACME Supplies Ltd\nReceipt\nTEL 123\nTOTAL 200"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.supplier_name).toBe("ACME Supplies Ltd")
  })

  it("defaults currency to businessCurrency when absent", () => {
    const text = "TOTAL 99.00"
    const { suggestions } = parseReceiptText(text, "expense", "KES")
    expect(suggestions.currency_code).toBe("KES")
  })

  it("computes subtotal when total and tax amounts present", () => {
    const text = "VAT 15\nNHIL 2.5\nGETFund 2.5\nTOTAL 100"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.total).toBe(100)
    expect(suggestions.vat_amount).toBe(15)
    expect(suggestions.nhil_amount).toBe(2.5)
    expect(suggestions.getfund_amount).toBe(2.5)
    expect(suggestions.subtotal).toBe(100 - 15 - 2.5 - 2.5)
  })

  it("GWCL-style receipt: supplier, document number, date, total, currency", () => {
    const text = [
      "GHANA WATER COMPANY LIMITED",
      "OFFICIAL RECEIPT #: 736853",
      "DATE : WED 25 SEPTEMBER, 2019",
      "AMOUNT: GH¢149.00",
    ].join("\n")
    const { suggestions, confidence } = parseReceiptText(text, "expense", "GHS")
    expect(suggestions.supplier_name).toBe("GHANA WATER COMPANY LIMITED")
    expect(suggestions.document_number).toBe("736853")
    expect(suggestions.document_date).toBe("2019-09-25")
    expect(suggestions.total).toBe(149)
    expect(suggestions.currency_code).toBe("GHS")
    expect(confidence.total).toBeDefined()
  })

  it("parses ₵1,000.00 (cedi symbol)", () => {
    const text = "TOTAL ₵1,000.00"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.total).toBe(1000)
    expect(suggestions.currency_code).toBe("GHS")
  })

  it("parses GHS 120 without decimals", () => {
    const text = "Amount GHS 120"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.total).toBe(120)
  })

  it("parses date 27/01/2026", () => {
    const text = "27/01/2026\nTOTAL 50"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.document_date).toBe("2026-01-27")
  })

  it("multiple totals: prefers AMOUNT or largest near TOTAL/AMOUNT", () => {
    const text = "Subtotal 80\nVAT 12\nAMOUNT: GH¢92.00\nTendered 100\nChange 8"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.total).toBe(92)
  })

  it("date WED 25 SEPTEMBER 2019 without comma", () => {
    const text = "DATE : WED 25 SEPTEMBER 2019\nAMOUNT 100"
    const { suggestions } = parseReceiptText(text, "expense")
    expect(suggestions.document_date).toBe("2019-09-25")
  })
})
