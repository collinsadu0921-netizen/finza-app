/**
 * performReceiptOcr: PDF path uses extractReceiptPdf; image path keeps image_ocr diagnostics.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { performReceiptOcr } from "../performReceiptOcr"
import { setReceiptOcrProvider } from "../receiptOcr"

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(async () => "owner"),
}))

jest.mock("@/lib/receipt/extractReceiptPdf", () => ({
  extractReceiptPdf: jest.fn(async () => ({
    rawText: ["JSS LTD", "VAT 125.00", "NHIL 20.83", "GETFund 20.83", "TOTAL GHS 1000.00"].join("\n"),
    extraction_mode: "pdf_text",
    page_count: 2,
    warnings: ["test-warning"],
  })),
  PDF_EXTRACTION_PROVIDER_LABEL: "pdfjs+tesseract-test",
}))

import { extractReceiptPdf } from "../extractReceiptPdf"

const mockExtractPdf = jest.mocked(extractReceiptPdf)

function ghanaSampleText() {
  return ["JSS LTD", "VAT 125.00", "NHIL 20.83", "GETFund 20.83", "TOTAL GHS 1000.00"].join("\n")
}

describe("performReceiptOcr PDF vs image", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setReceiptOcrProvider({
      extractText: async () => ghanaSampleText(),
    })
  })

  it("uses extractReceiptPdf for PDF buffers and returns pdf diagnostics", async () => {
    const signedUrl = "https://xyz.supabase.co/storage/v1/object/sign/receipts/a/b.pdf?token=x"
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) // %PDF-

    global.fetch = jest.fn(
      async () =>
        new Response(pdfBytes.buffer, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
    ) as unknown as typeof fetch

    const supabase = {
      storage: {
        from: jest.fn(() => ({
          createSignedUrl: jest.fn(async () => ({ data: { signedUrl } })),
        })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({ data: { default_currency: "GHS" } })),
          })),
        })),
      })),
    }

    const result = await performReceiptOcr(supabase as never, {
      userId: "u",
      businessId: "b",
      receiptPath: "expenses/b/1.pdf",
      documentType: "expense",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.suggestions.total).toBe(1000)
    expect(result.diagnostics.extraction_mode).toBe("pdf_text")
    expect(result.diagnostics.page_count).toBe(2)
    expect(result.diagnostics.warnings).toEqual(["test-warning"])
    expect(result.diagnostics.provider).toBe("pdfjs+tesseract")
    expect(mockExtractPdf).toHaveBeenCalled()
  })

  it("uses image_ocr diagnostics for JPEG fetch (backward compatible)", async () => {
    const sharp = (await import("sharp")).default
    const jpegBuf = await sharp({
      create: { width: 24, height: 24, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .jpeg()
      .toBuffer()

    const signedUrl = "https://xyz.supabase.co/storage/v1/object/sign/receipts/a/b.jpg?token=x"
    global.fetch = jest.fn(
      async () =>
        new Response(jpegBuf, {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        })
    ) as unknown as typeof fetch

    const supabase = {
      storage: {
        from: jest.fn(() => ({
          createSignedUrl: jest.fn(async () => ({ data: { signedUrl } })),
        })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({ data: { default_currency: "GHS" } })),
          })),
        })),
      })),
    }

    const result = await performReceiptOcr(supabase as never, {
      userId: "u",
      businessId: "b",
      receiptPath: "expenses/b/1.jpg",
      documentType: "expense",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.diagnostics.extraction_mode).toBe("image_ocr")
    expect(mockExtractPdf).not.toHaveBeenCalled()
  })

  it("returns OCR_PDF_EXTRACT_FAILED when extractReceiptPdf throws", async () => {
    mockExtractPdf.mockRejectedValueOnce(new Error("broken pdf"))
    const signedUrl = "https://xyz.supabase.co/storage/v1/object/sign/receipts/a/b.pdf?token=x"
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])

    global.fetch = jest.fn(
      async () =>
        new Response(pdfBytes.buffer, {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        })
    ) as unknown as typeof fetch

    const supabase = {
      storage: {
        from: jest.fn(() => ({
          createSignedUrl: jest.fn(async () => ({ data: { signedUrl } })),
        })),
      },
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(async () => ({ data: { default_currency: "GHS" } })),
          })),
        })),
      })),
    }

    const result = await performReceiptOcr(supabase as never, {
      userId: "u",
      businessId: "b",
      receiptPath: "expenses/b/x.pdf",
      documentType: "expense",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("OCR_PDF_EXTRACT_FAILED")
    expect(result.httpStatus).toBe(400)
  })
})
