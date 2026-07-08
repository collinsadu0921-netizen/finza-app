import type { SupabaseClient } from "@supabase/supabase-js"

import {
  isDefaultPnLPeriodRequest,
  resetPnlDefaultPeriodCacheForTests,
  resolvePnLMovementRangeForPnlRoute,
} from "@/lib/server/pnlReportDefaultPeriodCache"

jest.mock("@/lib/accounting/reports/resolvePnLMovementRange", () => ({
  resolvePnLMovementRange: jest.fn(),
}))

import { resolvePnLMovementRange } from "@/lib/accounting/reports/resolvePnLMovementRange"

const mockResolve = resolvePnLMovementRange as jest.MockedFunction<typeof resolvePnLMovementRange>

const sampleRange = {
  movementStart: "2026-07-01",
  movementEnd: "2026-07-31",
  period: {
    period_id: "p1",
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    resolution_reason: "latest_activity" as const,
  },
}

const supabase = {} as SupabaseClient

describe("pnlReportDefaultPeriodCache", () => {
  const prevTtl = process.env.FINZA_PNL_REPORT_PERIOD_CACHE_TTL_SEC

  beforeEach(() => {
    resetPnlDefaultPeriodCacheForTests()
    jest.clearAllMocks()
    process.env.FINZA_PNL_REPORT_PERIOD_CACHE_TTL_SEC = "45"
    mockResolve.mockResolvedValue({ range: sampleRange, error: "" })
  })

  afterEach(() => {
    if (prevTtl === undefined) {
      delete process.env.FINZA_PNL_REPORT_PERIOD_CACHE_TTL_SEC
    } else {
      process.env.FINZA_PNL_REPORT_PERIOD_CACHE_TTL_SEC = prevTtl
    }
  })

  it("identifies default period requests", () => {
    expect(
      isDefaultPnLPeriodRequest({
        businessId: "biz-a",
      })
    ).toBe(true)
    expect(
      isDefaultPnLPeriodRequest({
        businessId: "biz-a",
        start_date: "2026-01-01",
        end_date: "2026-01-31",
      })
    ).toBe(false)
    expect(
      isDefaultPnLPeriodRequest({
        businessId: "biz-a",
        period_id: "p1",
      })
    ).toBe(false)
  })

  it("caches default period resolution on second call", async () => {
    const input = { businessId: "biz-a" }

    const first = await resolvePnLMovementRangeForPnlRoute(supabase, input)
    const second = await resolvePnLMovementRangeForPnlRoute(supabase, input)

    expect(first.periodCacheStatus).toBe("miss")
    expect(second.periodCacheStatus).toBe("hit")
    expect(mockResolve).toHaveBeenCalledTimes(1)
    expect(second.range).toEqual(sampleRange)
  })

  it("disables cache for explicit date ranges", async () => {
    const input = {
      businessId: "biz-a",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
    }

    await resolvePnLMovementRangeForPnlRoute(supabase, input)
    await resolvePnLMovementRangeForPnlRoute(supabase, input)

    expect(mockResolve).toHaveBeenCalledTimes(2)
  })
})
