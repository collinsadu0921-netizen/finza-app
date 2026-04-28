/**
 * Server PDF extraction: pdfjs getDocument must receive disableWorker (no pdf.worker.mjs on Vercel).
 * Full pdfjs ESM is not exercised here under ts-jest (import.meta); production uses native ESM.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { extractReceiptPdf, pdfjsServerGetDocumentParams } from "../extractReceiptPdf"

const mockGetDocument = jest.fn()

jest.mock("pdf-parse", () => jest.fn(async () => ({ text: "short", numpages: 1 })))

jest.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  __esModule: true,
  getDocument: (opts: unknown) => mockGetDocument(opts),
}))

describe("extractReceiptPdf", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const longItems = Array.from({ length: 90 }, (_, i) => ({ str: `token${i} ` }))
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: jest.fn().mockResolvedValue({
          getTextContent: jest.fn().mockResolvedValue({ items: longItems }),
        }),
      }),
    })
  })

  it("pdfjsServerGetDocumentParams sets disableWorker true (no worker bundle on server)", () => {
    const data = new Uint8Array([1, 2, 3])
    const opts = pdfjsServerGetDocumentParams(data)
    expect(opts.disableWorker).toBe(true)
    expect(opts.useSystemFonts).toBe(true)
    expect(opts.verbosity).toBe(0)
    expect(opts.data).toBe(data)
  })

  it("passes disableWorker into pdfjs getDocument for digital text extraction", async () => {
    const buf = new ArrayBuffer(8)
    const result = await extractReceiptPdf(buf)

    expect(mockGetDocument).toHaveBeenCalled()
    const firstCall = mockGetDocument.mock.calls[0][0] as { disableWorker?: boolean; data?: Uint8Array }
    expect(firstCall.disableWorker).toBe(true)
    expect(result.warnings.filter((w) => w.startsWith("pdfjs_text_failed"))).toEqual([])
    expect(normalizeLen(result.rawText)).toBeGreaterThanOrEqual(80)
  })
})

function normalizeLen(s: string): number {
  return s.replace(/\s+/g, " ").trim().length
}
