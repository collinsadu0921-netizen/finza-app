import {
  buildQuarterlyChartPoints,
  calendarQuarterBounds,
  quarterMonthRangeLabel,
  quarterOfPeriodStart,
  resolveSelectedQuarterKey,
} from "@/lib/dashboard/trendsQuarterUtils"

describe("trendsQuarterUtils", () => {
  it("returns calendar quarter bounds", () => {
    expect(calendarQuarterBounds(2026, 1)).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
    })
    expect(calendarQuarterBounds(2026, 3)).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    })
    expect(calendarQuarterBounds(2026, 4)).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    })
  })

  it("derives quarter from period start", () => {
    expect(quarterOfPeriodStart("2026-07-01")).toEqual({ year: 2026, quarter: 3 })
    expect(quarterOfPeriodStart("2026-04-01")).toEqual({ year: 2026, quarter: 2 })
  })

  it("formats quarter month range label", () => {
    expect(quarterMonthRangeLabel(2026, 3)).toBe("Jul–Sep 2026")
  })

  it("aggregates months into quarters without inventing months", () => {
    const points = buildQuarterlyChartPoints(
      [
        {
          period_start: "2026-07-01",
          period_end: "2026-07-31",
          revenue: 100,
          expenses: 40,
          netProfit: 60,
        },
        {
          period_start: "2026-06-01",
          period_end: "2026-06-30",
          revenue: 200,
          expenses: 80,
          netProfit: 120,
        },
        {
          period_start: "2026-05-01",
          period_end: "2026-05-31",
          revenue: 50,
          expenses: 20,
          netProfit: 30,
        },
      ],
      "2026-07-15"
    )

    expect(points).toHaveLength(2)
    expect(points[0]).toMatchObject({
      key: "2026-Q2",
      revenue: 250,
      calendarStart: "2026-04-01",
      calendarEnd: "2026-06-30",
      isQuarterToDate: false,
    })
    expect(points[1]).toMatchObject({
      key: "2026-Q3",
      revenue: 100,
      calendarStart: "2026-07-01",
      calendarEnd: "2026-09-30",
      dataThroughEnd: "2026-07-31",
      isQuarterToDate: true,
    })
  })

  it("resolveSelectedQuarterKey falls back to latest quarter", () => {
    const points = buildQuarterlyChartPoints(
      [
        {
          period_start: "2026-06-01",
          period_end: "2026-06-30",
          revenue: 1,
          expenses: 0,
          netProfit: 1,
        },
        {
          period_start: "2026-07-01",
          period_end: "2026-07-31",
          revenue: 2,
          expenses: 0,
          netProfit: 2,
        },
      ],
      "2026-07-15"
    )
    expect(resolveSelectedQuarterKey(points, null)).toBe("2026-Q3")
    expect(resolveSelectedQuarterKey(points, "2026-Q2")).toBe("2026-Q2")
    expect(resolveSelectedQuarterKey(points, "2020-Q1")).toBe("2026-Q3")
  })
})
