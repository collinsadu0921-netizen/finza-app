/**
 * CIT (Corporate Income Tax) API Route Tests
 *
 * Covers:
 * A. CIT amount calculation for all 8 Ghana rate codes
 * B. AMT (Alternative Minimum Tax) logic — applies when 0.5% × gross_revenue > standard CIT
 * C. AMT exemption — presumptive and exempt categories are never subject to AMT
 * D. GET endpoint — validation and list response
 * E. POST create endpoint — validation and provision creation
 * F. POST ?action=post — posts provision to ledger via RPC
 * G. POST ?action=pay — records CIT payment to GRA via RPC
 */

import { GET, POST } from "../route"
import { NextRequest } from "next/server"

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/auditLog", () => ({
  createAuditLog: jest.fn(() => Promise.resolve()),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGetRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/cit")
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url)
}

function makePostRequest(body: object, params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/cit")
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function buildMockSupabase(overrides: Record<string, any> = {}) {
  const defaultInsertChain = {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: {
        id: "prov-001",
        business_id: "biz-001",
        period_label: "Q1 2026",
        provision_type: "quarterly",
        chargeable_income: 100000,
        cit_rate: 0.25,
        cit_amount: 25000,
        status: "draft",
        notes: null,
        created_at: "2026-03-01T00:00:00Z",
      },
      error: null,
    }),
  }

  const defaultSelectChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockResolvedValue({ data: [], error: null }),
  }

  const mock: any = {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: "user-001" } },
        error: null,
      }),
    },
    from: jest.fn((table: string) => {
      if (table === "cit_provisions") {
        return overrides.cit_provisions ?? defaultSelectChain
      }
      if (table === "journal_entry_lines") {
        return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), gte: jest.fn().mockReturnThis(), lte: jest.fn().mockResolvedValue({ data: [], error: null }) }
      }
      return defaultInsertChain
    }),
    rpc: jest.fn().mockResolvedValue({ data: "je-001", error: null }),
    ...overrides,
  }
  return mock
}

// ── A. CIT Calculation Logic ───────────────────────────────────────────────

describe("A. CIT amount calculation", () => {
  // These replicate the inline logic in route.ts POST handler
  function calcCIT(chargeableIncome: number, citRate: number, grossRevenue = 0) {
    const isExemptOrPresumptive = citRate === 0 || citRate === 0.03
    const standardCit = Math.round(Math.max(0, chargeableIncome) * citRate * 100) / 100
    const amtAmount = (!isExemptOrPresumptive && grossRevenue > 0)
      ? Math.round(grossRevenue * 0.005 * 100) / 100
      : 0
    const amtApplies = amtAmount > standardCit
    const citAmount = Math.max(standardCit, amtAmount)
    return { standardCit, amtAmount, amtApplies, citAmount }
  }

  it("standard_25: 25% of chargeable income", () => {
    const { citAmount } = calcCIT(100000, 0.25)
    expect(citAmount).toBe(25000)
  })

  it("hotel_22: 22% of chargeable income", () => {
    const { citAmount } = calcCIT(100000, 0.22)
    expect(citAmount).toBe(22000)
  })

  it("bank_20: 20% of chargeable income", () => {
    const { citAmount } = calcCIT(100000, 0.20)
    expect(citAmount).toBe(20000)
  })

  it("export_8: 8% of chargeable income", () => {
    const { citAmount } = calcCIT(100000, 0.08)
    expect(citAmount).toBe(8000)
  })

  it("agro_1: 1% of chargeable income", () => {
    const { citAmount } = calcCIT(100000, 0.01)
    expect(citAmount).toBe(1000)
  })

  it("mining_35: 35% of chargeable income", () => {
    const { citAmount } = calcCIT(100000, 0.35)
    expect(citAmount).toBe(35000)
  })

  it("presumptive_3: 3% of gross turnover", () => {
    const { citAmount } = calcCIT(100000, 0.03)
    expect(citAmount).toBe(3000)
  })

  it("exempt: 0% → zero CIT", () => {
    const { citAmount } = calcCIT(100000, 0)
    expect(citAmount).toBe(0)
  })

  it("negative chargeable income → zero CIT (no negative tax)", () => {
    const { citAmount } = calcCIT(-50000, 0.25)
    expect(citAmount).toBe(0)
  })

  it("rounds to 2 decimal places", () => {
    // 33333.33 × 0.25 = 8333.3325 → rounds to 8333.33
    const { citAmount } = calcCIT(33333.33, 0.25)
    expect(citAmount).toBe(8333.33)
  })
})

