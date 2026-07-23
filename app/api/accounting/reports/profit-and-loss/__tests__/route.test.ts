/**
 * GET /api/accounting/reports/profit-and-loss — full-response cache + auth gate.
 */

import { GET } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))
jest.mock("@/lib/server/resolveAuthenticatedApiUser", () => ({
  resolveAuthenticatedApiUser: jest.fn(),
  authFailureStageForScopeError: jest.fn((status: number) =>
    status === 403 ? "business_access_denied" : "unknown"
  ),
}))
jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/server/pnlReportReadinessCache", () => ({
  checkAccountingReadinessForPnlRoute: jest.fn().mockResolvedValue({
    ready: true,
    readinessCacheStatus: "miss",
  }),
}))
jest.mock("@/lib/accounting/bootstrap", () => ({
  canUserInitializeAccounting: jest.fn().mockReturnValue(false),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn().mockResolvedValue("owner"),
}))
jest.mock("@/lib/server/pnlReportDefaultPeriodCache", () => ({
  resolvePnLMovementRangeForPnlRoute: jest.fn().mockResolvedValue({
    range: {
      movementStart: "2026-01-01",
      movementEnd: "2026-01-31",
      period: { period_id: "p1", period_start: "2026-01-01", period_end: "2026-01-31" },
    },
    error: "",
    periodCacheStatus: "miss",
  }),
}))
jest.mock("@/lib/accounting/reports/getProfitAndLossReport", () => ({
  getProfitAndLossReport: jest.fn(),
}))
jest.mock("@/lib/server/pnlReportCache", () => {
  const actual = jest.requireActual("@/lib/server/pnlReportCache")
  return {
    ...actual,
    resetPnlReportCacheForTests: actual.resetPnlReportCacheForTests,
  }
})

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { checkAccountingReadinessForPnlRoute } from "@/lib/server/pnlReportReadinessCache"
import { resolvePnLMovementRangeForPnlRoute } from "@/lib/server/pnlReportDefaultPeriodCache"
import { getUserRole } from "@/lib/userRoles"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"
import { resetPnlReportCacheForTests } from "@/lib/server/pnlReportCache"
import { resetPnlScopeCacheForTests } from "@/lib/server/pnlReportScopeCache"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveAuth = resolveAuthenticatedApiUser as jest.MockedFunction<
  typeof resolveAuthenticatedApiUser
>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockCheckAuthority = checkAccountingAuthority as jest.MockedFunction<
  typeof checkAccountingAuthority
>
const mockGetReport = getProfitAndLossReport as jest.MockedFunction<typeof getProfitAndLossReport>
const mockGetUserRole = getUserRole as jest.MockedFunction<typeof getUserRole>
const mockReadiness = checkAccountingReadinessForPnlRoute as jest.MockedFunction<
  typeof checkAccountingReadinessForPnlRoute
>
const mockResolvePeriod = resolvePnLMovementRangeForPnlRoute as jest.MockedFunction<
  typeof resolvePnLMovementRangeForPnlRoute
>

const sampleReport = {
  period: {
    period_id: "p1",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    resolution_reason: "period_id",
  },
  currency: { code: "GHS", symbol: "₵", name: "Ghanaian Cedi" },
  sections: [],
  totals: {
    gross_profit: 100,
    operating_profit: 100,
    profit_before_tax: 100,
    net_profit: 100,
  },
  telemetry: {
    resolved_period_reason: "period_id",
    resolved_period_start: "2026-01-01",
    resolved_period_end: "2026-01-31",
    source: "snapshot",
    version: 2,
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  resetPnlReportCacheForTests()
  resetPnlScopeCacheForTests()
  delete process.env.FINZA_REPORTS_PNL_REFRESH_ON_REQUEST
  process.env.FINZA_PNL_REPORT_CACHE_TTL_SEC = "30"
  process.env.FINZA_PNL_REPORT_SCOPE_CACHE_TTL_SEC = "45"

  mockCreateSupabase.mockResolvedValue({
    auth: { getSession: jest.fn(), getUser: jest.fn() },
    rpc: jest.fn(),
  } as any)

  mockResolveAuth.mockResolvedValue({
    ok: true,
    user: { id: "user-1" } as any,
    authSource: "session",
  })
  mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })
  mockCheckAuthority.mockResolvedValue({
    authorized: true,
    authority_source: "owner",
  } as any)
  mockGetReport.mockImplementation(async (_supabase, _input, _opts, loadMeta) => {
    if (loadMeta) {
      loadMeta.movementSource = "snapshot"
      loadMeta.snapshotStale = false
    }
    return { data: sampleReport, error: "" }
  })
})

