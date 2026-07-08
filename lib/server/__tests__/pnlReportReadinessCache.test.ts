import type { SupabaseClient } from "@supabase/supabase-js"

import {
  checkAccountingReadinessForPnlRoute,
  resetPnlReadinessCacheForTests,
} from "@/lib/server/pnlReportReadinessCache"

jest.mock("@/lib/accounting/readiness", () => ({
  checkAccountingReadiness: jest.fn(),
}))

import { checkAccountingReadiness } from "@/lib/accounting/readiness"

const mockReadiness = checkAccountingReadiness as jest.MockedFunction<typeof checkAccountingReadiness>

const supabase = {} as SupabaseClient

describe("pnlReportReadinessCache", () => {
  const prevTtl = process.env.FINZA_PNL_REPORT_READINESS_CACHE_TTL_SEC

  beforeEach(() => {
    resetPnlReadinessCacheForTests()
    jest.clearAllMocks()
    process.env.FINZA_PNL_REPORT_READINESS_CACHE_TTL_SEC = "45"
  })

  afterEach(() => {
    if (prevTtl === undefined) {
      delete process.env.FINZA_PNL_REPORT_READINESS_CACHE_TTL_SEC
    } else {
      process.env.FINZA_PNL_REPORT_READINESS_CACHE_TTL_SEC = prevTtl
    }
  })

  it("caches positive readiness only", async () => {
    mockReadiness.mockResolvedValue({ ready: true })

    const first = await checkAccountingReadinessForPnlRoute(supabase, "biz-a")
    const second = await checkAccountingReadinessForPnlRoute(supabase, "biz-a")

    expect(first).toEqual({ ready: true, readinessCacheStatus: "miss" })
    expect(second).toEqual({ ready: true, readinessCacheStatus: "hit" })
    expect(mockReadiness).toHaveBeenCalledTimes(1)
  })

  it("does not cache not-ready results", async () => {
    mockReadiness.mockResolvedValue({ ready: false })

    await checkAccountingReadinessForPnlRoute(supabase, "biz-a")
    await checkAccountingReadinessForPnlRoute(supabase, "biz-a")

    expect(mockReadiness).toHaveBeenCalledTimes(2)
  })
})
