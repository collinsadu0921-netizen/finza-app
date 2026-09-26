import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { NextRequest, NextResponse } from "next/server"
import { POST } from "../route"
import { extractReceiptWithOpenAi, ReceiptAiError } from "@/lib/ocr/openaiReceiptExtract"
import { resetReceiptAiRateLimitForTests } from "@/lib/ocr/receiptAiRateLimit"
import { MAX_IMAGE_BYTES } from "@/lib/ocr/constants"

const mockGetUser = jest.fn()
const mockFrom = jest.fn()

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}))

jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn(async () => null),
}))

jest.mock("@/lib/ocr/openaiReceiptExtract", () => {
  const actual = jest.requireActual("@/lib/ocr/openaiReceiptExtract") as Record<string, unknown>
  return {
    ...actual,
    extractReceiptWithOpenAi: jest.fn(),
    logReceiptAiEvent: jest.fn(),
  }
})

const mockExtract = jest.mocked(extractReceiptWithOpenAi)
const { enforceServiceWorkspaceAccess } = jest.requireMock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess") as {
  enforceServiceWorkspaceAccess: jest.Mock
}

function upload(file: File, businessId = "biz-1") {
  const form = new FormData()
  form.set("business_id", businessId)
  form.set("file", file)
  return new NextRequest("http://localhost/api/receipt-extract-ai", { method: "POST", body: form })
}

describe("POST /api/receipt-extract-ai", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetReceiptAiRateLimitForTests()
    process.env.RECEIPT_AI_EXTRACT_ENABLED = "true"
    process.env.OPENAI_RECEIPT_MODEL = "gpt-6-luna"
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockFrom.mockImplementation(() => {
      throw new Error("route must not touch database tables")
    })
    mockExtract.mockResolvedValue({
      extraction: {
        document_type: "receipt",
        supplier_name: "KOFI SHOP LTD",
        document_date: "2026-03-12",
        total_amount: 45.5,
        currency: "GHS",
        subtotal: null,
        tax_amount: null,
        receipt_number: null,
        supplier_tax_id: null,
        evidence: { supplier: "KOFI SHOP LTD", date: "12/03/2026", total: "TOTAL 45.50", currency: "GHS" },
        warnings: [],
        clarity: { supplier: "high", date: "high", total: "high", currency: "high" },
      },
      model: "gpt-6-luna",
      durationMs: 10,
    })
  })

  it("rejects anonymous callers", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(upload(new File([Uint8Array.from([1])], "a.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(401)
    expect(mockExtract).not.toHaveBeenCalled()
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it("rejects a business the user cannot access", async () => {
    enforceServiceWorkspaceAccess.mockResolvedValueOnce(
      NextResponse.json({ error: "Forbidden: no access to this business" }, { status: 403 })
    )
    const res = await POST(upload(new File([Uint8Array.from([1])], "a.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("AI_FORBIDDEN")
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it("rejects an unsupported MIME type before calling OpenAI", async () => {
    const res = await POST(upload(new File([Uint8Array.from([1])], "notes.txt", { type: "text/plain" })))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("AI_UNSUPPORTED_TYPE")
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it("rejects an oversized image before calling OpenAI", async () => {
    const res = await POST(upload(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "big.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("AI_FILE_TOO_LARGE")
    expect(mockExtract).not.toHaveBeenCalled()
  })

  it("returns structured output and does not write an expense", async () => {
    const res = await POST(upload(new File([Uint8Array.from([1, 2, 3])], "a.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, engine: "openai", model: "gpt-6-luna" })
    expect(body.extraction.total_amount).toBe(45.5)
    expect(mockFrom).not.toHaveBeenCalled()
    const request = mockExtract.mock.calls[0][0]
    expect(request.mime).toBe("image/jpeg")
  })

  it("accepts a PDF and forwards pdf bytes", async () => {
    const res = await POST(upload(new File([Uint8Array.from([37, 80, 68, 70])], "a.pdf", { type: "application/pdf" })))
    expect(res.status).toBe(200)
    expect(mockExtract.mock.calls[0][0].mime).toBe("application/pdf")
  })

  it("returns a Finza timeout error", async () => {
    mockExtract.mockRejectedValueOnce(new ReceiptAiError("AI_TIMEOUT", 504, "Receipt reading timed out. Try again."))
    const res = await POST(upload(new File([Uint8Array.from([1])], "a.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(504)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, code: "AI_TIMEOUT", stage: "openai_receipt_extraction" })
    expect(JSON.stringify(body)).not.toContain("sk-")
  })

  it("returns a Finza rate-limit error", async () => {
    mockExtract.mockRejectedValueOnce(new ReceiptAiError("AI_UPSTREAM_RATE_LIMIT", 429, "Receipt reading is busy. Try again in a moment."))
    const res = await POST(upload(new File([Uint8Array.from([1])], "a.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe("AI_UPSTREAM_RATE_LIMIT")
  })

  it("returns a refusal as JSON", async () => {
    mockExtract.mockRejectedValueOnce(new ReceiptAiError("AI_REFUSAL", 422, "The receipt could not be read."))
    const res = await POST(upload(new File([Uint8Array.from([1])], "a.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe("AI_REFUSAL")
  })

  it("stays disabled unless the staging flag is set", async () => {
    process.env.RECEIPT_AI_EXTRACT_ENABLED = "false"
    const res = await POST(upload(new File([Uint8Array.from([1])], "a.jpg", { type: "image/jpeg" })))
    expect(res.status).toBe(404)
    expect(mockExtract).not.toHaveBeenCalled()
  })
})
