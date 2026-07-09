import {
  dashboardLiveFallbackTimeoutMs,
  mergeTimelineWithLiveMissingPeriods,
  withBoundedTimeout,
} from "@/lib/server/dashboardMetricsLedgerFallback"

describe("dashboardMetricsLedgerFallback", () => {
  it("mergeTimelineWithLiveMissingPeriods adds periods absent from summary", () => {
    const summary = [
      {
        period_id: "a",
        period_start: "2026-06-01",
        period_end: "2026-06-30",
        revenue: 100,
        expenses: 20,
        net_profit: 80,
      },
    ]
    const live = [
      {
        period_id: "b",
        period_start: "2026-07-01",
        period_end: "2026-07-31",
        revenue: 4133.34,
        expenses: 7119,
        net_profit: -2985.66,
      },
      ...summary,
    ]
    const { rows, patchedPeriods } = mergeTimelineWithLiveMissingPeriods(summary, live, 12)
    expect(patchedPeriods).toEqual(["2026-07-01"])
    expect(rows[0].period_start).toBe("2026-07-01")
    expect(rows[0].revenue).toBe(4133.34)
  })

  it("withBoundedTimeout resolves on timeout", async () => {
    jest.useFakeTimers()
    const slow = new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 5000)
    })
    const raced = withBoundedTimeout(slow, 100, () => "timeout")
    jest.advanceTimersByTime(100)
    await expect(raced).resolves.toBe("timeout")
    jest.useRealTimers()
  })

  it("dashboardLiveFallbackTimeoutMs defaults to 4000", () => {
    delete process.env.FINZA_DASHBOARD_LIVE_FALLBACK_TIMEOUT_MS
    expect(dashboardLiveFallbackTimeoutMs()).toBe(4000)
  })
})
