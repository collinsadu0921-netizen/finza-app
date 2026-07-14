/**
 * Asset depreciation API route tests (mocked Supabase).
 */

import { POST, DELETE } from "../[id]/depreciation/route"
import { POST as POST_REVERSE } from "../[id]/depreciation/reverse/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn().mockResolvedValue(null),
}))
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn().mockResolvedValue(undefined),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>
const mockGetBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>

const BUSINESS_ID = "biz-1"
const USER_ID = "user-1"
const ASSET_ID = "asset-1"

function mockAuthUser() {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  }
}

describe("POST /api/assets/[id]/depreciation", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetBusiness.mockResolvedValue({ id: BUSINESS_ID, name: "Test Biz" } as never)
  })

  it("returns 401 when unauthenticated", async () => {
    const supabase = mockAuthUser()
    supabase.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    mockCreateSupabase.mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/assets/x/depreciation", {
      method: "POST",
      body: JSON.stringify({ date: "2024-01-01" }),
    })
    const res = await POST(req, { params: { id: ASSET_ID } })
    expect(res.status).toBe(401)
  })

  it("returns 404 when asset not in business", async () => {
    const supabase = mockAuthUser()
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    })
    mockCreateSupabase.mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/assets/x/depreciation", {
      method: "POST",
      body: JSON.stringify({ date: "2024-01-01" }),
    })
    const res = await POST(req, { params: { id: ASSET_ID } })
    expect(res.status).toBe(404)
  })

  it("returns 201 with entry and journal IDs on success", async () => {
    const supabase = mockAuthUser()
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { id: ASSET_ID }, error: null }),
            }),
          }),
        }),
      }),
    })
    supabase.rpc.mockResolvedValue({
      data: {
        depreciation_entry_id: "entry-1",
        journal_entry_id: "je-1",
        amount: 200,
        status: "posted",
        posting_date: "2024-01-01",
        idempotent: false,
      },
      error: null,
    })
    mockCreateSupabase.mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/assets/x/depreciation", {
      method: "POST",
      body: JSON.stringify({ date: "2024-01-01" }),
    })
    const res = await POST(req, { params: { id: ASSET_ID } })
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.depreciation_entry_id).toBe("entry-1")
    expect(body.journal_entry_id).toBe("je-1")
    expect(supabase.rpc).toHaveBeenCalledWith(
      "post_asset_depreciation",
      expect.objectContaining({
        p_asset_id: ASSET_ID,
        p_posting_date: "2024-01-01",
        p_posted_by: USER_ID,
      })
    )
  })

  it("does not return success when RPC fails", async () => {
    const supabase = mockAuthUser()
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { id: ASSET_ID }, error: null }),
            }),
          }),
        }),
      }),
    })
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "Depreciation already posted for this asset and date" },
    })
    mockCreateSupabase.mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/assets/x/depreciation", {
      method: "POST",
      body: JSON.stringify({ date: "2024-01-01" }),
    })
    const res = await POST(req, { params: { id: ASSET_ID } })
    expect(res.status).toBe(409)
  })
})

describe("DELETE /api/assets/[id]/depreciation", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetBusiness.mockResolvedValue({ id: BUSINESS_ID, name: "Test Biz" } as never)
  })

  it("rejects delete of posted depreciation", async () => {
    const supabase = mockAuthUser()
    const maybeSingleAsset = jest.fn().mockResolvedValue({ data: { id: ASSET_ID }, error: null })
    const maybeSingleEntry = jest.fn().mockResolvedValue({
      data: { id: "entry-1", journal_entry_id: "je-1", status: "posted" },
      error: null,
    })

    supabase.from.mockImplementation((table: string) => {
      if (table === "assets") {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({ maybeSingle: maybeSingleAsset }),
            }),
          }),
        }
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                is: jest.fn().mockReturnValue({ maybeSingle: maybeSingleEntry }),
              }),
            }),
          }),
        }),
      }
    })
    mockCreateSupabase.mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/assets/x/depreciation?entry_id=entry-1", {
      method: "DELETE",
    })
    const res = await DELETE(req, { params: { id: ASSET_ID } })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe("DELETE_NOT_ALLOWED")
  })
})

describe("POST /api/assets/[id]/depreciation/reverse", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetBusiness.mockResolvedValue({ id: BUSINESS_ID, name: "Test Biz" } as never)
  })

  it("requires reversal reason", async () => {
    const supabase = mockAuthUser()
    mockCreateSupabase.mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/assets/x/depreciation/reverse", {
      method: "POST",
      body: JSON.stringify({
        depreciation_entry_id: "entry-1",
        reversal_date: "2024-02-01",
      }),
    })
    const res = await POST_REVERSE(req, { params: { id: ASSET_ID } })
    expect(res.status).toBe(400)
  })

  it("returns cross-tenant 404 when entry not in business", async () => {
    const supabase = mockAuthUser()
    supabase.from.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      }),
    })
    mockCreateSupabase.mockResolvedValue(supabase as never)

    const req = new NextRequest("http://localhost/api/assets/x/depreciation/reverse", {
      method: "POST",
      body: JSON.stringify({
        depreciation_entry_id: "entry-1",
        reversal_date: "2024-02-01",
        reason: "Posted in error",
      }),
    })
    const res = await POST_REVERSE(req, { params: { id: ASSET_ID } })
    expect(res.status).toBe(404)
  })
})
