import { ESCPOSGenerator, formatReceiptTaxAmountLine, generateReceiptHTML, type ReceiptData } from "@/lib/escpos"
import { mapRetailReceiptApiToEscpos, type RetailReceiptApiBody } from "@/app/retail/lib/mapRetailReceiptApiToEscpos"
import { formatStoredTaxPercentLabel, getGhanaLegacyRates } from "@/lib/taxes/readTaxLines"
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

function baseApiBody(tax_lines: unknown): RetailReceiptApiBody {
  return {
    sale: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      amount: 11.75,
      created_at: "2026-09-15T12:00:00.000Z",
      payment_method: "cash",
      tax_lines,
    },
    sale_items: [{ product_name: "Bottled water", quantity: 2, unit_price: 5, line_total: 10 }],
    business: { name: "Test Shop" },
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

describe("receipt tax percentages from stored rates", () => {
  it("formats stored rates without inventing schedule values", () => {
    expect(formatStoredTaxPercentLabel(0.025)).toBe("2.5%")
    expect(formatStoredTaxPercentLabel(0.15)).toBe("15%")
    expect(formatStoredTaxPercentLabel(0.01)).toBe("1%")
    expect(formatStoredTaxPercentLabel(null)).toBeNull()
    expect(formatReceiptTaxAmountLine("NHIL", 0.15, "GHS", 0.025)).toBe("NHIL (2.5%): GHS 0.15")
    expect(formatReceiptTaxAmountLine("VAT", 1.5, "GHS", undefined)).toBe("VAT: GHS 1.50")
  })

  it("matches rates by tax code, not array position", () => {
    const rates = getGhanaLegacyRates({
      tax_lines: [
        { code: "GETFUND", amount: 0.1, rate: 0.025 },
        { code: "VAT", amount: 1.5, rate: 0.15 },
        { code: "NHIL", amount: 0.15, rate: 0.025 },
      ],
    })
    expect(rates).toEqual({ vat: 0.15, nhil: 0.025, getfund: 0.025 })
  })

  it("returns null rates when historical lines omit rate", () => {
    expect(
      getGhanaLegacyRates({
        lines: [
          { code: "NHIL", amount: 0.15 },
          { code: "VAT", amount: 1.5, rate: 0.15 },
        ],
      })
    ).toEqual({ vat: 0.15, nhil: null, getfund: null })
  })

  it("maps different stored rates into ReceiptData without changing amounts", () => {
    const data = mapRetailReceiptApiToEscpos(
      baseApiBody({
        tax_lines: [
          { code: "NHIL", name: "NHIL", rate: 0.03, amount: 0.2 },
          { code: "GETFUND", name: "GETFund", rate: 0.02, amount: 0.12 },
          { code: "VAT", name: "VAT", rate: 0.125, amount: 1.0 },
        ],
      }),
      "GHS",
      "₵"
    )
    expect(data.nhil).toBe(0.2)
    expect(data.getfund).toBe(0.12)
    expect(data.vat).toBe(1.0)
    expect(data.nhilRate).toBe(0.03)
    expect(data.getfundRate).toBe(0.02)
    expect(data.vatRate).toBe(0.125)
    expect(data.totalPayable).toBe(11.75)
  })

  it("omits rate fields when tax_lines lack rates (amount-only labels)", () => {
    const data = mapRetailReceiptApiToEscpos(
      baseApiBody({
        lines: [
          { code: "NHIL", amount: 0.15 },
          { code: "GETFUND", amount: 0.1 },
          { code: "VAT", amount: 1.5 },
        ],
      }),
      "GHS",
      "₵"
    )
    expect(data.nhil).toBe(0.15)
    expect(data.nhilRate).toBeUndefined()
    expect(data.getfundRate).toBeUndefined()
    expect(data.vatRate).toBeUndefined()
  })

  it("shows percentages in HTML and ESC/POS with parity; keeps monetary totals", () => {
    const withRates = sampleReceipt({
      nhilRate: 0.025,
      getfundRate: 0.025,
      vatRate: 0.15,
    })
    const html = generateReceiptHTML(withRates, {
      width: "58mm",
      mode: "full",
      showLogo: false,
      showQR: false,
    })
    expect(html).toContain("NHIL (2.5%): GHS 0.15")
    expect(html).toContain("GETFund (2.5%): GHS 0.10")
    expect(html).toContain("VAT (15%): GHS 1.50")
    expect(html).toContain("Total: GHS 11.75")
    expect(html).toContain("Total Tax (included): GHS 1.75")

    const esc = new TextDecoder().decode(new ESCPOSGenerator("58mm").generate(withRates))
    expect(esc).toContain("NHIL (2.5%): GHS 0.15")
    expect(esc).toContain("GETFund (2.5%): GHS 0.10")
    expect(esc).toContain("VAT (15%): GHS 1.50")
    expect(esc).toContain("Total: GHS 11.75")

    const line = formatReceiptTaxAmountLine("NHIL", 0.15, "GHS", 0.025)
    expect(line.length).toBeLessThanOrEqual(32)
  })

  it("keeps amount-only labels when rates are missing on ReceiptData", () => {
    const html = generateReceiptHTML(sampleReceipt(), {
      width: "58mm",
      mode: "full",
      showLogo: false,
      showQR: false,
    })
    expect(html).toContain("NHIL: GHS 0.15")
    expect(html).not.toContain("NHIL (")
    const esc = new TextDecoder().decode(new ESCPOSGenerator("58mm").generate(sampleReceipt()))
    expect(esc).toContain("NHIL: GHS 0.15")
    expect(esc).not.toContain("NHIL (")
  })

  it("does not show tax block for exempt / zero-tax receipts", () => {
    const html = generateReceiptHTML(
      sampleReceipt({ vat: 0, nhil: 0, getfund: 0, vatRate: 0.15 }),
      { width: "58mm", mode: "full", showLogo: false, showQR: false }
    )
    expect(html).not.toContain("Tax Breakdown")
    expect(html).not.toContain("VAT")
  })
})