// ── B. AMT Logic ──────────────────────────────────────────────────────────

describe("B. AMT (Alternative Minimum Tax) logic", () => {
  function calcCIT(chargeableIncome: number, citRate: number, grossRevenue = 0) {
    const isExemptOrPresumptive = citRate === 0 || citRate === 0.03
    const standardCit = Math.round(Math.max(0, chargeableIncome) * citRate * 100) / 100
    const amtAmount = (!isExemptOrPresumptive && grossRevenue > 0)
      ? Math.round(grossRevenue * 0.005 * 100) / 100
      : 0
    const amtApplies = amtAmount > standardCit
    const citAmount = Math.max(standardCit, amtAmount)
    return { standardCit, amtAmount, amtApplies, citAmount }
  }

  it("AMT applies when 0.5% × gross_revenue > standard CIT (low-profit case)", () => {
    // Standard: 10,000 × 25% = 2,500; AMT: 1,000,000 × 0.5% = 5,000
    const r = calcCIT(10000, 0.25, 1000000)
    expect(r.standardCit).toBe(2500)
    expect(r.amtAmount).toBe(5000)
    expect(r.amtApplies).toBe(true)
    expect(r.citAmount).toBe(5000)
  })

  it("standard CIT is used when higher than AMT (high-profit case)", () => {
    // Standard: 100,000 × 25% = 25,000; AMT: 100,000 × 0.5% = 500
    const r = calcCIT(100000, 0.25, 100000)
    expect(r.standardCit).toBe(25000)
    expect(r.amtAmount).toBe(500)
    expect(r.amtApplies).toBe(false)
    expect(r.citAmount).toBe(25000)
  })

  it("AMT is zero when no gross_revenue provided", () => {
    const r = calcCIT(10000, 0.25, 0)
    expect(r.amtAmount).toBe(0)
    expect(r.amtApplies).toBe(false)
  })

  it("AMT = standard CIT exactly → amtApplies is false (equal case uses standard)", () => {
    // Standard: 200,000 × 0.5% = 1,000; AMT: 200,000 × 0.5% = 1,000
    const r = calcCIT(200000, 0.005, 200000)
    expect(r.standardCit).toBe(1000)
    expect(r.amtAmount).toBe(1000)
    expect(r.amtApplies).toBe(false)   // not strictly greater
    expect(r.citAmount).toBe(1000)
  })
})

// ── C. AMT Exemption ──────────────────────────────────────────────────────

describe("C. AMT exemption for presumptive and exempt categories", () => {
  function calcCIT(chargeableIncome: number, citRate: number, grossRevenue = 0) {
    const isExemptOrPresumptive = citRate === 0 || citRate === 0.03
    const standardCit = Math.round(Math.max(0, chargeableIncome) * citRate * 100) / 100
    const amtAmount = (!isExemptOrPresumptive && grossRevenue > 0)
      ? Math.round(grossRevenue * 0.005 * 100) / 100
      : 0
    const amtApplies = amtAmount > standardCit
    const citAmount = Math.max(standardCit, amtAmount)
    return { standardCit, amtAmount, amtApplies, citAmount }
  }

  it("presumptive_3: AMT never applies even with large gross_revenue", () => {
    // Rate=0.03 → isExemptOrPresumptive=true → amtAmount=0
    const r = calcCIT(10000, 0.03, 10000000)
    expect(r.amtAmount).toBe(0)
    expect(r.amtApplies).toBe(false)
    expect(r.citAmount).toBe(300)  // 10,000 × 3%
  })

  it("exempt: AMT never applies", () => {
    // Rate=0 → isExemptOrPresumptive=true → amtAmount=0
    const r = calcCIT(10000, 0, 10000000)
    expect(r.amtAmount).toBe(0)
    expect(r.amtApplies).toBe(false)
    expect(r.citAmount).toBe(0)
  })
})

// ── D. GET /api/cit ───────────────────────────────────────────────────────

