/**
 * POST /api/incoming-documents/[id]/review — save_draft / accept with auth + role checks.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { POST } from "../[id]/review/route"
import {
  acceptIncomingDocumentReview,
  saveIncomingDocumentReviewDraft,
} from "@/lib/documents/incomingDocumentsService"

const mockGetUser = jest.fn()

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
    })
  ),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/documents/incomingDocumentsService", () => ({
  saveIncomingDocumentReviewDraft: jest.fn(),
  acceptIncomingDocumentReview: jest.fn(),
}))

import { getUserRole } from "@/lib/userRoles"

const mockSaveDraft = jest.mocked(saveIncomingDocumentReviewDraft)
const mockAccept = jest.mocked(acceptIncomingDocumentReview)
const mockGetUserRole = jest.mocked(getUserRole)

function req(documentId: string, body: object): NextRequest {
  return new NextRequest(`http://localhost/api/incoming-documents/${documentId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/incoming-documents/[id]/review", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUserRole.mockResolvedValue("owner")
    mockSaveDraft.mockResolvedValue({ ok: true })
    mockAccept.mockResolvedValue({ ok: true })
  })

  it("returns 401 when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(req("d1", { business_id: "b", action: "save_draft", fields: {} }), {
      params: Promise.resolve({ id: "d1" }),
    })
    expect(res.status).toBe(401)
    expect(mockSaveDraft).not.toHaveBeenCalled()
  })

  it("returns 403 when user has no role for business", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
    mockGetUserRole.mockResolvedValueOnce(null)
    const res = await POST(req("d1", { business_id: "b", action: "save_draft", fields: {} }), {
      params: Promise.resolve({ id: "d1" }),
    })
    expect(res.status).toBe(403)
    expect(mockSaveDraft).not.toHaveBeenCalled()
  })

  it("calls saveIncomingDocumentReviewDraft for save_draft", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
    const fields = { supplier_name: "Edited", total: 50 }
    const res = await POST(req("doc-1", { business_id: "biz", action: "save_draft", fields }), {
      params: Promise.resolve({ id: "doc-1" }),
    })
    expect(res.status).toBe(200)
    expect(mockSaveDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        documentId: "doc-1",
        businessId: "biz",
        userId: "u1",
        fields,
      })
    )
    expect(mockAccept).not.toHaveBeenCalled()
  })

  it("calls acceptIncomingDocumentReview for accept", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
    const fields = { supplier_name: "Final" }
    const res = await POST(req("doc-2", { business_id: "biz", action: "accept", fields }), {
      params: Promise.resolve({ id: "doc-2" }),
    })
    expect(res.status).toBe(200)
    expect(mockAccept).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        documentId: "doc-2",
        businessId: "biz",
        userId: "u1",
        fields,
      })
    )
  })

  it("returns 400 when service returns error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
    mockSaveDraft.mockResolvedValueOnce({ ok: false, error: "Document is already linked" })
    const res = await POST(req("d1", { business_id: "b", action: "save_draft", fields: {} }), {
      params: Promise.resolve({ id: "d1" }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe("Document is already linked")
  })
})
