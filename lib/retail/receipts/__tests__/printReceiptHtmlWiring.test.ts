import { readFileSync } from "fs"
import { join } from "path"

const root = join(__dirname, "..", "..", "..", "..")

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8")
}

describe("Retail browser-print wiring (hidden iframe)", () => {
  it("completed-sale helper uses shared printReceiptHtmlInBrowser, not window.open", () => {
    const src = read("app/retail/lib/printRetailSaleReceiptBrowser.ts")
    expect(src).toContain("printReceiptHtmlInBrowser")
    expect(src).not.toContain("window.open")
    expect(src).not.toContain("buildPrintWindow")
    expect(src).toContain('printer_type === "escpos"')
  })

  it("ReceiptPrinter uses shared helper for browser path; ESC/POS unchanged", () => {
    const src = read("components/ReceiptPrinter.tsx")
    expect(src).toContain("printReceiptHtmlInBrowser")
    expect(src).toContain("printRetailReceiptEscposSerial")
    expect(src).not.toContain("window.open")
    expect(src).toContain('drawer_kick: false')
  })

  it("shared helper prefers hidden iframe and avoids preferred-path window.open", () => {
    const src = read("lib/retail/receipts/printReceiptHtmlInBrowser.ts")
    expect(src).toContain("data-finza-receipt-print-frame")
    expect(src).toContain("createHiddenPrintIframe")
    expect(src).toContain("afterprint")
    expect(src).toContain("waitForReceiptImages")
    expect(src).toContain("fonts.ready")
    expect(src).toContain('status === "unavailable"')
    expect(src).toContain("printViaTemporaryWindow")
    expect(src).toContain("window.open")
  })

  it("does not alter ESC/POS serial generator or receipt HTML generator APIs", () => {
    const escposSerial = read("lib/receipt/printRetailReceiptEscposSerial.ts")
    expect(escposSerial).toContain("export async function printRetailReceiptEscposSerial")
    const escpos = read("lib/escpos.ts")
    expect(escpos).toContain("export function generateReceiptHTML")
  })
})
