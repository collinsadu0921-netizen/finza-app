import { GET } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/accounting/permissions", () => {
  const actual = jest.requireActual("@/lib/accounting/permissions")
  return actual
})
jest.mock("@/lib/accounting/resolveAccountingRequestAuthority", () => ({
  resolveAccountingRequestAuthority: jest.fn(),
  getAccountingDataClient: jest.fn((_auth, client) => client),
  getAccountingIdentityClient: jest.fn((_auth, client) => client),
}))
jest.mock("@/lib/accounting/bootstrap", () => ({
  canUserInitializeAccounting: jest.fn(),
}))
jest.mock("@/lib/accounting/readiness", () => ({
  checkAccountingReadiness: jest.fn(),
}))
jest.mock("@/lib/accounting/reports/getBalanceSheetReport", () => ({
  getBalanceSheetReport: jest.fn(),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import {
  getAccountingDataClient,
  getAccountingIdentityClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>
const mockAuth = resolveAccountingRequestAuthority as jest.MockedFunction<
  typeof resolveAccountingRequestAuthority
>
const mockDataClient = getAccountingDataClient as jest.MockedFunction<typeof getAccountingDataClient>
const mockIdentityClient = getAccountingIdentityClient as jest.MockedFunction<
  typeof getAccountingIdentityClient
>
const mockCanBootstrap = canUserInitializeAccounting as jest.MockedFunction<
  typeof canUserInitializeAccounting
>
const mockReady = checkAccountingReadiness as jest.MockedFunction<typeof checkAccountingReadiness>
const mockReport = getBalanceSheetReport as jest.MockedFunction<typeof getBalanceSheetReport>

const report = {
  period: {
    period_id: "p1",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    resolution_reason: "as_of_date",
  },
  currency: { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi" },
  as_of_date: "2026-08-22",
  business_type: "limited_company" as const,
  sections: [],
  totals: {
    assets: 10,
    liabilities: 4,
    equity: 6,
    liabilities_plus_equity: 10,
    is_balanced: true,
    imbalance: 0,
  },
  telemetry: {
    resolved_period_reason: "as_of_date",
    resolved_period_start: "2026-08-01",
    resolved_period_end: "2026-08-31",
    source: "ledger" as const,
    version: 2,
  },
}

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: {
      "x-workspace": "accounting",
      "x-permissions": "accounting:read",
    },
  })
}

const ownerAuth = {
  ok: true as const,
  userId: "user-1",
  businessId: "biz-a",
  requiredLevel: "read" as const,
  grantedLevel: "owner" as const,
  authoritySource: "owner" as const,
  isPractice: false,
  firmId: null,
  engagementId: null,
  engagementStatus: null,
  practiceRole: null,
  assignmentScoped: false,
  reason: null,
  serviceRole: "owner",
  timings: {
    role_ms: 1,
    authority_ms: 0,
    membership_ms: 0,
    engagement_ms: 0,
    assignment_ms: 0,
    total_ms: 1,
    strategy: "parallel" as const,
  },
}

describe("GET /api/accounting/reports/balance-sheet", () => {
  const rpc = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockDataClient.mockImplementation((_auth, client) => client)
    mockIdentityClient.mockImplementation((_auth, client) => client)
    mockCreate.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      rpc,
    } as never)
    mockAuth.mockResolvedValue(ownerAuth)
    mockCanBootstrap.mockReturnValue(true)
    mockReady.mockResolvedValue({ ready: true })
    mockReport.mockResolvedValue({ data: report, error: "", timings: undefined })
  })

  it("returns 401 when unauthenticated", async () => {
    mockCreate.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      rpc,
    } as never)
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a"))
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("returns 400 without business_id", async () => {
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet"))
    expect(res.status).toBe(400)
  })

  it("denies unauthorized business access", async () => {
    mockAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_AUTHORITY",
      businessId: "biz-b",
    })
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-b"))
    expect(res.status).toBe(403)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("overlaps readiness and the first report after authority", async () => {
    let readyStarted = 0
    let reportStarted = 0
    mockReady.mockImplementation(async () => {
      readyStarted = performance.now()
      await new Promise((r) => setTimeout(r, 40))
      return { ready: true }
    })
    mockReport.mockImplementation(async () => {
      reportStarted = performance.now()
      await new Promise((r) => setTimeout(r, 40))
      return { data: report, error: "", timings: undefined }
    })
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a"))
    expect(res.status).toBe(200)
    expect(mockReady).toHaveBeenCalledTimes(1)
    expect(mockReport).toHaveBeenCalledTimes(1)
    expect(Math.abs(readyStarted - reportStarted)).toBeLessThan(20)
  })

  it("does not bootstrap when accounting is already ready", async () => {
    const res = await GET(
      makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-22")
    )
    expect(res.status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
    expect(mockReady).toHaveBeenCalledTimes(1)
    expect(mockReport).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.totals.assets).toBe(10)
    expect(body.as_of_date).toBe("2026-08-22")
  })

  it("returns Practice READ 200 without bootstrap when ready", async () => {
    mockCanBootstrap.mockReturnValue(false)
    mockAuth.mockResolvedValue({
      ...ownerAuth,
      isPractice: true,
      authoritySource: "practice",
      grantedLevel: "read",
    })
    const res = await GET(
      makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-22")
    )
    expect(res.status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
    expect(mockReport).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.totals.assets).toBe(10)
  })

  it("uses the user session as rpcClient for 577 RPCs when Practice authority succeeds", async () => {
    const userClient = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "firm-1" } } }) },
      rpc,
    }
    const adminClient = { kind: "admin" }
    mockCreate.mockResolvedValue(userClient as never)
    mockDataClient.mockReturnValue(adminClient as never)
    mockIdentityClient.mockImplementation((_auth, client) => client)
    mockCanBootstrap.mockReturnValue(false)
    mockAuth.mockResolvedValue({
      ...ownerAuth,
      userId: "firm-1",
      isPractice: true,
      authoritySource: "practice",
      grantedLevel: "read",
      engagementStatus: "accepted",
    })
    const res = await GET(
      makeRequest(
        "/api/accounting/reports/balance-sheet?business_id=4e6cdfba-e2ab-4ee4-ac00-9b077d696544&as_of_date=2026-08-26"
      )
    )
    expect(res.status).toBe(200)
    expect(mockIdentityClient).toHaveBeenCalled()
    expect(mockReport).toHaveBeenCalledWith(
      adminClient,
      expect.objectContaining({
        businessId: "4e6cdfba-e2ab-4ee4-ac00-9b077d696544",
        as_of_date: "2026-08-26",
      }),
      { rpcClient: userClient }
    )
    expect(mockReady).toHaveBeenCalledWith(
      adminClient,
      "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
    )
  })

  it("uses the user session as rpcClient for Practice active engagement", async () => {
    const userClient = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "firm-1" } } }) },
      rpc,
    }
    mockCreate.mockResolvedValue(userClient as never)
    mockIdentityClient.mockImplementation((_auth, client) => client)
    mockAuth.mockResolvedValue({
      ...ownerAuth,
      isPractice: true,
      authoritySource: "practice",
      grantedLevel: "read",
      engagementStatus: "active",
    })
    const res = await GET(
      makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-26")
    )
    expect(res.status).toBe(200)
    expect(mockReport.mock.calls[0][2]).toEqual({ rpcClient: userClient })
  })

  it.each([
    "INSUFFICIENT_AUTHORITY",
    "ENGAGEMENT_PENDING",
    "ENGAGEMENT_SUSPENDED",
    "ENGAGEMENT_EXPIRED",
  ])("denies Practice HTTP when authority is %s", async (reasonCode) => {
    mockAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode,
      businessId: "biz-a",
    })
    const res = await GET(
      makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-26")
    )
    expect(res.status).toBe(403)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("denies a forged business_id before any report RPC", async () => {
    mockAuth.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_AUTHORITY",
      businessId: "00000000-0000-4000-8000-000000000001",
    })
    const res = await GET(
      makeRequest(
        "/api/accounting/reports/balance-sheet?business_id=00000000-0000-4000-8000-000000000001"
      )
    )
    expect(res.status).toBe(403)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it("keeps the owner session as both data and identity client", async () => {
    const userClient = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      rpc,
    }
    mockCreate.mockResolvedValue(userClient as never)
    mockDataClient.mockImplementation((_auth, client) => client)
    mockIdentityClient.mockImplementation((_auth, client) => client)
    const res = await GET(
      makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-26")
    )
    expect(res.status).toBe(200)
    expect(mockReport).toHaveBeenCalledWith(
      userClient,
      expect.objectContaining({ businessId: "biz-a" }),
      { rpcClient: userClient }
    )
  })

  it("propagates report computation failure as 500", async () => {
    mockReport.mockResolvedValue({ data: null, error: "ledger unavailable", timings: undefined })
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("ledger unavailable")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("bootstraps then reloads only when not ready and caller can initialize", async () => {
    mockReady.mockResolvedValue({ ready: false })
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a"))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("create_system_accounts", { p_business_id: "biz-a" })
    expect(mockReport).toHaveBeenCalledTimes(2)
  })

  it("returns 403 for Practice when not ready", async () => {
    mockCanBootstrap.mockReturnValue(false)
    mockReady.mockResolvedValue({ ready: false })
    mockAuth.mockResolvedValue({
      ...ownerAuth,
      isPractice: true,
      authoritySource: "practice",
      grantedLevel: "read",
    })
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("ACCOUNTING_NOT_READY")
    expect(rpc).not.toHaveBeenCalled()
  })
})
