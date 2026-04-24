/**
 * GET /api/incoming-documents — list summaries, auth + role.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { GET } from "../route"
import * as listMod from "@/lib/documents/incomingDocumentsList"

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

import { getUserRole } from "@/lib/userRoles"

const mockGetUserRole = jest.mocked(getUserRole)
const mockList = jest.spyOn(listMod, "listIncomingDocumentSummaries")

describe("GET /api/incoming-documents", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUserRole.mockResolvedValue("owner")
    mockList.mockResolvedValue({
      summaries: [
        {
          id: "d1",
          display_name: "receipt.pdf",
          document_kind: "expense_receipt",
          source_type: "expense_form_upload",
          status: "extracted",
          review_status: "none",
          created_at: "2026-01-01T00:00:00Z",
          linked_entity_type: null,
          linked_entity_id: null,
          latest_extraction: {
            extraction_mode: "pdf_text",
            page_count: 1,
            extraction_status: "succeeded",
            extraction_failed: false,
            has_warnings: false,
            error_snippet: null,
          },
        },
      ],
      total: 1,
    })
  })

  function req(url: string): NextRequest {
    return new NextRequest(url)
  }

  it("returns 401 when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await GET(req("http://localhost/api/incoming-documents?business_id=b1"))
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it("returns 400 when business_id missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    const res = await GET(req("http://localhost/api/incoming-documents"))
    expect(res.status).toBe(400)
    expect(mockList).not.toHaveBeenCalled()
  })

  it("returns 403 when no role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    mockGetUserRole.mockResolvedValueOnce(null)
    const res = await GET(req("http://localhost/api/incoming-documents?business_id=b1"))
    expect(res.status).toBe(403)
    expect(mockList).not.toHaveBeenCalled()
  })

  it("returns documents and total when authorized", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } } })
    const res = await GET(
      req("http://localhost/api/incoming-documents?business_id=b1&linked=unlinked&sort=attention")
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.documents).toHaveLength(1)
    expect(data.total).toBe(1)
    expect(mockList).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        businessId: "b1",
        linked: "unlinked",
        sort: "attention",
      })
    )
  })
})
