/**
 * GET /api/dashboard/service-timeline — summary-first timeline with 509 first-load refresh.
 */

import { GET } from "../service-timeline/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/accountingAuth", () => ({
  checkAccountingAuthority: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockCheckAuth = checkAccountingAuthority as jest.MockedFunction<
  typeof checkAccountingAuthority
>

const timelineRows = [
  {
    period_id: "period-1",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    revenue: 1000,
    expenses: 400,
    net_profit: 600,
  },
  {
    period_id: "period-2",
    period_start: "2026-02-01",
    period_end: "2026-02-28",
    revenue: 0,
    expenses: 0,
    net_profit: 0,
  },
]

function mockTimelineRpc(options: {
  freshRows?: unknown[]
  staleRows?: unknown[] | ((call: number) => unknown[])
  blockingRefreshCount?: number
  tryRefresh?: { refreshed: boolean; lock_held: boolean; period_count: number }
}) {
  let freshCalls = 0
  let staleCalls = 0
  return jest.fn().mockImplementation((name: string) => {
    if (name === "get_service_dashboard_timeline_from_summary") {
      freshCalls += 1
      if (options.freshRows && freshCalls === 1) {
        return Promise.resolve({ data: options.freshRows, error: null })
      }
      if (freshCalls > 1 && options.blockingRefreshCount) {
        return Promise.resolve({ data: timelineRows, error: null })
      }
      return Promise.resolve({ data: options.freshRows ?? [], error: null })
    }
    if (name === "get_service_dashboard_timeline_stale_summary") {
      staleCalls += 1
      if (typeof options.staleRows === "function") {
        return Promise.resolve({ data: (options.staleRows as (n: number) => unknown[])(staleCalls), error: null })
      }
      return Promise.resolve({ data: options.staleRows ?? [], error: null })
    }
    if (name === "refresh_service_dashboard_period_summaries") {
      return Promise.resolve({
        data: options.blockingRefreshCount ?? 0,
        error: null,
      })
    }
    if (name === "try_refresh_service_dashboard_period_summaries") {
      return Promise.resolve({
        data: options.tryRefresh ?? { refreshed: true, lock_held: false, period_count: 2 },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.FINZA_DASHBOARD_CLUSTER_CACHE_TTL_SEC
  mockCheckAuth.mockResolvedValue({ authorized: true } as any)
})

describe("GET /api/dashboard/service-timeline", () => {
  it("returns 401 when unauthenticated", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: jest.fn(),
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a")
    )
    expect(res.status).toBe(401)
  })

  it("returns fresh summary when rows exist", async () => {
    const freshRows = Array.from({ length: 6 }, (_, i) => ({
      period_id: `period-${i + 1}`,
      period_start: `2026-0${i + 1}-01`,
      period_end: `2026-0${i + 1}-28`,
      revenue: 100,
      expenses: 40,
      net_profit: 60,
    }))
    const rpc = mockTimelineRpc({ freshRows })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a")
    )
    expect(res.status).toBe(200)
    expect(rpc).not.toHaveBeenCalledWith(
      "get_service_dashboard_timeline_stale_summary",
      expect.anything()
    )
    const body = await res.json()
    expect(body.timeline).toHaveLength(6)
  })

  it("returns stale summary on lock held without live scan", async () => {
    const staleRowData = Array.from({ length: 6 }, (_, i) => ({
      period_id: `period-${i + 1}`,
      period_start: `2026-0${i + 1}-01`,
      period_end: `2026-0${i + 1}-28`,
      revenue: 50,
      expenses: 20,
      net_profit: 30,
    }))
    const rpc = mockTimelineRpc({
      staleRows: (n: number) => (n >= 3 ? staleRowData : []),
      blockingRefreshCount: 0,
      tryRefresh: { refreshed: false, lock_held: true, period_count: 0 },
    })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a")
    )
    expect(res.status).toBe(200)
    expect(rpc).not.toHaveBeenCalledWith("get_service_dashboard_timeline", expect.anything())
    const body = await res.json()
    expect(body.timeline).toHaveLength(6)
  })

  it("cold start runs blocking refresh and returns rows", async () => {
    const rpc = mockTimelineRpc({ blockingRefreshCount: 2 })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a&periods=2")
    )
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("refresh_service_dashboard_period_summaries", {
      p_business_id: "biz-a",
      p_periods_limit: 2,
    })
    const body = await res.json()
    expect(body.timeline).toHaveLength(2)
  })
})