describe("GET /api/accounting/reports/profit-and-loss", () => {
  it("returns 403 before cache when business access denied", async () => {
    mockCheckAuthority.mockResolvedValue({
      authorized: false,
      authority_source: "employee",
    } as any)

    const req = new NextRequest(
      "http://localhost/api/accounting/reports/profit-and-loss?business_id=biz-a"
    )
    const res = await GET(req)

    expect(res.status).toBe(403)
    expect(mockGetReport).not.toHaveBeenCalled()
  })

  it("caches positive scope checks on repeated explicit business_id requests", async () => {
    const req = new NextRequest(
      "http://localhost/api/accounting/reports/profit-and-loss?business_id=biz-a"
    )
    await GET(req)
    await GET(req)

    expect(mockGetUserRole).toHaveBeenCalledTimes(1)
    expect(mockResolveScope).toHaveBeenCalledTimes(1)
    expect(mockCheckAuthority).toHaveBeenCalledTimes(1)
  })

  it("returns cached final response on repeated same-key request", async () => {
    const req = new NextRequest(
      "http://localhost/api/accounting/reports/profit-and-loss?business_id=biz-a"
    )

    const first = await GET(req)
    const second = await GET(req)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(mockGetReport).toHaveBeenCalledTimes(1)
    expect(second.headers.get("x-finza-reports-cache")).toBe("fresh_hit")
    expect(second.headers.get("x-finza-reports-source")).toBe("cache")
  })

  it("sets diagnostic headers on 200", async () => {
    const req = new NextRequest(
      "http://localhost/api/accounting/reports/profit-and-loss?business_id=biz-a"
    )
    const res = await GET(req)

    expect(res.headers.get("x-finza-reports-refresh-on-request")).toBe("disabled")
    expect(res.headers.get("x-finza-reports-cache")).toBe("miss")
    expect(res.headers.get("x-finza-reports-source")).toBe("fresh_snapshot")
  })

  it("runs readiness and period resolution concurrently and passes preResolvedRange", async () => {
    let readinessStarted = false
    let periodStarted = false
    let readinessSawPeriod = false
    let periodSawReadiness = false

    mockReadiness.mockImplementation(async () => {
      readinessStarted = true
      periodSawReadiness = periodStarted
      await new Promise((r) => setTimeout(r, 20))
      return { ready: true, readinessCacheStatus: "miss" as const }
    })
    mockResolvePeriod.mockImplementation(async () => {
      periodStarted = true
      readinessSawPeriod = readinessStarted
      await new Promise((r) => setTimeout(r, 20))
      return {
        range: {
          movementStart: "2026-01-01",
          movementEnd: "2026-01-31",
          period: {
            period_id: "p1",
            period_start: "2026-01-01",
            period_end: "2026-01-31",
            resolution_reason: "period_id" as const,
          },
        },
        error: "",
        periodCacheStatus: "miss" as const,
      }
    })

    const req = new NextRequest(
      "http://localhost/api/accounting/reports/profit-and-loss?business_id=biz-a"
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(mockReadiness).toHaveBeenCalledTimes(1)
    expect(mockResolvePeriod).toHaveBeenCalledTimes(1)
    // Concurrent start: each saw the other already started (or both started before either finished).
    expect(readinessStarted && periodStarted).toBe(true)
    expect(readinessSawPeriod || periodSawReadiness).toBe(true)
    expect(mockGetReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ businessId: "biz-a" }),
      expect.objectContaining({
        preResolvedRange: expect.objectContaining({
          movementStart: "2026-01-01",
          movementEnd: "2026-01-31",
        }),
      }),
      expect.anything()
    )
  })
})
