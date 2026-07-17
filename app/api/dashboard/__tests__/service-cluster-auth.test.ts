/**
 * GET /api/dashboard/service-cluster — session-first auth gate.
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
import { resolveAuthenticatedApiUser } from "@/lib/server/resolveAuthenticatedApiUser"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockResolveAuth = resolveAuthenticatedApiUser as jest.MockedFunction<
  typeof resolveAuthenticatedApiUser
>

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateSupabase.mockResolvedValue({} as any)
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
        "http://localhost/api/dashboard/service-cluster?business_id=biz-a"
      )
    )

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.auth_failure_stage).toBe("missing_cookie")
  })
})
