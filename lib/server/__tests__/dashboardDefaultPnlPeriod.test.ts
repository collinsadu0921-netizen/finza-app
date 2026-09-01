/**
 * resolveDashboardDefaultPeriodStart — latest non-future non-zero P&L summary.
 */

import { resolveDashboardDefaultPeriodStart } from "../dashboardDefaultPnlPeriod"
import { getBusinessToday } from "@/lib/accounting/businessDate"

jest.mock("@/lib/accounting/businessDate", () => ({
  getBusinessToday: jest.fn(),
}))

const mockGetBusinessToday = getBusinessToday as jest.MockedFunction<typeof getBusinessToday>

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

const july = {
  period_start: "2026-07-01",
  revenue: 50291.67,
  expenses: 6441,
  net_profit: 43850.67,
}
const august = {
  period_start: "2026-08-01",
  revenue: 50981.67,
  expenses: 6441,
  net_profit: 44540.67,
}
const octoberPayroll = {
  period_start: "2026-10-01",
  revenue: 0,
  expenses: 6441,
  net_profit: -6441,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusinessToday.mockResolvedValue("2026-08-31")
})

describe("resolveDashboardDefaultPeriodStart", () => {
  it("selects the previous month when the current month has no activity", async () => {
    mockGetBusinessToday.mockResolvedValue("2026-08-31")
    const supabase = mockSupabase([
      { period_start: "2026-08-01", revenue: 0, expenses: 0, net_profit: 0 },
      july,
    ])

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBe(
      "2026-07-01"
    )
  })

  it("selects the current month when it has activity", async () => {
    const supabase = mockSupabase([octoberPayroll, august, july])

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBe(
      "2026-08-01"
    )
  })

  it("never defaults to future payroll when the current period has invoices", async () => {
    const supabase = mockSupabase([octoberPayroll, august, july])

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBe(
      "2026-08-01"
    )
    expect(mockGetBusinessToday).toHaveBeenCalledWith(supabase, "biz-a")
  })

  it("skips a future active period and an empty current month for the previous non-future month", async () => {
    const supabase = mockSupabase([
      octoberPayroll,
      { period_start: "2026-08-01", revenue: 0, expenses: 0, net_profit: 0 },
      july,
    ])

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBe(
      "2026-07-01"
    )
  })

  it("follows business today across a timezone month boundary, not the browser clock", async () => {
    mockGetBusinessToday.mockResolvedValue("2026-08-31")
    const supabase = mockSupabase([
      { period_start: "2026-09-01", revenue: 0, expenses: 6441, net_profit: -6441 },
      octoberPayroll,
      august,
      july,
    ])

    await expect(
      resolveDashboardDefaultPeriodStart(supabase, "biz-a", { businessToday: "2026-08-31" })
    ).resolves.toBe("2026-08-01")
  })

  it("returns null when all non-future summaries are zero", async () => {
    const supabase = mockSupabase([
      octoberPayroll,
      { period_start: "2026-08-01", revenue: 0, expenses: 0, net_profit: 0 },
    ])

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBeNull()
  })

  it("returns null on read error", async () => {
    const supabase = mockSupabase(null, { message: "db down" })

    await expect(resolveDashboardDefaultPeriodStart(supabase, "biz-a")).resolves.toBeNull()
  })
})
