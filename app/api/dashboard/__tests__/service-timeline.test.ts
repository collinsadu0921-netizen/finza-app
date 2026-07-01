/**
 * GET /api/dashboard/service-timeline — consolidated timeline RPC.
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

function mockTimelineRpc(summaryRows: unknown[] = []) {
  return jest.fn().mockImplementation((name: string) => {
    if (name === "get_service_dashboard_timeline_from_summary") {
      return Promise.resolve({ data: summaryRows, error: null })
    }
    if (name === "get_service_dashboard_timeline") {
      return Promise.resolve({ data: timelineRows, error: null })
    }
    if (name === "refresh_service_dashboard_period_summaries") {
      return Promise.resolve({ data: 2, error: null })
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
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

  it("returns 400 when business_id missing", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: jest.fn(),
    } as any)

    const res = await GET(new NextRequest("http://localhost/api/dashboard/service-timeline"))
    expect(res.status).toBe(400)
  })

  it("falls back to live timeline when summary is empty", async () => {
    const rpc = mockTimelineRpc([])
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a")
    )
    expect(res.status).toBe(200)

    expect(rpc).toHaveBeenCalledWith("get_service_dashboard_timeline_from_summary", {
      p_business_id: "biz-a",
      p_periods_limit: 6,
      p_max_stale_seconds: 300,
    })
    expect(rpc).toHaveBeenCalledWith("get_service_dashboard_timeline", {
      p_business_id: "biz-a",
      p_start_date: null,
      p_end_date: null,
      p_granularity: "accounting_period",
      p_periods_limit: 6,
    })
    expect(rpc).toHaveBeenCalledWith("refresh_service_dashboard_period_summaries", {
      p_business_id: "biz-a",
      p_periods_limit: 6,
    })

    const body = await res.json()
    expect(body.timeline).toHaveLength(2)
    expect(body.timeline[0]).toEqual({
      period_id: "period-1",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      revenue: 1000,
      expenses: 400,
      netProfit: 600,
    })
    expect(body.timeline[1].netProfit).toBe(0)
  })

  it("uses summary when enough fresh rows exist", async () => {
    const summaryRows = Array.from({ length: 6 }, (_, i) => ({
      period_id: `period-${i + 1}`,
      period_start: `2026-0${i + 1}-01`,
      period_end: `2026-0${i + 1}-28`,
      revenue: 100,
      expenses: 40,
      net_profit: 60,
    }))
    const rpc = mockTimelineRpc(summaryRows)
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a")
    )
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      "get_service_dashboard_timeline_from_summary",
      expect.objectContaining({ p_periods_limit: 6 })
    )
    expect(rpc).not.toHaveBeenCalledWith(
      "get_service_dashboard_timeline",
      expect.anything()
    )
    const body = await res.json()
    expect(body.timeline).toHaveLength(6)
  })

  it("respects periods query param up to max 24", async () => {
    const rpc = mockTimelineRpc([])
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest(
        "http://localhost/api/dashboard/service-timeline?business_id=biz-a&periods=12"
      )
    )
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      "get_service_dashboard_timeline",
      expect.objectContaining({ p_periods_limit: 12 })
    )
  })

  it("caps invalid periods param to default 6", async () => {
    const rpc = mockTimelineRpc([])
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    await GET(
      new NextRequest(
        "http://localhost/api/dashboard/service-timeline?business_id=biz-a&periods=abc"
      )
    )
    expect(rpc).toHaveBeenCalledWith(
      "get_service_dashboard_timeline",
      expect.objectContaining({ p_periods_limit: 6 })
    )
  })

  it("returns empty timeline when live RPC returns no rows", async () => {
    const rpc = jest.fn().mockImplementation((name: string) => {
      if (name === "get_service_dashboard_timeline_from_summary") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "get_service_dashboard_timeline") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "refresh_service_dashboard_period_summaries") {
        return Promise.resolve({ data: 0, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a")
    )
    const body = await res.json()
    expect(body.timeline).toEqual([])
  })

  it("returns 500 when live RPC fails", async () => {
    const rpc = jest.fn().mockImplementation((name: string) => {
      if (name === "get_service_dashboard_timeline_from_summary") {
        return Promise.resolve({ data: [], error: null })
      }
      if (name === "get_service_dashboard_timeline") {
        return Promise.resolve({
          data: null,
          error: { message: "function does not exist" },
        })
      }
      return Promise.resolve({ data: null, error: null })
    })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
    } as any)

    const res = await GET(
      new NextRequest("http://localhost/api/dashboard/service-timeline?business_id=biz-a")
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Could not load dashboard timeline")
  })
})
