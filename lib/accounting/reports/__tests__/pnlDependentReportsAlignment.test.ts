/**
 * fetchCanonicalPnLNetProfit delegates to getProfitAndLossReport totals.
 */

import { fetchCanonicalPnLNetProfit } from "../getProfitAndLossReport"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/accounting/resolveAccountingPeriodForReport", () => ({
  resolveAccountingPeriodForReport: jest.fn().mockResolvedValue({
    period: {
      period_id: "period-001",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      resolution_reason: "period_start",
    },
    error: null,
  }),
}))

const MOVEMENT_ROWS = [
  {
    account_id: "i1",
    account_code: "4000",
    account_name: "Revenue",
    account_type: "income",
    period_total: 50000,
  },
  {
    account_id: "e1",
    account_code: "6000",
    account_name: "Rent",
    account_type: "expense",
    period_total: 12000,
  },
]

function buildMockSupabase(): SupabaseClient {
  return {
    rpc: jest.fn((name: string) => {
      if (name === "get_profit_and_loss_movement") {
        return Promise.resolve({ data: MOVEMENT_ROWS, error: null })
      }
      if (name === "get_account_movements") {
        return Promise.resolve({ data: [], error: null })
      }
      return Promise.resolve({ data: [], error: null })
    }),
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { default_currency: "GHS" }, error: null }),
    })),
  } as unknown as SupabaseClient
}

describe("fetchCanonicalPnLNetProfit", () => {
  it("returns totals.net_profit from canonical report", async () => {
    const supabase = buildMockSupabase()
    const { netProfit, error } = await fetchCanonicalPnLNetProfit(supabase, {
      businessId: "biz-001",
      period_start: "2026-01-01",
    })
    expect(error).toBe("")
    expect(netProfit).toBe(38000)
  })
})

describe("Cash Flow net profit alignment", () => {
  it("operating section net profit matches fetchCanonicalPnLNetProfit", async () => {
    const { getCashFlowReport } = await import("../getCashFlowReport")
    const supabase = buildMockSupabase()
    const input = { businessId: "biz-001", period_start: "2026-01-01" }
    const [{ netProfit }, cfOut] = await Promise.all([
      fetchCanonicalPnLNetProfit(supabase, input),
      getCashFlowReport(supabase, input),
    ])
    const operatingLine = cfOut.data!.sections
      .find((s) => s.key === "operating")!
      .lines.find((l) => l.account_name === "Net profit for the period")
    expect(operatingLine!.amount).toBe(netProfit)
  })
})

describe("Equity Changes net profit alignment", () => {
  it("totals.net_profit matches fetchCanonicalPnLNetProfit", async () => {
    const { getEquityChangesReport } = await import("../getEquityChangesReport")
    const supabase = buildMockSupabase()
    const input = { businessId: "biz-001", period_start: "2026-01-01" }
    const [{ netProfit }, eqOut] = await Promise.all([
      fetchCanonicalPnLNetProfit(supabase, input),
      getEquityChangesReport(supabase, input),
    ])
    expect(eqOut.data!.totals.net_profit).toBe(netProfit)
  })
})
