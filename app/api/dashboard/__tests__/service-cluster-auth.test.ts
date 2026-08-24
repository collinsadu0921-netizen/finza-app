/**
 * GET /api/dashboard/service-cluster — session-first auth gate + Server-Timing.
 */

import { GET } from "../service-cluster/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/accountingAuth", () => ({
  checkAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/server/resolveAuthenticatedApiUser", () => ({
  resolveAuthenticatedApiUser: jest.fn(),
}))
jest.mock("@/lib/server/dashboardClusterCache", () => ({
  loadOrComputeDashboardClusterCache: jest.fn(),
  loadOrComputeDashboardActivityCache: jest.fn(),
  dashboardClusterCacheResponseHeaders: jest.fn(() => ({})),
}))
jest.mock("@/lib/server/serviceDashboardTimeline", () => ({
  loadServiceDashboardTimeline: jest.fn(),
  shouldCacheDashboardClusterPayload: jest.fn(),
}))
jest.mock("@/lib/server/serviceDashboardMetricsLoader", () => ({
  loadServiceDashboardMetrics: jest.fn(),
}))
jest.mock("@/lib/server/serviceDashboardActivityLoader", () => ({
  loadServiceDashboardActivityFeed: jest.fn(),
}))
jest.mock("@/lib/server/dashboardDefaultPnlPeriod", () => ({
  resolveDashboardDefaultPeriodStart: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import {
  loadOrComputeDashboardClusterCache,
  loadOrComputeDashboardActivityCache,
} from "@/lib/server/dashboardClusterCache"
import { loadServiceDashboardTimeline } from "@/lib/server/serviceDashboardTimeline"
import { loadServiceDashboardMetrics } from "@/lib/server/serviceDashboardMetricsLoader"
import { resolveDashboardDefaultPeriodStart } from "@/lib/server/dashboardDefaultPnlPeriod"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveAuth = resolveAuthenticatedApiUser as jest.MockedFunction<
  typeof resolveAuthenticatedApiUser
>
const mockAuthority = checkAccountingAuthority as jest.MockedFunction<typeof checkAccountingAuthority>
const mockClusterCache = loadOrComputeDashboardClusterCache as jest.MockedFunction<
  typeof loadOrComputeDashboardClusterCache
>
const mockActivityCache = loadOrComputeDashboardActivityCache as jest.MockedFunction<
  typeof loadOrComputeDashboardActivityCache
>
const mockTimeline = loadServiceDashboardTimeline as jest.MockedFunction<
  typeof loadServiceDashboardTimeline
>
const mockMetrics = loadServiceDashboardMetrics as jest.MockedFunction<
  typeof loadServiceDashboardMetrics
>
const mockDefaultPeriod = resolveDashboardDefaultPeriodStart as jest.MockedFunction<
  typeof resolveDashboardDefaultPeriodStart
>

const BIZ_A = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const USER = "user-001"

function authorizedUser() {
  mockResolveAuth.mockResolvedValue({
    ok: true,
    user: { id: USER } as never,
    authSource: "session",
  })
}

function clusterPayload() {
  return {
    timeline: [{ period_start: "2026-08-01", period_end: "2026-08-31" }],
    metrics: {
      period: { period_start: "2026-08-01", period_end: "2026-08-31", resolution_reason: "default" },
      currency: { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
      revenue: 100,
      expenses: 40,
      netProfit: 60,
      cashCollected: 80,
      accountsReceivable: 20,
      accountsPayable: 10,
      cashBalance: 50,
      positionBalancesAsOfToday: true,
      positionAsOfDate: "2026-08-24",
      previousPeriod: null,
      unpaidInvoicesTotal: 20,
      unpaidInvoicesCount: 1,
      overdueInvoicesTotal: 5,
      overdueInvoicesCount: 1,
      metrics_ready: true,
    },
    activity: { items: [] },
    timelineSource: "summary",
    timelineCacheable: true,
    dashboard_refresh_on_request: false,
    dashboard_refresh_skipped: true,
    dashboard_source: "summary",
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateSupabase.mockResolvedValue({} as any)
  mockAuthority.mockResolvedValue({ authorized: true, businessId: BIZ_A, authority_source: "owner" })
  mockClusterCache.mockResolvedValue({
    value: clusterPayload() as never,
    cacheSource: "fresh_hit",
    cache_age_ms: 12,
    refresh_mode: "skipped",
    cache_enabled: true,
    source: "cache_hit",
  } as never)
})

describe("GET /api/dashboard/service-cluster auth", () => {
  it("returns 401 with auth_failure_stage when auth fails", async () => {
    mockResolveAuth.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Unauthorized",
      authFailureStage: "missing_cookie",
    })

    const res = await GET(
      new NextRequest(
        `http://localhost/api/dashboard/service-cluster?business_id=${BIZ_A}`
      )
    )

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.auth_failure_stage).toBe("missing_cookie")
    expect(mockAuthority).not.toHaveBeenCalled()
    expect(mockClusterCache).not.toHaveBeenCalled()
    const timing = res.headers.get("Server-Timing") || ""
    expect(timing).toContain("auth;dur=")
    expect(timing).toContain("total;dur=")
    expect(timing).not.toContain(BIZ_A)
    expect(timing).not.toContain(USER)
  })

  it("returns 400 when business_id is missing", async () => {
    authorizedUser()
    const res = await GET(new NextRequest("http://localhost/api/dashboard/service-cluster"))
    expect(res.status).toBe(400)
    expect(mockAuthority).not.toHaveBeenCalled()
    expect(mockClusterCache).not.toHaveBeenCalled()
  })

  it("rejects a forged business_id before cluster compute", async () => {
    authorizedUser()
    mockAuthority.mockResolvedValue({ authorized: false, businessId: "biz-forged" })
    const res = await GET(
      new NextRequest(
        "http://localhost/api/dashboard/service-cluster?business_id=biz-forged"
      )
    )
    expect(res.status).toBe(403)
    expect(mockClusterCache).not.toHaveBeenCalled()
    const timing = res.headers.get("Server-Timing") || ""
    expect(timing).toContain("auth;dur=")
    expect(timing).toContain("scope;dur=")
    expect(timing).not.toContain("biz-forged")
  })

  it("exposes cache-hit Server-Timing without ids or SQL", async () => {
    authorizedUser()
    const res = await GET(
      new NextRequest(
        `http://localhost/api/dashboard/service-cluster?business_id=${BIZ_A}&periods=12&activity_limit=10`
      )
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.metrics.cashCollected).toBe(80)
    expect(body.metrics.unpaidInvoicesTotal).toBe(20)
    expect(body.dashboard_source).toBe("cache")
    const timing = res.headers.get("Server-Timing") || ""
    for (const name of [
      "auth",
      "scope",
      "timeline",
      "periods",
      "metrics",
      "activity",
      "cache",
      "assembly",
      "total",
    ]) {
      expect(timing).toContain(`${name};dur=`)
    }
    expect(timing).not.toContain("entitlement")
    expect(timing).not.toContain(BIZ_A)
    expect(timing).not.toContain(USER)
    expect(timing).not.toMatch(/select |get_service_dashboard/i)
    expect(mockAuthority).toHaveBeenCalledWith(expect.anything(), USER, BIZ_A, "read")
  })

  it("overlaps timeline, default period, and activity before metrics", async () => {
    authorizedUser()
    const started: Record<string, number> = {}
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    mockTimeline.mockImplementation(async () => {
      started.timeline = Date.now()
      await delay(40)
      return {
        timeline: [
          { period_start: "2026-07-01", period_end: "2026-07-31", revenue: 0, expenses: 0, netProfit: 0 },
          { period_start: "2026-08-01", period_end: "2026-08-31", revenue: 1, expenses: 0, netProfit: 1 },
        ],
        source: "summary_fresh",
        cacheable: true,
      } as never
    })
    mockDefaultPeriod.mockImplementation(async () => {
      started.periods = Date.now()
      await delay(40)
      return "2026-08-01"
    })
    mockActivityCache.mockImplementation(async () => {
      started.activity = Date.now()
      await delay(40)
      return { value: { items: [] }, source: "cache_miss", cache_enabled: true } as never
    })
    mockMetrics.mockImplementation(async (_sb, _biz, params, _diag, _opts, loadMeta) => {
      started.metrics = Date.now()
      expect(params.periodStart).toBe("2026-08-01")
      expect(params.previousPeriodStart).toBe("2026-07-01")
      if (loadMeta) loadMeta.source = "summary"
      return clusterPayload().metrics as never
    })
    mockClusterCache.mockImplementation(async (_key, compute) => {
      const value = await compute()
      return {
        value,
        cacheSource: "miss",
        cache_age_ms: 0,
        refresh_mode: "foreground",
        cache_enabled: true,
        source: "cache_miss",
      } as never
    })

    const res = await GET(
      new NextRequest(
        `http://localhost/api/dashboard/service-cluster?business_id=${BIZ_A}&periods=12&activity_limit=10`
      )
    )
    expect(res.status).toBe(200)
    expect(started.timeline).toBeDefined()
    expect(started.periods).toBeDefined()
    expect(started.activity).toBeDefined()
    expect(started.metrics).toBeDefined()
    expect(Math.abs(started.periods - started.timeline)).toBeLessThan(20)
    expect(Math.abs(started.activity - started.timeline)).toBeLessThan(20)
    expect(started.metrics - started.timeline).toBeGreaterThanOrEqual(35)
    const body = await res.json()
    expect(body.metrics.cashCollected).toBe(80)
    expect(body.activity.items).toEqual([])
    expect(body.dashboard_source).toBe("summary")
  })
})
