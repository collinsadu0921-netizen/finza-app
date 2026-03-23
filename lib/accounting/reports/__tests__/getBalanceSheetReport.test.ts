/**
 * getBalanceSheetReport — entity-type equity rendering tests
 *
 * Covers the business_type additions introduced in migration 381:
 *   A. limited_company  → equity section labelled "Equity",
 *                          net income line = "Current Period Net Income"
 *   B. sole_proprietorship → equity section labelled "Owner's Equity",
 *                             net income line = "Net Profit for Period"
 *   C. Net income line is added when non-zero, omitted when zero
 *   D. business_type propagates into the response
 *   E. Caller override takes precedence over DB value
 *   F. Default fallback when DB has no business_type
 *   G. Totals remain correct regardless of entity type
 *   H. Missing businessId returns an error without calling DB
 */

import { getBalanceSheetReport } from "../getBalanceSheetReport"
import type { SupabaseClient } from "@supabase/supabase-js"

// ── Mock resolveAccountingPeriodForReport ─────────────────────────────────

jest.mock("@/lib/accounting/resolveAccountingPeriodForReport", () => ({
  resolveAccountingPeriodForReport: jest.fn().mockResolvedValue({
    period: {
      period_id: "period-001",
      period_start: "2026-01-01",
      period_end:   "2026-12-31",
      resolution_reason: "exact_match",
    },
    error: null,
  }),
}))

// ── Sample RPC row fixtures ────────────────────────────────────────────────

const BALANCE_SHEET_ROWS = [
  // Assets
  { account_id: "a1", account_code: "1010", account_name: "Bank",             account_type: "asset",     balance: 50000 },
  { account_id: "a2", account_code: "1100", account_name: "Accounts Rec.",    account_type: "asset",     balance: 20000 },
  // Liabilities
  { account_id: "l1", account_code: "2000", account_name: "Accounts Pay.",    account_type: "liability", balance: 15000 },
  // Equity
  { account_id: "e1", account_code: "3000", account_name: "Owner's Equity",   account_type: "equity",    balance: 40000 },
  { account_id: "e2", account_code: "3100", account_name: "Retained Earnings",account_type: "equity",    balance: 15000 },
]

const PNL_ROWS = [
  { account_type: "income",  period_total: 30000 },
  { account_type: "expense", period_total: 15000 },
  // net = 15,000
]

const PNL_ROWS_ZERO_PROFIT = [
  { account_type: "income",  period_total: 0 },
  { account_type: "expense", period_total: 0 },
]

// ── Mock Supabase builder ─────────────────────────────────────────────────

function buildMockSupabase(
  businessType: string | undefined = "limited_company",
  bsRows = BALANCE_SHEET_ROWS,
  pnlRows = PNL_ROWS
): SupabaseClient {
  return {
    rpc: jest.fn((name: string) => {
      if (name === "get_balance_sheet_from_trial_balance") {
        return Promise.resolve({ data: bsRows, error: null })
      }
      if (name === "get_profit_and_loss_from_trial_balance") {
        return Promise.resolve({ data: pnlRows, error: null })
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

// ── Tests ─────────────────────────────────────────────────────────────────

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

  it('net income synthetic line is labelled "Current Period Net Income"', async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company"),
      { businessId: "biz-001" }
    )
    const equitySection = data!.sections.find((s) => s.key === "equity")!
    const equityGroup   = equitySection.groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeDefined()
    expect(netIncomeLine!.account_name).toBe("Current Period Net Income")
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

  it('net income synthetic line is labelled "Net Profit for Period"', async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("sole_proprietorship"),
      { businessId: "biz-001" }
    )
    const equitySection = data!.sections.find((s) => s.key === "equity")!
    const equityGroup   = equitySection.groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeDefined()
    expect(netIncomeLine!.account_name).toBe("Net Profit for Period")
  })
})

describe("C. Net income line visibility", () => {
  it("adds net income line when period profit is non-zero", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company", BALANCE_SHEET_ROWS, PNL_ROWS),
      { businessId: "biz-001" }
    )
    const equityGroup = data!.sections
      .find((s) => s.key === "equity")!
      .groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeDefined()
    expect(netIncomeLine!.amount).toBe(15000)   // income 30k - expenses 15k
  })

  it("omits net income line when profit is zero", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company", BALANCE_SHEET_ROWS, PNL_ROWS_ZERO_PROFIT),
      { businessId: "biz-001" }
    )
    const equityGroup = data!.sections
      .find((s) => s.key === "equity")!
      .groups.find((g) => g.key === "equity")!
    const netIncomeLine = equityGroup.lines.find((l) => l.account_id === "__net_income__")
    expect(netIncomeLine).toBeUndefined()
  })
})

describe("D. business_type propagates in response", () => {
  it("response.business_type = 'limited_company' when DB value is limited_company", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company"),
      { businessId: "biz-001" }
    )
    expect(data!.business_type).toBe("limited_company")
  })

  it("response.business_type = 'sole_proprietorship' when DB value is sole_proprietorship", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("sole_proprietorship"),
      { businessId: "biz-001" }
    )
    expect(data!.business_type).toBe("sole_proprietorship")
  })
})

describe("E. Caller override takes precedence over DB value", () => {
  it("uses caller-supplied business_type even when DB says limited_company", async () => {
    // DB says 'limited_company', but caller passes 'sole_proprietorship'
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company"),
      { businessId: "biz-001", business_type: "sole_proprietorship" }
    )
    expect(data!.business_type).toBe("sole_proprietorship")
    const equitySection = data!.sections.find((s) => s.key === "equity")!
    expect(equitySection.label).toBe("Owner's Equity")
  })
})

describe("F. Default fallback when DB has no business_type", () => {
  it("falls back to limited_company when DB returns undefined", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase(undefined),   // DB returns undefined for business_type
      { businessId: "biz-001" }
    )
    expect(data!.business_type).toBe("limited_company")
    const equitySection = data!.sections.find((s) => s.key === "equity")!
    expect(equitySection.label).toBe("Equity")
  })
})

describe("G. Totals remain correct regardless of entity type", () => {
  it("equity subtotal = ledger equity accounts + net income", async () => {
    // Ledger equity: 40,000 + 15,000 = 55,000. Net income: 15,000. Total: 70,000.
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("sole_proprietorship"),
      { businessId: "biz-001" }
    )
    const equitySection = data!.sections.find((s) => s.key === "equity")!
    expect(equitySection.subtotal).toBe(70000)
  })

  it("assets = 70,000 and liabilities = 15,000", async () => {
    const { data } = await getBalanceSheetReport(
      buildMockSupabase("limited_company"),
      { businessId: "biz-001" }
    )
    expect(data!.totals.assets).toBe(70000)          // 50k + 20k
    expect(data!.totals.liabilities).toBe(15000)
  })

  it("totals are the same for both entity types (business_type only affects labels)", async () => {
    const [limited, sole] = await Promise.all([
      getBalanceSheetReport(buildMockSupabase("limited_company"),    { businessId: "biz-001" }),
      getBalanceSheetReport(buildMockSupabase("sole_proprietorship"),{ businessId: "biz-001" }),
    ])
    expect(limited.data!.totals).toEqual(sole.data!.totals)
  })
})

describe("H. Input validation", () => {
  it("returns an error when businessId is empty", async () => {
    const { data, error } = await getBalanceSheetReport(
      buildMockSupabase(),
      { businessId: "" }
    )
    expect(data).toBeNull()
    expect(error).toMatch(/business_id/i)
  })
})
