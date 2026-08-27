import { GET } from "../route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/accounting/resolveAccountingContext", () => ({
  resolveAccountingContext: jest.fn(),
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
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"

const mockCreate = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>
const mockAuth = checkAccountingAuthority as jest.MockedFunction<typeof checkAccountingAuthority>
const mockContext = resolveAccountingContext as jest.MockedFunction<typeof resolveAccountingContext>
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

describe("GET /api/accounting/reports/balance-sheet", () => {
  const rpc = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    mockCreate.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
      rpc,
    } as never)
    mockContext.mockResolvedValue({ businessId: "biz-a" } as never)
    mockAuth.mockResolvedValue({ authorized: true, authority_source: "owner", businessId: "biz-a" })
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
    mockContext.mockResolvedValue({ error: "missing" } as never)
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet"))
    expect(res.status).toBe(400)
  })

  it("denies unauthorized business access", async () => {
    mockAuth.mockResolvedValue({ authorized: false, businessId: "biz-b" })
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
    expect(mockReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ businessId: "biz-a" }),
      expect.objectContaining({ rpcClient: expect.anything() })
    )
    const body = await res.json()
    expect(body.totals.assets).toBe(10)
    expect(body.as_of_date).toBe("2026-08-22")
  })

  it("returns 200 for a non-bootstrap reader when ready", async () => {
    mockCanBootstrap.mockReturnValue(false)
    mockAuth.mockResolvedValue({
      authorized: true,
      authority_source: "accountant",
      businessId: "biz-a",
    })
    const res = await GET(
      makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a&as_of_date=2026-08-22")
    )
    expect(res.status).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
    expect(mockReport).toHaveBeenCalledTimes(1)
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

  it("returns 403 when not ready and caller cannot initialize", async () => {
    mockCanBootstrap.mockReturnValue(false)
    mockReady.mockResolvedValue({ ready: false })
    mockAuth.mockResolvedValue({
      authorized: true,
      authority_source: "accountant",
      businessId: "biz-a",
    })
    const res = await GET(makeRequest("/api/accounting/reports/balance-sheet?business_id=biz-a"))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("ACCOUNTING_NOT_READY")
    expect(rpc).not.toHaveBeenCalled()
  })
})
