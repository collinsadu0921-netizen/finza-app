/**
 * DELETE /api/incoming-documents/[id] — unlinked form-upload cleanup.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import { NextRequest } from "next/server"
import { DELETE } from "../[id]/route"

const mockGetUser = jest.fn()
const mockStorageRemove = jest.fn().mockResolvedValue({ error: null })
const deleteSecondEq = jest.fn().mockResolvedValue({ error: null })

let selectDocRow: Record<string, unknown> | null = null

function incomingDocumentsTable() {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: selectDocRow,
            error: selectDocRow ? null : { message: "not found" },
          }),
        }),
      }),
    }),
    delete: () => ({
      eq: () => ({
        eq: deleteSecondEq,
      }),
    }),
  }
}

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: (table: string) => {
        if (table === "incoming_documents") return incomingDocumentsTable()
        return {}
      },
      storage: {
        from: jest.fn(() => ({ remove: mockStorageRemove })),
      },
    })
  ),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

import { getUserRole } from "@/lib/userRoles"

const mockGetUserRole = jest.mocked(getUserRole)

function req(documentId: string, businessId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/incoming-documents/${documentId}?business_id=${encodeURIComponent(businessId)}`,
    { method: "DELETE" }
  )
}

describe("DELETE /api/incoming-documents/[id]", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetUserRole.mockResolvedValue("owner")
    selectDocRow = null
    mockStorageRemove.mockResolvedValue({ error: null })
    deleteSecondEq.mockResolvedValue({ error: null })
  })

  it("returns 401 when no user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await DELETE(req("d1", "biz-1"), { params: Promise.resolve({ id: "d1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 404 when document not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
    selectDocRow = null
    const res = await DELETE(req("missing", "biz-1"), { params: Promise.resolve({ id: "missing" }) })
    expect(res.status).toBe(404)
  })

  it("returns 409 when document has linked_entity_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
    selectDocRow = {
      id: "d1",
      business_id: "biz-1",
      source_type: "expense_form_upload",
      status: "extracted",
      linked_entity_id: "exp-1",
      linked_entity_type: "expense",
      storage_bucket: "receipts",
      storage_path: "x.pdf",
    }
    const res = await DELETE(req("d1", "biz-1"), { params: Promise.resolve({ id: "d1" }) })
    expect(res.status).toBe(409)
    expect(mockStorageRemove).not.toHaveBeenCalled()
  })

  it("removes storage object and deletes row for unlinked expense_form_upload", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } })
    selectDocRow = {
      id: "d1",
      business_id: "biz-1",
      source_type: "expense_form_upload",
      status: "extracted",
      linked_entity_id: null,
      linked_entity_type: null,
      storage_bucket: "receipts",
      storage_path: "expenses/a.pdf",
    }
    const res = await DELETE(req("d1", "biz-1"), { params: Promise.resolve({ id: "d1" }) })
    expect(res.status).toBe(200)
    expect(mockStorageRemove).toHaveBeenCalledWith(["expenses/a.pdf"])
    expect(deleteSecondEq).toHaveBeenCalled()
  })
})
