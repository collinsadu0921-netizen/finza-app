/**
 * Receipt OCR API route tests.
 * - 401 when no user
 * - 403 when persisted OCR returns forbidden
 * - 200 with ok:true and suggestions + document_id (mocked persisted pipeline)
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST } from "../route"
import { runPersistedReceiptOcr } from "@/lib/documents/runPersistedReceiptOcr"

const mockGetUser = jest.fn()

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
    })
  ),
}))

jest.mock("@/lib/documents/runPersistedReceiptOcr", () => ({
  runPersistedReceiptOcr: jest.fn(),
}))

const mockRunPersisted = jest.mocked(runPersistedReceiptOcr)

function jsonBody(body: object): NextRequest {
  return new NextRequest("http://localhost/api/receipt-ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/receipt-ocr", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunPersisted.mockResolvedValue({
      ocr: {
        ok: true,
        suggestions: {
          supplier_name: "Test Supplier",
          document_date: "2026-01-29",
          total: 100,
        },
        confidence: { supplier_name: "HIGH", document_date: "HIGH", total: "HIGH" },
        diagnostics: {
          raw_ocr_text: "TOTAL GHS 100",
          provider: "tesseract",
          provider_version: "tesseract.js@7",
          parser_version: "receiptOcr_parseReceiptText@v1",
        },
      },
      documentId: "doc-persisted-1",
    })
  })

  it("returns 401 when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(
      jsonBody({
        business_id: "b",
        receipt_path: "bills/b/1.jpg",
        document_type: "expense",
      })
    )
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe("Unauthorized")
    expect(mockRunPersisted).not.toHaveBeenCalled()
  })

  it("returns 403 when persisted pipeline reports forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    mockRunPersisted.mockResolvedValueOnce({
      ocr: {
        ok: false,
        error: "Unauthorized",
        code: "OCR_FORBIDDEN",
        httpStatus: 403,
      },
      documentId: "",
    })
    const res = await POST(
      jsonBody({
        business_id: "b",
        receipt_path: "bills/b/1.jpg",
        document_type: "expense",
      })
    )
    expect(res.status).toBe(403)
    expect(mockRunPersisted).toHaveBeenCalled()
  })

  it("returns ok:true with suggestions and document_id when pipeline succeeds", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    const res = await POST(
      jsonBody({
        business_id: "b",
        receipt_path: "bills/b/1.jpg",
        document_type: "supplier_bill",
      })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.document_id).toBe("doc-persisted-1")
    expect(data.suggestions.supplier_name).toBe("Test Supplier")
    expect(data.suggestions.total).toBe(100)
    expect(mockRunPersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u",
        businessId: "b",
        receiptPath: "bills/b/1.jpg",
        documentType: "supplier_bill",
        sourceType: "manual_upload",
      })
    )
  })

  it("supports document_id path (forwards to runPersistedReceiptOcr)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    await POST(
      jsonBody({
        business_id: "b",
        document_id: "incoming-uuid",
        document_type: "expense",
      })
    )
    expect(mockRunPersisted).toHaveBeenCalledWith(
      expect.objectContaining({
        existingDocumentId: "incoming-uuid",
        receiptPath: "",
      })
    )
  })

  it("returns parse-empty shape with document_id when pipeline returns OCR_PARSE_EMPTY", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    mockRunPersisted.mockResolvedValueOnce({
      ocr: {
        ok: false,
        error: "Could not extract details from this receipt. Please fill manually.",
        code: "OCR_PARSE_EMPTY",
        httpStatus: 200,
        suggestions: {},
        confidence: {},
        diagnostics: {
          raw_ocr_text: "noise only",
          provider: "tesseract",
          provider_version: "tesseract.js@7",
          parser_version: "receiptOcr_parseReceiptText@v1",
        },
      },
      documentId: "doc-parse-empty",
    })
    const res = await POST(
      jsonBody({
        business_id: "b",
        receipt_path: "expenses/b/1.jpg",
        document_type: "expense",
      })
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.code).toBe("OCR_PARSE_EMPTY")
    expect(data.document_id).toBe("doc-parse-empty")
  })
})
