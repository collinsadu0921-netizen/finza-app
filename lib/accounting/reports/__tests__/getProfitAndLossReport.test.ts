/**
 * getProfitAndLossReport — ledger movement source (not trial balance closing balances).
 */

import { getProfitAndLossReport, pnlTotalsFromReport } from "../getProfitAndLossReport"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/accounting/resolveAccountingPeriodForReport", () => ({
  resolveAccountingPeriodForReport: jest.fn().mockResolvedValue({
    period: {
      period_id: "period-jan",
      period_start: "2026-01-01",
      period_end: "2026-01-31",
      resolution_reason: "period_start",
    },
    error: null,
  }),
}))

const MOVEMENT_JAN = [
  {
    account_id: "i1",
    account_code: "4000",
    account_name: "Revenue",
    account_type: "income",
    period_total: 10000,
  },
  {
    account_id: "e1",
    account_code: "6000",
    account_name: "Rent",
    account_type: "expense",
    period_total: 3000,
  },
]

const MOVEMENT_Q1 = [
  {
    account_id: "i1",
    account_code: "4000",
    account_name: "Revenue",
    account_type: "income",
    period_total: 25000,
  },
  {
    account_id: "e1",
    account_code: "6000",
    account_name: "Rent",
    account_type: "expense",
    period_total: 9000,
  },
]

function buildMockSupabase(movementRows = MOVEMENT_JAN): SupabaseClient {
  const rpc = jest.fn((name: string, args?: Record<string, unknown>) => {
    if (name === "get_profit_and_loss_movement") {
      return Promise.resolve({ data: movementRows, error: null })
    }
    return Promise.resolve({ data: [], error: null })
  })

  return {
    rpc,
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { default_currency: "GHS" }, error: null }),
        }
      }
      if (table === "accounting_periods") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          lte: jest.fn().mockReturnThis(),
          gte: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { id: "period-q1" }, error: null }),
        }
      }
      return {}
    }),
  } as unknown as SupabaseClient
}

describe("getProfitAndLossReport ledger movement", () => {
  it("single period uses get_profit_and_loss_movement with period bounds", async () => {
    const supabase = buildMockSupabase()
    const { data, error } = await getProfitAndLossReport(supabase, {
      businessId: "biz-001",
      period_start: "2026-01-01",
    })
    expect(error).toBe("")
    expect(data!.telemetry.source).toBe("ledger")
    expect(data!.telemetry.version).toBe(2)
    expect(supabase.rpc).toHaveBeenCalledWith("get_profit_and_loss_movement", {
      p_business_id: "biz-001",
      p_start_date: "2026-01-01",
      p_end_date: "2026-01-31",
    })
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      "get_profit_and_loss_from_trial_balance",
      expect.anything()
    )
    expect(data!.totals.net_profit).toBe(7000)
  })

  it("custom range uses exact start_date and end_date (one RPC, not summed closings)", async () => {
    const supabase = buildMockSupabase(MOVEMENT_Q1)
    const { data, error } = await getProfitAndLossReport(supabase, {
      businessId: "biz-001",
      start_date: "2026-01-01",
      end_date: "2026-03-31",
    })
    expect(error).toBe("")
    expect(data!.period.period_start).toBe("2026-01-01")
    expect(data!.period.period_end).toBe("2026-03-31")
    const movementCalls = (supabase.rpc as jest.Mock).mock.calls.filter(
      (c) => c[0] === "get_profit_and_loss_movement"
    )
    expect(movementCalls).toHaveLength(1)
    expect(movementCalls[0][1]).toEqual({
      p_business_id: "biz-001",
      p_start_date: "2026-01-01",
      p_end_date: "2026-03-31",
    })
    expect(data!.totals.net_profit).toBe(16000)
  })

  it("pnlTotalsFromReport matches income minus expenses", () => {
    const report = {
      period: { period_id: "", period_start: "2026-01-01", period_end: "2026-01-31", resolution_reason: "date_range" },
      currency: { code: "GHS", symbol: "₵", name: "GHS" },
      sections: [
        { key: "income" as const, label: "Income", lines: [], subtotal: 10000 },
        { key: "cogs" as const, label: "COGS", lines: [], subtotal: 2000 },
        { key: "operating_expenses" as const, label: "OpEx", lines: [], subtotal: 1000 },
        { key: "other_income" as const, label: "Other", lines: [], subtotal: 0 },
        { key: "other_expenses" as const, label: "Other exp", lines: [], subtotal: 0 },
        { key: "taxes" as const, label: "Taxes", lines: [], subtotal: 500 },
      ],
      totals: {
        gross_profit: 8000,
        operating_profit: 6500,
        profit_before_tax: 7000,
        net_profit: 6500,
      },
      telemetry: {
        resolved_period_reason: "date_range",
        resolved_period_start: "2026-01-01",
        resolved_period_end: "2026-01-31",
        source: "ledger" as const,
        version: 2,
      },
    }
    const t = pnlTotalsFromReport(report)
    expect(t.revenue).toBe(10000)
    expect(t.expenses).toBe(3500)
    expect(t.netProfit).toBe(6500)
  })
})