describe("D. GET /api/cit", () => {
  it("returns 400 when business_id is missing", async () => {
    const req = makeGetRequest({})
    const res = await GET(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/business_id required/)
  })

  it("returns provisions list for a valid business_id", async () => {
    const mockSupabase = buildMockSupabase({
      cit_provisions: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({
          data: [
            { id: "p1", period_label: "Q1 2026", cit_amount: 25000, status: "draft" },
          ],
          error: null,
        }),
      },
    })
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makeGetRequest({ business_id: "biz-001" })
    const res = await GET(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.provisions).toHaveLength(1)
    expect(json.provisions[0].period_label).toBe("Q1 2026")
  })

  it("returns empty array when no provisions exist", async () => {
    const mockSupabase = buildMockSupabase({
      cit_provisions: {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockResolvedValue({ data: [], error: null }),
      },
    })
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makeGetRequest({ business_id: "biz-001" })
    const res = await GET(req)
    const json = await res.json()
    expect(json.provisions).toEqual([])
  })
})

// ── E. POST /api/cit (create provision) ──────────────────────────────────

describe("E. POST /api/cit — create provision", () => {
  beforeEach(() => {
    const mockSupabase = buildMockSupabase()
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)
  })

  it("returns 400 when business_id is missing", async () => {
    const req = makePostRequest({ period_label: "Q1 2026", chargeable_income: 100000 })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 when period_label is missing", async () => {
    const req = makePostRequest({ business_id: "biz-001", chargeable_income: 100000 })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 when chargeable_income is missing", async () => {
    const req = makePostRequest({ business_id: "biz-001", period_label: "Q1 2026" })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("creates a draft provision with correct CIT amount", async () => {
    const createdProvision = {
      id: "prov-001",
      business_id: "biz-001",
      period_label: "Q1 2026",
      provision_type: "quarterly",
      chargeable_income: 100000,
      cit_rate: 0.25,
      cit_amount: 25000,
      status: "draft",
      notes: null,
    }
    const mockSupabase = buildMockSupabase({
      cit_provisions: {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: createdProvision, error: null }),
      },
    })
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest({
      business_id: "biz-001",
      period_label: "Q1 2026",
      chargeable_income: 100000,
      cit_rate: 0.25,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.provision.cit_amount).toBe(25000)
    expect(json.provision.status).toBe("draft")
  })

  it("inserts AMT note into provision notes when AMT overrides standard CIT", async () => {
    let capturedInsertData: any = null
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: jest.fn((table: string) => {
        if (table === "cit_provisions") {
          return {
            insert: jest.fn((data: any) => {
              capturedInsertData = data
              return {
                select: jest.fn().mockReturnThis(),
                single: jest.fn().mockResolvedValue({
                  data: { ...data, id: "prov-002" },
                  error: null,
                }),
              }
            }),
          }
        }
        return {}
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    // Low-profit: standard CIT = 2,500, AMT = 5,000 → AMT applies
    const req = makePostRequest({
      business_id: "biz-001",
      period_label: "Q1 2026",
      chargeable_income: 10000,
      cit_rate: 0.25,
      gross_revenue: 1000000,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(capturedInsertData.cit_amount).toBe(5000)
    expect(capturedInsertData.notes).toContain("AMT applied")
    expect(capturedInsertData.notes).toContain("5000.00")
  })

  it("does not add AMT note when standard CIT is higher", async () => {
    let capturedInsertData: any = null
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: jest.fn((table: string) => {
        if (table === "cit_provisions") {
          return {
            insert: jest.fn((data: any) => {
              capturedInsertData = data
              return {
                select: jest.fn().mockReturnThis(),
                single: jest.fn().mockResolvedValue({
                  data: { ...data, id: "prov-003" },
                  error: null,
                }),
              }
            }),
          }
        }
        return {}
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
    }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    // High-profit: standard CIT = 25,000, AMT = 500 → standard applies
    const req = makePostRequest({
      business_id: "biz-001",
      period_label: "Q1 2026",
      chargeable_income: 100000,
      cit_rate: 0.25,
      gross_revenue: 100000,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(capturedInsertData.cit_amount).toBe(25000)
    expect(capturedInsertData.notes).toBeNull()
  })

  it("calls post_cit_provision_to_ledger RPC when auto_post=true and citAmount > 0", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: "je-auto", error: null })
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: "prov-auto", cit_amount: 25000, status: "draft" },
          error: null,
        }),
      })),
      rpc: mockRpc,
    }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest({
      business_id: "biz-001",
      period_label: "Q1 2026",
      chargeable_income: 100000,
      cit_rate: 0.25,
      auto_post: true,
    })
    await POST(req)
    expect(mockRpc).toHaveBeenCalledWith(
      "post_cit_provision_to_ledger",
      { p_provision_id: "prov-auto" }
    )
  })

  it("does NOT call post RPC when auto_post=true but citAmount is 0 (exempt)", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: null, error: null })
    const mockSupabase = {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      from: jest.fn(() => ({
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: "prov-exempt", cit_amount: 0, status: "draft" },
          error: null,
        }),
      })),
      rpc: mockRpc,
    }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest({
      business_id: "biz-001",
      period_label: "Q1 2026",
      chargeable_income: 100000,
      cit_rate: 0,
      auto_post: true,
    })
    await POST(req)
    // post_cit_provision_to_ledger should NOT be called (only audit log RPC might run)
    const postToLedgerCalls = mockRpc.mock.calls.filter(
      (c: any[]) => c[0] === "post_cit_provision_to_ledger"
    )
    expect(postToLedgerCalls).toHaveLength(0)
  })
})

