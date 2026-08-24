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

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { loadOrComputeDashboardClusterCache } from "@/lib/server/dashboardClusterCache"

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
})
