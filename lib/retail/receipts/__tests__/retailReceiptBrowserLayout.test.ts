import {
  RETAIL_RECEIPT_58MM_ADDRESS_LINE_CHARS,
  compact58mmAddressLines,
  formatBrowserPrintItemAmountLine,
  formatReceiptEmailWithSoftBreaks,
  formatReceiptQuantity,
} from "@/lib/retail/receipts/retailReceiptBrowserLayout"

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

describe("58mm Browser Print layout helpers", () => {
  it("preserves decimal quantities and drops only trailing zeros", () => {
    expect(formatReceiptQuantity(1)).toBe("1")
    expect(formatReceiptQuantity(2)).toBe("2")
    expect(formatReceiptQuantity(2.5)).toBe("2.5")
    expect(formatReceiptQuantity(1.25)).toBe("1.25")
    expect(formatReceiptQuantity(1.5)).toBe("1.5")
  })

  it("formats product lines as quantity × unit price = line total", () => {
    expect(formatBrowserPrintItemAmountLine(1, 5, 5, "GHS")).toBe("1 × GHS 5.00 = GHS 5.00")
    expect(formatBrowserPrintItemAmountLine(2, 10, 20, "GHS")).toBe("2 × GHS 10.00 = GHS 20.00")
    expect(formatBrowserPrintItemAmountLine(2.5, 8, 20, "GHS")).toBe("2.5 × GHS 8.00 = GHS 20.00")
    expect(formatBrowserPrintItemAmountLine(1, 5, 5, "GHS")).not.toContain("Qty:")
  })

  it("joins city and country on one line only when they fit", () => {
    expect(compact58mmAddressLines("No. 10 Giffard Road\nAccra\nGH")).toEqual([
      "No. 10 Giffard Road",
      "Accra, GH",
    ])
    expect(compact58mmAddressLines("12 High St\nAccra\nGhana")).toEqual(["12 High St", "Accra, Ghana"])
    expect(compact58mmAddressLines("No. 10 Giffard Road\nAccra")).toEqual([
      "No. 10 Giffard Road",
      "Accra",
    ])

    const city = "A".repeat(RETAIL_RECEIPT_58MM_ADDRESS_LINE_CHARS - "Ghana".length - 2)
    expect(compact58mmAddressLines(`Street 1\n${city}\nGhana`)).toEqual([
      "Street 1",
      `${city}, Ghana`,
    ])
    const tooLong = "A".repeat(RETAIL_RECEIPT_58MM_ADDRESS_LINE_CHARS)
    expect(compact58mmAddressLines(`Street 1\n${tooLong}\nGhana`)).toEqual([
      "Street 1",
      tooLong,
      "Ghana",
    ])
  })

  it("inserts soft breaks at @ and dots and escapes the address", () => {
    expect(formatReceiptEmailWithSoftBreaks("retail.hardware.uat@example.invalid", escapeHtml)).toBe(
      "retail.<wbr>hardware.<wbr>uat@<wbr>example.<wbr>invalid"
    )
    expect(formatReceiptEmailWithSoftBreaks("a<b>@c.test", escapeHtml)).toBe("a&lt;b&gt;@<wbr>c.<wbr>test")
  })
})
