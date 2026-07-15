import {
  buildQuarterlyChartPoints,
  calendarQuarterBounds,
  quarterAccessibleLabel,
  quarterKeyFromPeriodStart,
  quarterMonthRangeLabel,
  quarterOfPeriodStart,
  resolveSelectedQuarterKey,
} from "@/lib/dashboard/trendsQuarterUtils"

const sampleMonths = [
  {
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    revenue: 108010,
    expenses: 10477.02,
    netProfit: 97532.98,
  },
  {
    period_start: "2026-02-01",
    period_end: "2026-02-28",
    revenue: 105644,
    expenses: 12846.66,
    netProfit: 92797.34,
  },
  {
    period_start: "2026-03-01",
    period_end: "2026-03-31",
    revenue: 103278,
    expenses: 14026.35,
    netProfit: 89251.65,
  },
  {
    period_start: "2026-04-01",
    period_end: "2026-04-30",
    revenue: 100672.34,
    expenses: 22690.68,
    netProfit: 77981.66,
  },
  {
    period_start: "2026-05-01",
    period_end: "2026-05-31",
    revenue: 83750,
    expenses: 13577,
    netProfit: 70173,
  },
  {
    period_start: "2026-06-01",
    period_end: "2026-06-30",
    revenue: 87395,
    expenses: 21732,
    netProfit: 65663,
  },
  {
    period_start: "2026-07-01",
    period_end: "2026-07-31",
    revenue: 9250,
    expenses: 11568.99,
    netProfit: -2318.99,
  },
]

describe("trendsQuarterUtils", () => {
  it("returns calendar quarter bounds", () => {
    expect(calendarQuarterBounds(2026, 1)).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
    })
    expect(calendarQuarterBounds(2026, 2)).toEqual({
      start: "2026-04-01",
      end: "2026-06-30",
    })
    expect(calendarQuarterBounds(2026, 3)).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    })
  })

  it("derives quarter from period start", () => {
    expect(quarterOfPeriodStart("2026-07-01")).toEqual({ year: 2026, quarter: 3 })
    expect(quarterOfPeriodStart("2026-04-01")).toEqual({ year: 2026, quarter: 2 })
    expect(quarterKeyFromPeriodStart("2026-06-01")).toBe("2026-Q2")
    expect(quarterKeyFromPeriodStart("2026-07-01")).toBe("2026-Q3")
  })

  it("formats quarter month range and accessible labels", () => {
    expect(quarterMonthRangeLabel(2026, 3)).toBe("Jul–Sep 2026")
    expect(quarterAccessibleLabel(2026, 2)).toBe("View Q2 2026 breakdown")
  })

  it("incomplete Q3 uses latest available timeline end, not Sep 30", () => {
    const points = buildQuarterlyChartPoints(sampleMonths, "2026-07-15")
    const q3 = points.find((p) => p.key === "2026-Q3")
    expect(q3).toMatchObject({
      isQuarterToDate: true,
      calendarStart: "2026-07-01",
      calendarEnd: "2026-09-30",
      dataThroughEnd: "2026-07-31",
      effectiveStart: "2026-07-01",
      effectiveEnd: "2026-07-31",
      expenses: 11568.99,
      revenue: 9250,
      netProfit: -2318.99,
    })
  })

  it("completed Q1 uses Mar 31 and completed Q2 uses Jun 30", () => {
    const points = buildQuarterlyChartPoints(sampleMonths, "2026-07-15")
    const q1 = points.find((p) => p.key === "2026-Q1")
    const q2 = points.find((p) => p.key === "2026-Q2")
    expect(q1).toMatchObject({
      isQuarterToDate: false,
      effectiveStart: "2026-01-01",
      effectiveEnd: "2026-03-31",
      expenses: 37350.03,
    })
    expect(q2).toMatchObject({
      isQuarterToDate: false,
      effectiveStart: "2026-04-01",
      effectiveEnd: "2026-06-30",
      revenue: 271817.34,
      expenses: 57999.68,
      netProfit: 213817.66,
    })
  })

  it("Q3 chart expenses equal the QTD effective range (popover reconcile boundary)", () => {
    const points = buildQuarterlyChartPoints(sampleMonths, "2026-07-15")
    const q3 = points.find((p) => p.key === "2026-Q3")!
    // Popover must query effectiveStart→effectiveEnd, matching chart QTD expenses.
    expect(q3.effectiveEnd).toBe("2026-07-31")
    expect(q3.effectiveEnd).not.toBe("2026-09-30")
    expect(q3.expenses).toBe(11568.99)
  })

  it("June dashboard period seeds Q2 and July seeds Q3", () => {
    const points = buildQuarterlyChartPoints(sampleMonths, "2026-07-15")
    expect(resolveSelectedQuarterKey(points, null, "2026-06-01")).toBe("2026-Q2")
    expect(resolveSelectedQuarterKey(points, null, "2026-07-01")).toBe("2026-Q3")
  })

  it("explicit user quarter selection persists over dashboard period", () => {
    const points = buildQuarterlyChartPoints(sampleMonths, "2026-07-15")
    expect(resolveSelectedQuarterKey(points, "2026-Q1", "2026-06-01")).toBe("2026-Q1")
    expect(resolveSelectedQuarterKey(points, "2026-Q3", "2026-06-01")).toBe("2026-Q3")
  })

  it("falls back to latest when dashboard period is absent or outside data", () => {
    const points = buildQuarterlyChartPoints(sampleMonths, "2026-07-15")
    expect(resolveSelectedQuarterKey(points, null, null)).toBe("2026-Q3")
    expect(resolveSelectedQuarterKey(points, null, "2020-01-01")).toBe("2026-Q3")
    expect(resolveSelectedQuarterKey(points, "2020-Q1", "2026-06-01")).toBe("2026-Q2")
  })
})
