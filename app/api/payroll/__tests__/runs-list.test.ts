/**
 * GET /api/payroll/runs — bounded list (510).
 */

import { GET } from "../runs/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/userPermissions", () => ({
  requirePermission: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTier: jest.fn().mockResolvedValue(null),
  enforceServiceIndustryMinTierWrite: jest.fn().mockResolvedValue(null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockGetBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>
const mockRequirePermission = requirePermission as jest.MockedFunction<typeof requirePermission>

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC
  mockGetBusiness.mockResolvedValue({ id: "biz-a" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("GET /api/payroll/runs", () => {
  it("returns bounded runs with default limit 24", async () => {
    const range = jest.fn().mockResolvedValue({
      data: [{ id: "run-1", payroll_month: "2026-01-01", status: "draft" }],
      error: null,
      count: 1,
    })
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range,
    }
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: jest.fn(() => chain),
    } as any)

    const res = await GET(new NextRequest("http://localhost/api/payroll/runs"))
    expect(res.status).toBe(200)
    expect(range).toHaveBeenCalledWith(0, 23)

    const body = await res.json()
    expect(body.runs).toHaveLength(1)
    expect(body.pagination).toMatchObject({
      page: 1,
      limit: 24,
      totalCount: 1,
      hasMore: false,
    })
  })

  it("does not cache auth failures", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn(),
    } as any)

    const res = await GET(new NextRequest("http://localhost/api/payroll/runs"))
    expect(res.status).toBe(401)
  })
})
