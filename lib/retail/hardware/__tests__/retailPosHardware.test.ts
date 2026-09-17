import { readFileSync } from "fs"
import { join } from "path"
import {
  SEGMENTED_AMOUNT_SERIAL,
  SEGMENTED_AMOUNT_MAX_CHARS,
  amountFitsSegmentedDisplay,
  buildSegmentedAmountBytes,
  formatSegmentedAmount,
  resolveCustomerDisplayIntent,
  segmentedAmountBytesToAscii,
  shouldWriteCustomerDisplay,
} from "@/lib/retail/hardware/customerDisplayProtocol"
import { writeCustomerDisplayAmount } from "@/lib/retail/hardware/retailPosHardware"
import { generateReceiptHTML, type ReceiptData } from "@/lib/escpos"
import { retailReceiptDocumentCss } from "@/lib/retail/receipts/retailReceiptPrintCss"

const repoRoot = join(__dirname, "../../../..")

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8")
}

function sampleReceipt(): ReceiptData {
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
  }
}

describe("segmented numeric customer display", () => {
  it("uses the sales-default serial settings (9600 8N1) while diagnostics offer other baud rates", () => {
    expect(SEGMENTED_AMOUNT_SERIAL).toEqual({
      baudRate: 9600,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    })
    expect(readRepo("lib/retail/hardware/webSerialPort.ts")).toContain("SEGMENTED_AMOUNT_SERIAL")
    expect(readRepo("components/ReceiptPrinter.tsx")).toContain("drawer_kick: false")
  })

  it("formats amounts within the 8-character width using digits and a decimal point only", () => {
    expect(formatSegmentedAmount(0)).toBe("0.00")
    expect(formatSegmentedAmount(12)).toBe("12.00")
    expect(formatSegmentedAmount(435)).toBe("435.00")
    expect(formatSegmentedAmount(12.5)).toBe("12.50")
    expect(formatSegmentedAmount(99999.99)).toBe("99999.99")
    expect(formatSegmentedAmount(100000)).toBe("99999.99")
    expect(formatSegmentedAmount(0).length).toBeLessThanOrEqual(SEGMENTED_AMOUNT_MAX_CHARS)
    expect(formatSegmentedAmount(435).length).toBeLessThanOrEqual(SEGMENTED_AMOUNT_MAX_CHARS)
    expect(amountFitsSegmentedDisplay(435)).toBe(true)
  })

  it("does not send currency text, product names, or VFD/ESC control bytes", () => {
    for (const amount of [0, 12, 435, 8.25]) {
      const ascii = segmentedAmountBytesToAscii(buildSegmentedAmountBytes(amount))
      expect(ascii).toMatch(/^[0-9.]+$/)
      expect(ascii).not.toMatch(/GHS|₵|THANK|AMOUNT|Ada|water/i)
      const bytes = Array.from(buildSegmentedAmountBytes(amount))
      expect(bytes).not.toContain(0x1b)
      expect(bytes).not.toContain(0x40)
      expect(bytes).not.toContain(0x0c)
      expect(bytes).not.toContain(0x0d)
      expect(bytes).not.toContain(0x0a)
      expect(bytes).not.toContain(0x70)
    }
  })

  it("produces exact ASCII bytes for the physical-test amounts", () => {
    expect(Array.from(buildSegmentedAmountBytes(0))).toEqual([0x30, 0x2e, 0x30, 0x30])
    expect(Array.from(buildSegmentedAmountBytes(12))).toEqual([0x31, 0x32, 0x2e, 0x30, 0x30])
    expect(Array.from(buildSegmentedAmountBytes(435))).toEqual([0x34, 0x33, 0x35, 0x2e, 0x30, 0x30])
    expect(Array.from(buildSegmentedAmountBytes(0))).toEqual(Array.from(buildSegmentedAmountBytes(0.0)))
  })

  it("updates the running basket total while connected", () => {
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 2,
        runningTotal: 12,
        checkoutOpen: false,
        saleSuccess: null,
        autoUpdatesAllowed: true,
      })
    ).toEqual({ action: "write", amount: 12 })
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 3,
        runningTotal: 435,
        checkoutOpen: true,
        saleSuccess: null,
        autoUpdatesAllowed: true,
      })
    ).toEqual({ action: "write", amount: 435 })
  })

  it("resets to 0.00 after cancel (empty cart) and after non-cash completion", () => {
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 0,
        runningTotal: 0,
        checkoutOpen: false,
        saleSuccess: null,
        autoUpdatesAllowed: true,
      })
    ).toEqual({ action: "write", amount: 0 })
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 0,
        runningTotal: 0,
        checkoutOpen: false,
        saleSuccess: { cashReceived: 0, changeGiven: 0 },
        autoUpdatesAllowed: true,
      })
    ).toEqual({ action: "write", amount: 0 })
  })

  it("shows change briefly after a cash payment that fits, then idles", () => {
    expect(
      resolveCustomerDisplayIntent({
        status: "connected",
        cartCount: 0,
        runningTotal: 0,
        checkoutOpen: false,
        saleSuccess: { cashReceived: 20, changeGiven: 8.25 },
        autoUpdatesAllowed: true,
      })
    ).toMatchObject({ action: "writeThenIdle", amount: 8.25 })
  })

  it("fails closed: omits automatic writes unless autoUpdatesAllowed is explicitly true", () => {
    const base = {
      status: "connected" as const,
      cartCount: 2,
      runningTotal: 12,
      checkoutOpen: true,
      saleSuccess: null,
    }
    expect(resolveCustomerDisplayIntent(base)).toEqual({ action: "none" })
    expect(resolveCustomerDisplayIntent({ ...base, autoUpdatesAllowed: false })).toEqual({
      action: "none",
    })
    expect(resolveCustomerDisplayIntent({ ...base, autoUpdatesAllowed: undefined })).toEqual({
      action: "none",
    })
  })

  it("does not write when the display is disconnected or in error", () => {
    expect(shouldWriteCustomerDisplay("disconnected")).toBe(false)
    expect(shouldWriteCustomerDisplay("error")).toBe(false)
    expect(shouldWriteCustomerDisplay("connected")).toBe(true)
    expect(
      resolveCustomerDisplayIntent({
        status: "disconnected",
        cartCount: 4,
        runningTotal: 12,
        checkoutOpen: true,
        saleSuccess: { cashReceived: 20, changeGiven: 8 },
        autoUpdatesAllowed: true,
      })
    ).toEqual({ action: "none" })
    expect(
      resolveCustomerDisplayIntent({
        status: "error",
        cartCount: 4,
        runningTotal: 12,
        checkoutOpen: true,
        saleSuccess: null,
        autoUpdatesAllowed: true,
      })
    ).toEqual({ action: "none" })
  })

  it("never throws when writing while disconnected", async () => {
    await expect(writeCustomerDisplayAmount(12)).resolves.toMatchObject({ ok: true, skipped: true })
    await expect(writeCustomerDisplayAmount(0)).resolves.toMatchObject({ ok: true, skipped: true })
  })
})

