/**
 * Receipt OCR API route tests.
 * - 401 when no user
 * - 403 when not business member
 * - 400 when external URL (SSRF guard)
 * - 200 with ok:true and suggestions shape (mock provider)
 * - No DB writes (route is read-only)
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST } from "../route"

const mockGetUser = jest.fn()
const mockGetUserRole = jest.fn()
const mockFrom = jest.fn()
const mockAuth = { getUser: mockGetUser }
const mockStorageFrom = jest.fn()

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(() =>
    Promise.resolve({
      auth: mockAuth,
      storage: { from: mockStorageFrom },
      from: mockFrom,
    })
  ),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: (...args: unknown[]) => mockGetUserRole(...args),
}))

const mockParseReceiptText = jest.fn(() => ({
  suggestions: {
    supplier_name: "Test Supplier",
    document_date: "2026-01-29",
    total: 100,
  },
  confidence: { supplier_name: "HIGH", document_date: "HIGH", total: "HIGH" },
}))

jest.mock("@/lib/receipt/receiptOcr", () => ({
  getReceiptOcrProvider: jest.fn(() => ({
    extractText: jest.fn(() => Promise.resolve("TOTAL GHS 100\nTest Supplier\n2026-01-29")),
  })),
  parseReceiptText: (...args: unknown[]) => mockParseReceiptText(...args),
}))

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
    mockStorageFrom.mockReturnValue({
      createSignedUrl: jest.fn(() => Promise.resolve({ data: { signedUrl: "https://allowed.storage/image.jpg" } })),
    })
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: { default_currency: "GHS" } })),
          maybeSingle: jest.fn(() => Promise.resolve({ data: { default_currency: "GHS" } })),
        }),
      }),
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
    expect(mockGetUserRole).not.toHaveBeenCalled()
  })

  it("returns 403 when user is not business member", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    mockGetUserRole.mockResolvedValue(null)
    const res = await POST(
      jsonBody({
        business_id: "b",
        receipt_path: "bills/b/1.jpg",
        document_type: "expense",
      })
    )
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe("Unauthorized")
  })

  it("rejects external URL origin (SSRF guard)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    mockGetUserRole.mockResolvedValue("owner")
    const res = await POST(
      jsonBody({
        business_id: "b",
        receipt_path: "https://evil.com/image.jpg",
        document_type: "expense",
      })
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe("External URLs not allowed")
  })

  it("returns ok:true with suggestions shape when authorized and path provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    mockGetUserRole.mockResolvedValue("owner")
    const origFetch = globalThis.fetch
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        blob: () =>
          Promise.resolve(
            new Blob(["x"], { type: "image/jpeg" })
          ),
      } as Response)
    ) as jest.Mock

    try {
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
      expect(data.suggestions).toBeDefined()
      expect(typeof data.suggestions).toBe("object")
      expect(data.confidence).toBeDefined()
      expect(data.suggestions.supplier_name).toBe("Test Supplier")
      expect(data.suggestions.total).toBe(100)
    } finally {
      globalThis.fetch = origFetch
    }
  })

  it("does not call ledger or write tables (read-only)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    mockGetUserRole.mockResolvedValue("owner")
    const origFetch = globalThis.fetch
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        blob: () => Promise.resolve(new Blob(["x"], { type: "image/jpeg" })),
      } as Response)
    ) as jest.Mock

    try {
      await POST(
        jsonBody({
          business_id: "b",
          receipt_path: "bills/b/1.jpg",
          document_type: "expense",
        })
      )
      const fromCalls = mockFrom.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(fromCalls).toContain("businesses")
      expect(fromCalls).not.toContain("journal_entries")
      expect(fromCalls).not.toContain("journal_entry_lines")
      expect(fromCalls).not.toContain("expenses")
      expect(fromCalls).not.toContain("bills")
    } finally {
      globalThis.fetch = origFetch
    }
  })
})
