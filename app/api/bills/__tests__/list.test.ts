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
jest.mock("@/lib/server/resolveAuthenticatedApiUser", () => ({
  resolveAuthenticatedApiUser: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockResolveAuth = resolveAuthenticatedApiUser as jest.MockedFunction<
  typeof resolveAuthenticatedApiUser
>

const professionalRow = {
  industry: "service",
  service_subscription_tier: "professional",
  service_subscription_status: "active",
  subscription_started_at: "2026-01-01T00:00:00.000Z",
  current_period_ends_at: "2027-01-01T00:00:00.000Z",
}

function mockBillsRpc(bills: unknown[], totalCount: number) {
  return jest.fn().mockImplementation((name: string) => {
    if (name === "get_bills_list_page") {
      return Promise.resolve({
        data: { total_count: totalCount, bills },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected ${name}` } })
  })
}

function mockFrom(opts: { isFirmUser?: boolean; business?: Record<string, unknown> | null } = {}) {
  const { isFirmUser = false, business = professionalRow } = opts
  const started: string[] = []
  return {
    started,
    from: jest.fn((table: string) => {
      started.push(table)
      if (table === "accounting_firm_users") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({
            data: isFirmUser ? { firm_id: "firm-1" } : null,
            error: null,
          }),
        }
      }
      if (table === "businesses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: business, error: null }),
        }
      }
      return {}
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.FINZA_OPERATIONAL_LIST_CACHE_TTL_SEC
  mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })
  mockResolveAuth.mockResolvedValue({
    ok: true,
    user: { id: "user-001" } as never,
    authSource: "session",
  })
})

describe("GET /api/bills/list", () => {
  it("applies default page=1 and limit=50 via RPC", async () => {
    const bills = [{ id: "bill-1", total: 100, total_paid: 0, balance: 100 }]
    const rpc = mockBillsRpc(bills, 1)
    const { from } = mockFrom()
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }) },
      rpc,
      from,
    } as never)

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
    const rpc = mockBillsRpc([], 0)
    mockCreateSupabase.mockResolvedValue({ rpc, from: jest.fn() } as never)
    const res = await GET(
      new NextRequest("http://localhost/api/bills/list?business_id=biz-forged")
    )
    expect(res.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("returns TIER_REQUIRED without calling the bills RPC", async () => {
    const rpc = mockBillsRpc([], 0)
    const { from } = mockFrom({
      business: { ...professionalRow, service_subscription_tier: "starter" },
    })
    mockCreateSupabase.mockResolvedValue({ rpc, from } as never)
    const res = await GET(new NextRequest("http://localhost/api/bills/list?business_id=biz-a"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe("TIER_REQUIRED")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("skips the Service tier gate for firm users", async () => {
    const rpc = mockBillsRpc([], 0)
    const { from } = mockFrom({
      isFirmUser: true,
      business: { ...professionalRow, service_subscription_tier: "starter" },
    })
    mockCreateSupabase.mockResolvedValue({ rpc, from } as never)
    const res = await GET(new NextRequest("http://localhost/api/bills/list?business_id=biz-a"))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalled()
  })

  it("starts firm and entitlement business reads without waiting on each other", async () => {
    let releaseFirm: (value: { data: null; error: null }) => void = () => {}
    let releaseBiz: (value: { data: typeof professionalRow; error: null }) => void = () => {}
    const firmGate = new Promise<{ data: null; error: null }>((resolve) => {
      releaseFirm = resolve
    })
    const bizGate = new Promise<{ data: typeof professionalRow; error: null }>((resolve) => {
      releaseBiz = resolve
    })
    const started: string[] = []
    const rpc = mockBillsRpc([], 0)
    mockCreateSupabase.mockResolvedValue({
      rpc,
      from: jest.fn((table: string) => {
        started.push(table)
        if (table === "accounting_firm_users") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            maybeSingle: () => firmGate,
          }
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          maybeSingle: () => bizGate,
        }
      }),
    } as never)

    const pending = GET(new NextRequest("http://localhost/api/bills/list?business_id=biz-a"))
    await new Promise((resolve) => setImmediate(resolve))
    expect(started).toEqual(expect.arrayContaining(["accounting_firm_users", "businesses"]))
    expect(rpc).not.toHaveBeenCalled()
    releaseFirm({ data: null, error: null })
    releaseBiz({ data: professionalRow, error: null })
    const res = await pending
    expect(res.status).toBe(200)
  })

  it("caps limit at 100", async () => {
    const rpc = mockBillsRpc([], 0)
    const { from } = mockFrom()
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }) },
      rpc,
      from,
    } as never)

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
