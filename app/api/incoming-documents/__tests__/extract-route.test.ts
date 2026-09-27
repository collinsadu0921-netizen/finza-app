import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST } from "../[id]/extract/route"

const mockGetUser = jest.fn()
const maybeSingle = jest.fn()
const mockRun = jest.fn()

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle }),
        }),
      }),
    }),
  })),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/documents/incomingDocumentsService", () => ({
  getIncomingDocumentForBusiness: jest.fn(async () => ({
    id: "doc-1",
    storage_bucket: "receipts",
    storage_path: "incoming/biz/file.pdf",
    status: "needs_review",
    linked_entity_id: null,
    linked_entity_type: null,
  })),
}))

jest.mock("@/lib/documents/runPersistedOpenAiExtraction", () => ({
  runPersistedOpenAiExtraction: (...args: unknown[]) => mockRun(...args),
}))

import { getUserRole } from "@/lib/userRoles"

const mockGetUserRole = jest.mocked(getUserRole)

function req(body: object) {
  return new NextRequest("http://localhost/api/incoming-documents/doc-1/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/incoming-documents/[id]/extract", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } })
    mockGetUserRole.mockResolvedValue("owner")
    maybeSingle.mockResolvedValue({
      data: { id: "doc-1", review_status: "accepted", reviewed_fields: { supplier_name: "Corrected" }, business_id: "biz-1" },
      error: null,
    })
    mockRun.mockResolvedValue({ ok: true, documentId: "doc-1", extractionId: "ext-2", mode: "supplier_bill" })
  })

  it("asks for confirmation before replacing an accepted review", async () => {
    const res = await POST(req({ business_id: "biz-1" }), { params: Promise.resolve({ id: "doc-1" }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.needs_confirmation).toBe(true)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("runs a new extraction after confirmation and reports that review fields stay", async () => {
    const res = await POST(req({ business_id: "biz-1", confirm: true }), { params: Promise.resolve({ id: "doc-1" }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reviewed_fields_preserved).toBe(true)
    expect(mockRun).toHaveBeenCalled()
  })

  it("does not extract a document outside the requested business", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const res = await POST(req({ business_id: "biz-2" }), { params: Promise.resolve({ id: "doc-1" }) })
    expect(res.status).toBe(404)
    expect(mockRun).not.toHaveBeenCalled()
  })
})
