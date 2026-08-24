/**
 * GET /api/bills/list — RPC-backed pagination (510).
 */

import { GET } from "../list/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTier: jest.fn().mockResolvedValue(null),
}))
jest.mock("@/lib/server/resolveAuthenticatedApiUser", () => ({
  resolveAuthenticatedApiUser: jest.fn(),
}))

import { NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { enforceServiceIndustryMinTier } from "@/lib/serviceWorkspace/enforceServiceIndustryMinTier"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockResolveAuth = resolveAuthenticatedApiUser as jest.MockedFunction<
  typeof resolveAuthenticatedApiUser
>

function mockBillsRpc(bills: unknown[], totalCount: number) {
  return jest.fn().mockImplementation((name: string, args?: Record<string, unknown>) => {
    if (name === "get_bills_list_page") {
      return Promise.resolve({
        data: { total_count: totalCount, bills },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected ${name}` } })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC
  mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })
  mockResolveAuth.mockResolvedValue({
    ok: true,
    user: { id: "user-001" } as any,
    authSource: "session",
  })
})

describe("GET /api/bills/list", () => {
  it("applies default page=1 and limit=50 via RPC", async () => {
    const bills = [{ id: "bill-1", total: 100, total_paid: 0, balance: 100 }]
    const rpc = mockBillsRpc(bills, 1)
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }) },
      rpc,
    } as any)

    const req = new NextRequest("http://localhost/api/bills/list?business_id=biz-a")
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      "get_bills_list_page",
      expect.objectContaining({
        p_business_id: "biz-a",
        p_limit: 50,
        p_offset: 0,
      })
    )

    const body = await res.json()
    expect(body.bills).toHaveLength(1)
    expect(body.pagination).toMatchObject({
      page: 1,
      limit: 50,
      total: 1,
      hasMore: false,
    })
    const timing = res.headers.get("Server-Timing") || ""
    for (const name of ["auth", "scope", "entitlement", "bills_rpc", "cache", "assembly", "total"]) {
      expect(timing).toContain(`${name};dur=`)
    }
    expect(timing).not.toContain("biz-a")
    expect(timing).not.toContain("user-001")
    expect(timing).not.toMatch(/select |get_bills_list_page\(/i)
  })

  it("returns 401 without a session", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Unauthorized",
      authFailureStage: "missing_cookie",
    })
    mockCreateSupabase.mockResolvedValue({ rpc: jest.fn() } as never)
    const res = await GET(new NextRequest("http://localhost/api/bills/list?business_id=biz-a"))
    expect(res.status).toBe(401)
    expect(mockResolveScope).not.toHaveBeenCalled()
  })

  it("rejects a business the user cannot access", async () => {
    mockResolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })
    mockCreateSupabase.mockResolvedValue({ rpc: jest.fn() } as never)
    const res = await GET(
      new NextRequest("http://localhost/api/bills/list?business_id=biz-forged")
    )
    expect(res.status).toBe(403)
    expect(enforceServiceIndustryMinTier).not.toHaveBeenCalled()
  })

  it("returns TIER_REQUIRED without calling the bills RPC", async () => {
    const rpc = mockBillsRpc([], 0)
    mockCreateSupabase.mockResolvedValue({ rpc } as never)
    jest.mocked(enforceServiceIndustryMinTier).mockResolvedValueOnce(
      NextResponse.json(
        { error: "Forbidden: requires professional plan or higher", code: "TIER_REQUIRED" },
        { status: 403 }
      )
    )
    const res = await GET(new NextRequest("http://localhost/api/bills/list?business_id=biz-a"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TIER_REQUIRED")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("caps limit at 100", async () => {
    const rpc = mockBillsRpc([], 0)
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }) },
      rpc,
    } as any)

    const req = new NextRequest(
      "http://localhost/api/bills/list?business_id=biz-a&page=2&limit=500"
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      "get_bills_list_page",
      expect.objectContaining({
        p_limit: 100,
        p_offset: 100,
      })
    )
  })
})