describe("Finza cash-drawer commands removed", () => {
  it("does not enable Finza drawer-kick pulses on Retail sale print", () => {
    const print = readRepo("app/retail/lib/printRetailSaleReceiptBrowser.ts")
    expect(print).toContain("export const RETAIL_FINZA_DRAWER_KICK_ENABLED = false")
    expect(print).toContain("drawer_kick: RETAIL_FINZA_DRAWER_KICK_ENABLED")
  })

  it("removes drawer pairing UI, COM selection, and Open drawer controls", () => {
    const bar = readRepo("components/retail/pos/RetailPosHardwareBar.tsx")
    const hook = readRepo("components/retail/pos/useRetailPosHardware.ts")
    const pos = readRepo("components/retail/pos/RetailPosPage.tsx")
    const protocol = readRepo("lib/retail/hardware/customerDisplayProtocol.ts")
    const hardware = readRepo("lib/retail/hardware/retailPosHardware.ts")
    const print = readRepo("app/retail/lib/printRetailSaleReceiptBrowser.ts")
    const settings = readRepo("app/admin/retail/receipt-settings/page.impl.tsx")

    for (const src of [bar, hook, pos, protocol, hardware]) {
      expect(src).not.toMatch(/Open drawer/i)
      expect(src).not.toMatch(/pulseCashDrawer/)
      expect(src).not.toMatch(/buildCashDrawerKickBytes/)
      expect(src).not.toMatch(/Connect drawer/i)
      expect(src).not.toMatch(/Drawer connected/i)
    }
    expect(bar).not.toMatch(/onDrawerResult/)
    expect(pos).not.toMatch(/allowDrawerKick/)
    expect(pos).not.toMatch(/onDrawerResult/)
    expect(protocol).not.toMatch(/saleIncludesCashTender/)
    expect(hardware).not.toMatch(/0x70/)
    expect(print).toContain("drawer_kick: RETAIL_FINZA_DRAWER_KICK_ENABLED")
    expect(settings).not.toMatch(/Auto Open Cash Drawer/)
    expect(settings).not.toMatch(/2-line VFD/)
  })
})

describe("retail receipt print corrections preserved", () => {
  it("keeps solid-black thermal CSS scoped to the receipt document", () => {
    const css = retailReceiptDocumentCss(true)
    expect(css).toContain("color: #000")
    expect(css).toContain(".receipt *")
    expect(css).toContain("58mm")
    expect(css).not.toMatch(/\*\s*\{\s*color:\s*black/)
    expect(css).not.toContain("html *")
  })

  it("does not change receipt calculations", () => {
    const html = generateReceiptHTML(sampleReceipt(), {
      width: "80mm",
      mode: "full",
      showLogo: true,
      showQR: true,
      footerText: "Thank you for your purchase.",
      qrImageDataUrl: "data:image/png;base64,AAA",
    })
    expect(html).toContain("Total: GHS 11.75")
    expect(html).toContain("VAT: GHS 1.50")
    expect(html).toContain("NHIL: GHS 0.15")
    expect(html).toContain("GETFund: GHS 0.10")
    expect(html).toContain("Amount tendered (cash): GHS 20.00")
    expect(html).toContain("Change: GHS 8.25")
    expect(html).toContain("Bottled water")
    expect(html).toContain("receipt-qr-img")
    expect(html).toContain("color: #000")
  })
})
