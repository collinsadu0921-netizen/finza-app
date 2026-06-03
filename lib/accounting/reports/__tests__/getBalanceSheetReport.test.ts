/**
 * getBalanceSheetReport — entity-type equity rendering tests (cumulative ledger source)
 */

import { getBalanceSheetReport } from "../getBalanceSheetReport"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/accounting/resolveAccountingPeriodForReport", () => ({
  resolveAccountingPeriodForReport: jest.fn().mockResolvedValue({
    period: {
      period_id: "period-001",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      resolution_reason: "exact_match",
    },
    error: null,
  }),
}))

jest.mock("@/lib/accounting/businessDate", () => ({
  getBusinessToday: jest.fn().mockResolvedValue("2026-06-02"),
}))

const BALANCE_SHEET_ROWS = [
  { account_id: "a1", account_code: "1010", account_name: "Bank", account_type: "asset", balance: 50000 },
  { account_id: "a2", account_code: "1100", account_name: "Accounts Rec.", account_type: "asset", balance: 20000 },
  { account_id: "l1", account_code: "2000", account_name: "Accounts Pay.", account_type: "liability", balance: 15000 },
  { account_id: "e1", account_code: "3000", account_name: "Owner's Equity", account_type: "equity", balance: 40000 },
  { account_id: "e2", account_code: "3100", account_name: "Retained Earnings", account_type: "equity", balance: 15000 },
]

function buildMockSupabase(
  businessType: string | undefined = "limited_company",
  bsRows = BALANCE_SHEET_ROWS,
  cumulativeNetIncome = 15000
): SupabaseClient {
  return {
    rpc: jest.fn((name: string) => {
      if (name === "get_balance_sheet_as_of") {
        return Promise.resolve({ data: bsRows, error: null })
      }
      if (name === "get_cumulative_net_income_as_of") {
        return Promise.resolve({ data: cumulativeNetIncome, error: null })
      }
      return Promise.resolve({ data: [], error: null })
    }),
    from: jest.fn((table: string) => {
      if (table === "businesses") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { default_currency: "GHS", business_type: businessType },
            error: null,
          }),
        }
      }
      return {}
    }),
  } as unknown as SupabaseClient
}

describe("A. limited_company equity section", () => {
  it('equity section key is "equity" and label is "Equity"', async () => {
    const { data, error } = await getBalanceSheetReport(
      buildMockSupabase("limited_company"),
      { businessId: "biz-001" }
    )
    expect(error).toBe("")
    const equitySection = data!.sections.find((s) => s.key === "equity")!
    expect(equitySection.label).toBe("Equity")
  })

  it('net income synthetic line is labelled "Net Income (cumulative)"', async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company"),
      { businessId: "biz-001" }
    )
    const equityGroup = data!.sections
      .find((s) => s.key === "equity")!
      .groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeDefined()
    expect(netIncomeLine!.account_name).toBe("Net Income (cumulative)")
  })
})

describe("B. sole_proprietorship equity section", () => {
  it('equity section label is "Owner\'s Equity"', async () => {
    const { data, error } = await getBalanceSheetReport(
      buildMockSupabase("sole_proprietorship"),
      { businessId: "biz-001" }
    )
    expect(error).toBe("")
    const equitySection = data!.sections.find((s) => s.key === "equity")!
    expect(equitySection.label).toBe("Owner's Equity")
  })

  it('net income synthetic line is labelled "Net Profit (cumulative)"', async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("sole_proprietorship"),
      { businessId: "biz-001" }
    )
    const equityGroup = data!.sections
      .find((s) => s.key === "equity")!
      .groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeDefined()
    expect(netIncomeLine!.account_name).toBe("Net Profit (cumulative)")
  })
})

describe("C. Net income line visibility", () => {
  it("adds net income line when cumulative profit is non-zero", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company", BALANCE_SHEET_ROWS, 15000),
      { businessId: "biz-001" }
    )
    const equityGroup = data!.sections
      .find((s) => s.key === "equity")!
      .groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeDefined()
    expect(netIncomeLine!.amount).toBe(15000)
  })

  it("omits net income line when cumulative profit is zero", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company", BALANCE_SHEET_ROWS, 0),
      { businessId: "biz-001" }
    )
    const equityGroup = data!.sections
      .find((s) => s.key === "equity")!
      .groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeUndefined()
  })
})

describe("D–H", () => {
  it("propagates business_type and totals", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company"),
      { businessId: "biz-001" }
    )
    expect(data!.business_type).toBe("limited_company")
    expect(data!.totals.assets).toBe(70000)
    expect(data!.totals.liabilities).toBe(15000)
    expect(data!.telemetry.source).toBe("ledger")
    expect(data!.as_of_date).toBe("2026-06-02")
  })

  it("uses explicit as_of_date when provided", async () => {
    const { data } = await getBalanceSheetReport(buildMockSupabase(), {
      businessId: "biz-001",
      as_of_date: "2026-03-15",
    })
    expect(data!.as_of_date).toBe("2026-03-15")
  })

  it("uses end_date from custom start/end range as as_of_date", async () => {
    const { data } = await getBalanceSheetReport(buildMockSupabase(), {
      businessId: "biz-001",
      start_date: "2026-01-01",
      end_date: "2026-05-31",
    })
    expect(data!.as_of_date).toBe("2026-05-31")
  })

  it("returns an error when businessId is empty", async () => {
    const { data, error } = await getBalanceSheetReport(buildMockSupabase(), { businessId: "" })
    expect(data).toBeNull()
    expect(error).toMatch(/business_id/i)
  })
})

describe("I. Net loss", () => {
  it("adds negative cumulative net income line", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company", BALANCE_SHEET_ROWS, -15000),
      { businessId: "biz-001" }
    )
    const netIncomeLine = data!.sections
      .find((s) => s.key === "equity")!
      .groups.find((g) => g.key === "equity")!
      .lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine!.amount).toBe(-15000)
  })
})

describe("J. RPC error propagation", () => {
  it("returns an error when get_balance_sheet_as_of fails", async () => {
    const brokenSupabase = {
      rpc: jest.fn((name: string) => {
        if (name === "get_balance_sheet_as_of") {
          return Promise.resolve({ data: null, error: { message: "rpc not found" } })
        }
        if (name === "get_cumulative_net_income_as_of") {
          return Promise.resolve({ data: 0, error: null })
        }
        return Promise.resolve({ data: [], error: null })
      }),
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { default_currency: "GHS", business_type: "limited_company" },
          error: null,
        }),
      })),
    } as unknown as SupabaseClient

    const { data, error } = await getBalanceSheetReport(brokenSupabase, { businessId: "biz-001" })
    expect(data).toBeNull()
    expect(error).toMatch(/rpc not found/i)
  })
})
