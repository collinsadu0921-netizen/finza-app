import { generateReceiptHTML, type ReceiptData } from "@/lib/escpos"
import {
  RETAIL_RECEIPT_FORBIDDEN_PRINT_COLORS,
  retailReceiptDocumentCss,
} from "@/lib/retail/receipts/retailReceiptPrintCss"

function sampleReceipt(overrides: Partial<ReceiptData> = {}): ReceiptData {
  return {
    businessName: "Test Shop",
    receiptNumber: "ABC12345...00000",
    dateTime: "14 Sep 2026, 12:00",
    cashierName: "Ada",
    items: [
      {
        name: "Bottled water",
        quantity: 2,
        unitPrice: 5,
        lineTotal: 10,
        lineDiscountAmount: 0.5,
      },
    ],
    subtotal: 10,
    totalPayable: 11.75,
    paymentMethod: "Cash",
    amountTendered: 20,
    changeGiven: 8.25,
    vat: 1.5,
    nhil: 0.15,
    getfund: 0.1,
    vatInclusive: true,
    currencyCode: "GHS",
    currencySymbol: "₵",
    footerText: "Thank you for your purchase.",
    qrCodeContent: "550e8400-e29b-41d4-a716-446655440000",
    ...overrides,
  }
}

function assertNoPalePrintColors(html: string) {
  for (const token of RETAIL_RECEIPT_FORBIDDEN_PRINT_COLORS) {
    expect(html.toLowerCase()).not.toContain(token.toLowerCase())
  }
}

describe("retail thermal receipt HTML", () => {
  const widths = ["58mm", "80mm"] as const

  it.each(widths)("prints %s sale receipts in solid black", (width) => {
    const html = generateReceiptHTML(sampleReceipt(), {
      width,
      mode: "full",
      showLogo: true,
      showQR: true,
      footerText: "Thank you for your purchase.",
      qrImageDataUrl: "data:image/png;base64,AAA",
    })
    expect(html).toContain(width)
    expect(html).toContain("Bottled water")
    expect(html).toContain("GHS 11.75")
    expect(html).toContain("NHIL: GHS 0.15")
    expect(html).toContain("GETFund: GHS 0.10")
    expect(html).toContain("VAT: GHS 1.50")
    expect(html).toContain("Amount tendered (cash): GHS 20.00")
    expect(html).toContain("Change: GHS 8.25")
    expect(html).toContain("Thank you for your purchase.")
    expect(html).toContain("receipt-qr-img")
    expect(html).toContain("font-weight: 700")
    expect(html).toContain("color: #000")
    expect(html).toContain("-webkit-font-smoothing: none")
    expect(html).toContain("receipt-header-logo")
    assertNoPalePrintColors(html)
  })

  it.each(widths)("prints %s compact receipts without grey item rows", (width) => {
    const html = generateReceiptHTML(sampleReceipt(), {
      width,
      mode: "compact",
      showLogo: false,
      showQR: false,
      footerText: "Come again",
    })
    expect(html).toContain("item-compact")
    expect(html).toContain("Bottled water x2")
    expect(html).toContain("Come again")
    assertNoPalePrintColors(html)
  })

  it("prints refund/void banners in black, not red", () => {
    const html = generateReceiptHTML(
      sampleReceipt({ saleStatusBanner: "REFUNDED" }),
      {
        width: "80mm",
        mode: "full",
        showLogo: false,
        showQR: false,
      }
    )
    expect(html).toContain("REFUNDED")
    expect(html).toContain("status-banner")
    expect(html).not.toContain("#900")
    expect(html).not.toContain("#fee")
    assertNoPalePrintColors(html)
  })

  it("prints split payment lines and keeps totals unchanged", () => {
    const html = generateReceiptHTML(
      sampleReceipt({
        paymentMethod: "Split payment",
        paymentBreakdown: [
          { method: "cash", amount: 5 },
          { method: "momo", amount: 6.75 },
        ],
        amountTendered: 5,
        changeGiven: 0,
      }),
      {
        width: "80mm",
        mode: "full",
        showLogo: false,
        showQR: true,
        qrImageDataUrl: "data:image/png;base64,AAA",
      }
    )
    expect(html).toContain("Payment breakdown")
    expect(html).toContain("Cash: GHS 5.00")
    expect(html).toContain("Mobile money: GHS 6.75")
    expect(html).toContain("Total: GHS 11.75")
    expect(html).toContain("receipt-qr-img")
    assertNoPalePrintColors(html)
  })

  it("keeps 58mm and 80mm page sizes distinct", () => {
    const css58 = retailReceiptDocumentCss(true)
    const css80 = retailReceiptDocumentCss(false)
    expect(css58).toContain("58mm")
    expect(css80).toContain("80mm")
    expect(css58).not.toContain("80mm")
    expect(css80).not.toContain("58mm")
    expect(css58).toContain("@media print")
    expect(css80).toContain("filter: grayscale(1)")
  })
})
