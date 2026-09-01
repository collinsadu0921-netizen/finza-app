import {
  filterNonFutureTimelinePoints,
  resolveMonthlyTrendsSelection,
} from "@/lib/dashboard/trendsPeriodSelection"

const july = {
  period_start: "2026-07-01",
  period_end: "2026-07-31",
  revenue: 50291.67,
  expenses: 6441,
  netProfit: 43850.67,
}
const august = {
  period_start: "2026-08-01",
  period_end: "2026-08-31",
  revenue: 50981.67,
  expenses: 6441,
  netProfit: 44540.67,
}
const october = {
  period_start: "2026-10-01",
  period_end: "2026-10-31",
  revenue: 0,
  expenses: 6441,
  netProfit: -6441,
}

describe("filterNonFutureTimelinePoints", () => {
  it("keeps July and August when October is also present", () => {
    const visible = filterNonFutureTimelinePoints([july, august, october], "2026-08-31")
    expect(visible.map((p) => p.period_start)).toEqual(["2026-07-01", "2026-08-01"])
  })

  it("returns no bars when only a future month has activity", () => {
    const visible = filterNonFutureTimelinePoints([october], "2026-08-31")
    expect(visible).toEqual([])
  })

  it("returns an empty list for an empty timeline", () => {
    expect(filterNonFutureTimelinePoints([], "2026-08-31")).toEqual([])
  })

  it("uses business today, not an implicit local September rollover", () => {
    const visible = filterNonFutureTimelinePoints([july, august, october], "2026-08-31")
    expect(visible.some((p) => p.period_start.startsWith("2026-10"))).toBe(false)
    expect(visible.some((p) => p.period_start.startsWith("2026-08"))).toBe(true)
  })
})

describe("resolveMonthlyTrendsSelection", () => {
  it("does not silently select July when the dashboard period is filtered off the chart", () => {
    const selection = resolveMonthlyTrendsSelection({
      visibleMonths: [july, august],
      dashboardPeriodStart: "2026-10-01",
      dashboardPeriodEnd: "2026-10-31",
      currentRevenue: 0,
      currentExpenses: 6441,
      currentNetProfit: -6441,
    })

    expect(selection.selectedPeriodStart).toBe("2026-10-01")
    expect(selection.barVisible).toBe(false)
    expect(selection.highlightPeriodStart).toBeNull()
    expect(selection.usedMetricsFallback).toBe(true)
    expect(selection.selectedRevenue).toBe(0)
    expect(selection.selectedNetProfit).toBe(-6441)
  })

  it("keeps a selected future period and its metrics when no bar is visible", () => {
    const visible = filterNonFutureTimelinePoints([october], "2026-08-31")
    const selection = resolveMonthlyTrendsSelection({
      visibleMonths: visible,
      dashboardPeriodStart: "2026-10-01",
      dashboardPeriodEnd: "2026-10-31",
      currentRevenue: 0,
      currentExpenses: 6441,
      currentNetProfit: -6441,
    })

    expect(visible).toEqual([])
    expect(selection.selectedPeriodStart).toBe("2026-10-01")
    expect(selection.selectedPeriodEnd).toBe("2026-10-31")
    expect(selection.barVisible).toBe(false)
    expect(selection.highlightPeriodStart).toBeNull()
    expect(selection.usedMetricsFallback).toBe(true)
    expect(selection.selectedRevenue).toBe(0)
    expect(selection.selectedExpenses).toBe(6441)
    expect(selection.selectedNetProfit).toBe(-6441)
  })

  it("highlights August when that period is selected and visible", () => {
    const selection = resolveMonthlyTrendsSelection({
      visibleMonths: [july, august],
      dashboardPeriodStart: "2026-08-01",
      dashboardPeriodEnd: "2026-08-31",
      currentRevenue: 50981.67,
      currentExpenses: 6441,
      currentNetProfit: 44540.67,
    })

    expect(selection.selectedPeriodStart).toBe("2026-08-01")
    expect(selection.barVisible).toBe(true)
    expect(selection.highlightPeriodStart).toBe("2026-08-01")
    expect(selection.selectedRevenue).toBe(50981.67)
  })
})
