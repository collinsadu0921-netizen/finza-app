/**
 * resolveDashboardDefaultPeriodStart — prefers latest non-zero P&L summary period.
 */

import { resolveDashboardDefaultPeriodStart } from "../dashboardDefaultPnlPeriod"

function mockSupabase(rows: unknown[] | null, error: { message: string } | null = null) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: rows, error }),
  }
  return {
    from: jest.fn().mockReturnValue(chain),
  } as any
}

describe("resolveDashboardDefaultPeriodStart", () => {
  it("returns latest period with non-zero P&L", async () => {
    const supabase = mockSupabase([
      { period_start: "2026-07-01", revenue: 0, expenses: 0, net_profit: 0 },
      { period_start: "2026-06-01", revenue: 0, expenses: 1130, net_profit: -1130 },
      { period_start: "2026-05-01", revenue: 0, expenses: 1130, net_profit: -1130 },
    ])

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBe(
      "2026-06-01"
    )
  })

  it("returns null when all summaries are zero", async () => {
    const supabase = mockSupabase([
      { period_start: "2026-07-01", revenue: 0, expenses: 0, net_profit: 0 },
    ])

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBeNull()
  })

  it("returns null on read error", async () => {
    const supabase = mockSupabase(null, { message: "db down" })

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBeNull()
  })
})
