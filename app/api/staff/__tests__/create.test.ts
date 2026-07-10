import { POST } from "../create/route"
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
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockGetBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>
const mockRequirePermission = requirePermission as jest.MockedFunction<typeof requirePermission>

const baseBody = {
  name: "Jane Doe",
  basic_salary: 3500,
  start_date: "2026-06-01",
}

function mockCreateRoute(insertResult: { data?: unknown; error?: { message: string } | null }) {
  const single = jest.fn().mockResolvedValue(insertResult)
  const select = jest.fn().mockReturnValue({ single })
  const insert = jest.fn().mockReturnValue({ select })
  mockCreateSupabase.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    from: jest.fn((table: string) => {
      if (table !== "staff") throw new Error(`unexpected table ${table}`)
      return { insert }
    }),
  } as any)
  return { insert, single }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("POST /api/staff/create", () => {
  it("stores is_pensionable=false when provided", async () => {
    const { insert, single } = mockCreateRoute({
      data: { id: "staff-1", is_pensionable: false },
      error: null,
    })

    const res = await POST(
      new NextRequest("http://localhost/api/staff/create", {
        method: "POST",
        body: JSON.stringify({ ...baseBody, is_pensionable: false }),
      })
    )

    expect(res.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: "biz-1",
        is_pensionable: false,
      })
    )
    expect(single).toHaveBeenCalled()
  })

  it("omits is_pensionable from insert when not provided (DB default true)", async () => {
    const { insert } = mockCreateRoute({
      data: { id: "staff-1", is_pensionable: true },
      error: null,
    })

    const res = await POST(
      new NextRequest("http://localhost/api/staff/create", {
        method: "POST",
        body: JSON.stringify(baseBody),
      })
    )

    expect(res.status).toBe(201)
    const row = insert.mock.calls[0][0]
    expect(row.is_pensionable).toBeUndefined()
  })

  it("stores GRA payroll tax fields when provided", async () => {
    const { insert } = mockCreateRoute({
      data: {
        id: "staff-1",
        is_tax_resident: false,
        secondary_employment: true,
        gra_position_code: "MNGT",
      },
      error: null,
    })

    const res = await POST(
      new NextRequest("http://localhost/api/staff/create", {
        method: "POST",
        body: JSON.stringify({
          ...baseBody,
          is_tax_resident: false,
          secondary_employment: true,
          gra_position_code: "mngt",
        }),
      })
    )

    expect(res.status).toBe(201)
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        is_tax_resident: false,
        secondary_employment: true,
        gra_position_code: "MNGT",
      })
    )
  })

  it("rejects invalid gra_position_code", async () => {
    mockCreateRoute({ data: null, error: null })

    const res = await POST(
      new NextRequest("http://localhost/api/staff/create", {
        method: "POST",
        body: JSON.stringify({ ...baseBody, gra_position_code: "INVALID" }),
      })
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/gra_position_code/i)
  })

  it("requires STAFF_MANAGE permission", async () => {
    mockRequirePermission.mockResolvedValue({ allowed: false } as any)
    mockCreateRoute({ data: { id: "staff-1" }, error: null })

    const res = await POST(
      new NextRequest("http://localhost/api/staff/create", {
        method: "POST",
        body: JSON.stringify(baseBody),
      })
    )

    expect(res.status).toBe(403)
    expect(mockRequirePermission).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "biz-1",
      expect.stringMatching(/staff/i)
    )
  })

  it("scopes staff insert to current business", async () => {
    const { insert } = mockCreateRoute({
      data: { id: "staff-1", business_id: "biz-1" },
      error: null,
    })

    await POST(
      new NextRequest("http://localhost/api/staff/create", {
        method: "POST",
        body: JSON.stringify(baseBody),
      })
    )

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ business_id: "biz-1" }))
  })
})
