import { describe, expect, it, jest } from "@jest/globals"
import { extractReceiptInBrowser } from "../extractReceiptInBrowser"

jest.mock("../prepareReceiptImage", () => ({
  prepareWorkingImage: jest.fn(async () => ({ blob: new Blob(["img"]), width: 800, height: 600 })),
}))

jest.mock("../renderReceiptPdf.client", () => ({
  renderReceiptPdfPages: jest.fn(async () => {
    throw Object.assign(new Error("render failed"), { code: "OCR_PDF_RENDER_FAILED", stage: "pdf" })
  }),
}))

jest.mock("../paddleReceiptOcr.client", () => ({
  recognizeReceiptImage: jest.fn(),
  receiptScannerEngineLabel: () => "paddleocr-js@0.4.2",
  receiptScannerInitMs: () => 0,
}))

describe("extractReceiptInBrowser", () => {
  it("fills supplier, date, and total from recognized lines", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "sample-receipt-fictional.jpg", { type: "image/jpeg" })
    const result = await extractReceiptInBrowser(file, {
      businessCurrency: "GHS",
      recognize: async () => ({
        lines: [
          { text: "KOFI SHOP LTD", score: 0.99 },
          { text: "DATE: 12/03/2026", score: 0.95 },
          { text: "TOTAL GHS 45.50", score: 0.98 },
        ],
      }),
    })
    expect(result.suggestions.supplier_name).toBe("KOFI SHOP LTD")
    expect(result.suggestions.document_date).toBe("2026-03-12")
    expect(result.suggestions.total).toBe(45.5)
    expect(result.suggestions.currency_code).toBe("GHS")
    expect(result.lineCount).toBe(3)
  })

  it("rejects an unsupported file before recognition", async () => {
    const file = new File([new Uint8Array([1])], "notes.txt", { type: "text/plain" })
    await expect(
      extractReceiptInBrowser(file, { recognize: async () => ({ lines: [] }) })
    ).rejects.toMatchObject({ code: "OCR_UNSUPPORTED_TYPE" })
  })

  it("surfaces PDF render failure without throwing a page", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "receipt.pdf", { type: "application/pdf" })
    await expect(extractReceiptInBrowser(file, { recognize: async () => ({ lines: [] }) })).rejects.toMatchObject({
      code: "OCR_PDF_RENDER_FAILED",
    })
  })

  it("returns no meaningful total when OCR lines are blank", async () => {
    const file = new File([new Uint8Array([1])], "blank.png", { type: "image/png" })
    const result = await extractReceiptInBrowser(file, {
      recognize: async () => ({ lines: [] }),
    })
    expect(result.suggestions.total).toBeUndefined()
    expect(result.lineCount).toBe(0)
  })
})
