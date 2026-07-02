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

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
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
