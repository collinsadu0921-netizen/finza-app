/**
 * GET /api/bills/list — default pagination and access.
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

function buildSupabase(bills: unknown[] = [], count = 0) {
  const range = jest.fn().mockResolvedValue({ data: bills, error: null, count })
  const billsChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    or: jest.fn().mockReturnThis(),
    range,
  }
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }),
    },
    from: jest.fn((table: string) => {
      if (table === "bills") return billsChain
      if (table === "bill_payments") {
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          is: jest.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      return { select: jest.fn().mockReturnThis() }
    }),
    billsChain,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe("GET /api/bills/list", () => {
  it("applies default page=1 and limit=50 range when client omits pagination", async () => {
    const supabase = buildSupabase([{ id: "bill-1", total: 100 }], 1)
    mockCreateSupabase.mockResolvedValue(supabase as any)
    mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })

    const req = new NextRequest("http://localhost/api/bills/list?business_id=biz-a")
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(supabase.billsChain.range).toHaveBeenCalledWith(0, 49)

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
    const supabase = buildSupabase([], 0)
    mockCreateSupabase.mockResolvedValue(supabase as any)
    mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })

    const req = new NextRequest(
      "http://localhost/api/bills/list?business_id=biz-a&page=2&limit=500"
    )
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(supabase.billsChain.range).toHaveBeenCalledWith(100, 199)
  })
})
