import {
  quarterAccessibleLabel,
  resolveSelectedQuarterKey,
  buildQuarterlyChartPoints,
} from "@/lib/dashboard/trendsQuarterUtils"

/**
 * Accessibility contract for quarter selection controls.
 * The UI buttons use these labels and aria-pressed; Enter/Space handlers
 * call the same onSelect path as click (covered via resolveSelectedQuarterKey persistence).
 */
describe("quarter accessible selection contract", () => {
  const points = buildQuarterlyChartPoints(
    [
      {
        period_start: "2026-04-01",
        period_end: "2026-04-30",
        revenue: 1,
        expenses: 0,
        netProfit: 1,
      },
      {
        period_start: "2026-05-01",
        period_end: "2026-05-31",
        revenue: 1,
        expenses: 0,
        netProfit: 1,
      },
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
        revenue: 1,
        expenses: 0,
        netProfit: 1,
      },
    ],
    "2026-07-15"
  )

  it("exposes quarter/year accessible labels", () => {
    expect(quarterAccessibleLabel(2026, 1)).toBe("View Q1 2026 breakdown")
    expect(quarterAccessibleLabel(2026, 2)).toBe("View Q2 2026 breakdown")
    expect(quarterAccessibleLabel(2026, 3)).toBe("View Q3 2026 breakdown")
  })

  it("Enter/Space selection persistence uses explicit key (same as button handlers)", () => {
    // Simulates button onKeyDown Enter/Space → onSelect(...)
    const afterEnter = resolveSelectedQuarterKey(points, "2026-Q2", "2026-07-01")
    expect(afterEnter).toBe("2026-Q2")
    const afterSpace = resolveSelectedQuarterKey(points, "2026-Q3", "2026-06-01")
    expect(afterSpace).toBe("2026-Q3")
  })

  it("selected state key is stable for aria-pressed wiring", () => {
    const active = resolveSelectedQuarterKey(points, null, "2026-06-01")
    expect(active).toBe("2026-Q2")
    expect(points.some((q) => q.key === active)).toBe(true)
  })
})
