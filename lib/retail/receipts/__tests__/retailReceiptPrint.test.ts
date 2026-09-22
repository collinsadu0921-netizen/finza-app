import { ESCPOSGenerator, formatReceiptTaxAmountLine, generateReceiptHTML, type ReceiptData } from "@/lib/escpos"
import { mapRetailReceiptApiToEscpos, type RetailReceiptApiBody } from "@/app/retail/lib/mapRetailReceiptApiToEscpos"
import { formatStoredTaxPercentLabel, getGhanaLegacyRates } from "@/lib/taxes/readTaxLines"
import {
  RETAIL_RECEIPT_FORBIDDEN_PRINT_COLORS,
  RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM,
  RETAIL_RECEIPT_58MM_LEFT_OFFSET_MM,
  RETAIL_RECEIPT_58MM_TEAR_FEED_MM,
  RETAIL_RECEIPT_58MM_TEAR_FEED_LINE_COUNT,
  RETAIL_RECEIPT_58MM_TEAR_FEED_LINE_HEIGHT_MM,
  retailReceiptDocumentCss,
  retailReceipt58mmTearFeedHtml,
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

  it("sizes 58mm Browser Print to CUPS-safe printable width and tear feed", () => {
    const css58 = retailReceiptDocumentCss(true)
    expect(css58).toContain(`width: ${RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM}mm`)
    expect(css58).toContain(`max-width: ${RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM}mm`)
    expect(css58).toContain(`margin: 0 0 0 ${RETAIL_RECEIPT_58MM_LEFT_OFFSET_MM}mm`)
    expect(css58).toContain("box-sizing: border-box")
    expect(css58).toContain("overflow-wrap: anywhere")
    expect(css58).toContain(".receipt-tear-feed")
    expect(css58).toContain(".receipt-tear-feed-line")
    expect(css58).toContain(`height: ${RETAIL_RECEIPT_58MM_TEAR_FEED_MM}mm`)
    expect(css58).toContain(`min-height: ${RETAIL_RECEIPT_58MM_TEAR_FEED_MM}mm`)
    expect(css58).toContain(`height: ${RETAIL_RECEIPT_58MM_TEAR_FEED_LINE_HEIGHT_MM}mm`)
    expect(css58).toContain("color: #fff")
    // Must not recreate the old content-box 58mm+8mm padding oversize trap
    expect(css58).not.toMatch(/body\s*\{[^}]*padding:\s*8mm/)
    // Must not centre a too-wide column (left clip regression)
    expect(css58).not.toMatch(/\.receipt\s*\{[^}]*margin:\s*0 auto/)
  })

  it("does not change 80mm body padding / width contract", () => {
    const css80 = retailReceiptDocumentCss(false)
    expect(css80).toContain("padding: 8mm")
    expect(css80).toContain("width: 80mm")
    expect(css80).not.toContain("receipt-tear-feed")
    expect(css80).not.toContain("45mm")
    expect(css80).not.toContain("48mm")
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

describe("58mm Browser Print layout for Linux CUPS / POS58", () => {
  it("embeds 58mm CSS content width, left offset, overflow wrap, and non-empty tear feed", () => {
    const html = generateReceiptHTML(
      sampleReceipt({
        businessName: "Finza Retail Hardware Test",
        businessEmail: "verylong.email.address@example-business-domain.com",
        paymentMethod: "Mobile money",
        footerText: "Thank you",
        qrCodeContent: "550e8400-e29b-41d4-a716-446655440000",
      }),
      {
        width: "58mm",
        mode: "full",
        showLogo: false,
        showQR: true,
        footerText: "Thank you",
        qrImageDataUrl: "data:image/png;base64,AAA",
      }
    )
    expect(html).toContain("Finza Retail Hardware Test")
    expect(html).toContain("Mobile money")
    expect(html).toContain("Thank you")
    expect(html).toContain("receipt-tear-feed")
    expect(html).toContain("receipt-tear-feed-line")
    expect(html).toContain("&nbsp;")
    expect(html).toContain("receipt-qr-img")
    expect(html).toContain(`width: ${RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM}mm`)
    expect(html).toContain(`margin: 0 0 0 ${RETAIL_RECEIPT_58MM_LEFT_OFFSET_MM}mm`)
    expect(html).toContain("overflow-wrap: anywhere")
    expect(html).toContain(`height: ${RETAIL_RECEIPT_58MM_TEAR_FEED_MM}mm`)
    expect(html).toContain(`min-height: ${RETAIL_RECEIPT_58MM_TEAR_FEED_MM}mm`)
    // Footer then tear feed (thank-you clears tear bar in same job)
    const footerIdx = html.indexOf('<div class="footer">')
    const tearIdx = html.indexOf('class="receipt-tear-feed"')
    const qrIdx = html.indexOf("receipt-qr-img")
    expect(qrIdx).toBeGreaterThan(-1)
    expect(footerIdx).toBeGreaterThan(qrIdx)
    expect(tearIdx).toBeGreaterThan(footerIdx)
    expect(html).toContain('width="112"')
    // Count markup lines only (CSS also mentions .receipt-tear-feed-line)
    const lineMatches = html.match(/class="receipt-tear-feed-line"/g) || []
    expect(lineMatches.length).toBe(RETAIL_RECEIPT_58MM_TEAR_FEED_LINE_COUNT)
  })

  it("tear-feed helper emits non-empty line boxes totaling the feed height", () => {
    const feed = retailReceipt58mmTearFeedHtml()
    expect(feed).toContain("receipt-tear-feed-line")
    expect(feed).toContain("&nbsp;")
    expect(feed.match(/receipt-tear-feed-line/g)?.length).toBe(
      RETAIL_RECEIPT_58MM_TEAR_FEED_LINE_COUNT
    )
    expect(
      RETAIL_RECEIPT_58MM_TEAR_FEED_LINE_COUNT * RETAIL_RECEIPT_58MM_TEAR_FEED_LINE_HEIGHT_MM
    ).toBe(RETAIL_RECEIPT_58MM_TEAR_FEED_MM)
  })

  it("does not add tear feed or 45mm column to 80mm HTML", () => {
    const html = generateReceiptHTML(sampleReceipt({ footerText: "Thank you" }), {
      width: "80mm",
      mode: "full",
      showLogo: false,
      showQR: true,
      footerText: "Thank you",
      qrImageDataUrl: "data:image/png;base64,AAA",
    })
    expect(html).not.toContain("receipt-tear-feed")
    expect(html).not.toContain("45mm")
    expect(html).not.toContain("48mm")
    expect(html).toContain("width: 80mm")
    expect(html).toContain('width="168"')
  })

  it("Hardware Test and sale receipts share generateReceiptHTML + 58mm CSS path", () => {
    const hardwareTest = generateReceiptHTML(
      sampleReceipt({ businessName: "Finza Retail Hardware Test", footerText: "Thank you" }),
      { width: "58mm", mode: "full", showLogo: false, showQR: false, footerText: "Thank you" }
    )
    const sale = generateReceiptHTML(sampleReceipt({ footerText: "Thank you" }), {
      width: "58mm",
      mode: "full",
      showLogo: false,
      showQR: false,
      footerText: "Thank you",
    })
    expect(sale).toContain("receipt-tear-feed-line")
    expect(hardwareTest).toContain("receipt-tear-feed-line")
    expect(sale).toContain(`width: ${RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM}mm`)
    expect(hardwareTest).toContain(`width: ${RETAIL_RECEIPT_58MM_CONTENT_WIDTH_MM}mm`)
    expect(sale).toContain(`margin: 0 0 0 ${RETAIL_RECEIPT_58MM_LEFT_OFFSET_MM}mm`)
  })
})