// ── F. POST /api/cit?action=post ──────────────────────────────────────────

describe("F. POST /api/cit?action=post — post to ledger", () => {
  it("returns 400 when provision_id is missing", async () => {
    const mockSupabase = buildMockSupabase()
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest({}, { action: "post" })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/provision_id required/)
  })

  it("calls post_cit_provision_to_ledger RPC with provision_id", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: "je-001", error: null })
    const mockSupabase = { ...buildMockSupabase(), rpc: mockRpc }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest({ provision_id: "prov-001" }, { action: "post" })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith(
      "post_cit_provision_to_ledger",
      { p_provision_id: "prov-001" }
    )
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.journal_entry_id).toBe("je-001")
  })

  it("returns 500 when RPC returns an error", async () => {
    const mockRpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "CIT provision is already posted" },
    })
    const mockSupabase = { ...buildMockSupabase(), rpc: mockRpc }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest({ provision_id: "prov-already-posted" }, { action: "post" })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/already posted/)
  })
})

// ── G. POST /api/cit?action=pay ───────────────────────────────────────────

describe("G. POST /api/cit?action=pay — record payment", () => {
  it("returns 400 when provision_id is missing", async () => {
    const mockSupabase = buildMockSupabase()
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest({}, { action: "pay" })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/provision_id required/)
  })

  it("calls post_cit_payment_to_ledger RPC with correct parameters", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: "je-pay-001", error: null })
    const mockSupabase = { ...buildMockSupabase(), rpc: mockRpc }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest(
      {
        business_id: "biz-001",
        provision_id: "prov-001",
        payment_account_code: "1010",
        payment_date: "2026-03-31",
        payment_ref: "GRA-2026-Q1-001",
      },
      { action: "pay" }
    )
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockRpc).toHaveBeenCalledWith("post_cit_payment_to_ledger", {
      p_provision_id:         "prov-001",
      p_payment_account_code: "1010",
      p_payment_date:         "2026-03-31",
      p_payment_ref:          "GRA-2026-Q1-001",
    })
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.journal_entry_id).toBe("je-pay-001")
  })

  it("defaults payment_account_code to '1010' when not provided", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: "je-pay-002", error: null })
    const mockSupabase = { ...buildMockSupabase(), rpc: mockRpc }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest(
      {
        business_id: "biz-001",
        provision_id: "prov-001",
        payment_date: "2026-03-31",
      },
      { action: "pay" }
    )
    await POST(req)
    const rpcCall = mockRpc.mock.calls.find((c: any[]) => c[0] === "post_cit_payment_to_ledger")
    expect(rpcCall).toBeDefined()
    expect(rpcCall![1].p_payment_account_code).toBe("1010")
  })

  it("uses today's date when payment_date not provided", async () => {
    const mockRpc = jest.fn().mockResolvedValue({ data: "je-pay-003", error: null })
    const mockSupabase = { ...buildMockSupabase(), rpc: mockRpc }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const today = new Date().toISOString().split("T")[0]
    const req = makePostRequest(
      { business_id: "biz-001", provision_id: "prov-001" },
      { action: "pay" }
    )
    await POST(req)
    const rpcCall = mockRpc.mock.calls.find((c: any[]) => c[0] === "post_cit_payment_to_ledger")
    expect(rpcCall![1].p_payment_date).toBe(today)
  })

  it("returns 500 when payment RPC returns an error", async () => {
    const mockRpc = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "CIT provision must be in posted status" },
    })
    const mockSupabase = { ...buildMockSupabase(), rpc: mockRpc }
    mockCreateSupabase.mockResolvedValue(mockSupabase as any)

    const req = makePostRequest(
      { business_id: "biz-001", provision_id: "prov-draft" },
      { action: "pay" }
    )
    const res = await POST(req)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toMatch(/posted status/)
  })
})
