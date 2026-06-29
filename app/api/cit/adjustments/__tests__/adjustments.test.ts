import { NextRequest } from "next/server"
import { GET, POST } from "../route"
import { PATCH, DELETE } from "../[id]/route"
import { createSupabaseServerClient } from "@/lib/supabaseServer"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/serviceWorkspace/enforceServiceWorkspaceAccess", () => ({
  enforceServiceWorkspaceAccess: jest.fn().mockResolvedValue(null),
  enforceServiceWorkspaceWriteAccess: jest.fn().mockResolvedValue(null),
}))

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<typeof createSupabaseServerClient>

function makeRequest(path: string, body?: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function buildChain(methods: Record<string, any>) {
  const chain: any = {}
  for (const name of ["select", "eq", "is", "order", "insert", "update", "delete"]) {
    chain[name] = methods[name] ?? jest.fn().mockReturnValue(chain)
  }
  chain.maybeSingle = methods.maybeSingle ?? jest.fn().mockResolvedValue({ data: null, error: null })
  chain.single = methods.single ?? jest.fn().mockResolvedValue({ data: null, error: null })
  return chain
}

function buildMockSupabase(options: {
  provision?: any
  existingAdjustment?: any
  adjustmentsForRecalc?: any[]
  accountExists?: boolean
  onProvisionUpdate?: (data: any) => void
} = {}) {
  const provision = options.provision ?? {
    id: "prov-001",
    business_id: "biz-001",
    status: "draft",
    profit_before_tax: 100000,
    chargeable_income: 100000,
    cit_rate: 0.25,
    gross_revenue: 0,
  }
  const insertedAdjustment = {
    id: "adj-001",
    business_id: provision.business_id,
    provision_id: provision.id,
    adjustment_type: "add_back",
    category: "Non-deductible expense",
    amount: 10000,
    notes: null,
  }
  const updatedProvision = (data: any) => ({
    ...provision,
    ...data,
  })

  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: "user-001" } } }),
    },
    from: jest.fn((table: string) => {
      if (table === "cit_provisions") {
        let updatePayload: any = null
        return buildChain({
          maybeSingle: jest.fn().mockResolvedValue({ data: provision, error: null }),
          update: jest.fn((data: any) => {
            updatePayload = data
            options.onProvisionUpdate?.(data)
            return buildChain({
              eq: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({ data: updatedProvision(updatePayload), error: null }),
            })
          }),
        })
      }
      if (table === "accounts") {
        return buildChain({
          maybeSingle: jest.fn().mockResolvedValue({
            data: options.accountExists === false ? null : { id: "acct-001" },
            error: null,
          }),
        })
      }
      if (table === "cit_adjustments") {
        let updatePayload: any = null
        const chain = buildChain({
          select: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          update: jest.fn((data: any) => {
            updatePayload = data
            return buildChain({
              eq: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({ data: { ...insertedAdjustment, ...updatePayload }, error: null }),
            })
          }),
          delete: jest.fn().mockReturnThis(),
          order: jest.fn().mockResolvedValue({ data: options.adjustmentsForRecalc ?? [], error: null }),
          maybeSingle: jest.fn().mockResolvedValue({
            data: options.existingAdjustment ?? insertedAdjustment,
            error: null,
          }),
          single: jest.fn().mockResolvedValue({ data: insertedAdjustment, error: null }),
        })
        chain.then = (resolve: any) => resolve({ data: options.adjustmentsForRecalc ?? [], error: null })
        return chain
      }
      return buildChain({})
    }),
  }
}

describe("CIT adjustments API", () => {
  it("creates an add-back adjustment and recalculates provision totals", async () => {
    let capturedUpdate: any = null
    mockCreateSupabase.mockResolvedValue(buildMockSupabase({
      adjustmentsForRecalc: [{ adjustment_type: "add_back", amount: 10000 }],
      onProvisionUpdate: (data) => {
        capturedUpdate = data
      },
    }) as any)

    const res = await POST(makeRequest("/api/cit/adjustments", {
      provision_id: "prov-001",
      adjustment_type: "add_back",
      category: "Non-deductible expense",
      amount: 10000,
    }))

    expect(res.status).toBe(200)
    expect(capturedUpdate).toMatchObject({
      add_backs_total: 10000,
      deductions_total: 0,
      chargeable_income: 110000,
      cit_amount: 27500,
    })
  })

  it("creates a deduction adjustment and recalculates provision totals", async () => {
    let capturedUpdate: any = null
    mockCreateSupabase.mockResolvedValue(buildMockSupabase({
      adjustmentsForRecalc: [{ adjustment_type: "deduction", amount: 10000 }],
      onProvisionUpdate: (data) => {
        capturedUpdate = data
      },
    }) as any)

    const res = await POST(makeRequest("/api/cit/adjustments", {
      provision_id: "prov-001",
      adjustment_type: "deduction",
      category: "Capital allowance",
      amount: 10000,
    }))

    expect(res.status).toBe(200)
    expect(capturedUpdate).toMatchObject({
      add_backs_total: 0,
      deductions_total: 10000,
      chargeable_income: 90000,
      cit_amount: 22500,
    })
  })

  it("does not allow zero or negative adjustment amounts", async () => {
    mockCreateSupabase.mockResolvedValue(buildMockSupabase() as any)

    const zero = await POST(makeRequest("/api/cit/adjustments", {
      provision_id: "prov-001",
      adjustment_type: "add_back",
      category: "Other add-back",
      amount: 0,
    }))
    expect(zero.status).toBe(400)

    const negative = await POST(makeRequest("/api/cit/adjustments", {
      provision_id: "prov-001",
      adjustment_type: "deduction",
      category: "Other deduction",
      amount: -1,
    }))
    expect(negative.status).toBe(400)
  })

  it("does not allow creating adjustments after provision is posted", async () => {
    mockCreateSupabase.mockResolvedValue(buildMockSupabase({
      provision: {
        id: "prov-001",
        business_id: "biz-001",
        status: "posted",
        profit_before_tax: 100000,
        chargeable_income: 100000,
        cit_rate: 0.25,
        gross_revenue: 0,
      },
    }) as any)

    const res = await POST(makeRequest("/api/cit/adjustments", {
      provision_id: "prov-001",
      adjustment_type: "add_back",
      category: "Other add-back",
      amount: 100,
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/draft status/)
  })

  it("does not allow account_id from another business", async () => {
    mockCreateSupabase.mockResolvedValue(buildMockSupabase({ accountExists: false }) as any)

    const res = await POST(makeRequest("/api/cit/adjustments", {
      provision_id: "prov-001",
      adjustment_type: "add_back",
      category: "Other add-back",
      amount: 100,
      account_id: "acct-other",
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/same business/)
  })

  it("does not allow editing adjustments after provision is paid", async () => {
    mockCreateSupabase.mockResolvedValue(buildMockSupabase({
      provision: {
        id: "prov-001",
        business_id: "biz-001",
        status: "paid",
        profit_before_tax: 100000,
        chargeable_income: 100000,
        cit_rate: 0.25,
        gross_revenue: 0,
      },
    }) as any)

    const res = await PATCH(
      makeRequest("/api/cit/adjustments/adj-001", { amount: 200 }) as any,
      { params: Promise.resolve({ id: "adj-001" }) }
    )

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/draft status/)
  })

  it("lists adjustments for a provision", async () => {
    mockCreateSupabase.mockResolvedValue(buildMockSupabase({
      adjustmentsForRecalc: [{ id: "adj-001", adjustment_type: "add_back", amount: 100 }],
    }) as any)

    const res = await GET(makeRequest("/api/cit/adjustments?provision_id=prov-001"))
    expect(res.status).toBe(200)
  })

  it("deletes draft adjustments and recalculates totals", async () => {
    let capturedUpdate: any = null
    mockCreateSupabase.mockResolvedValue(buildMockSupabase({
      adjustmentsForRecalc: [],
      onProvisionUpdate: (data) => {
        capturedUpdate = data
      },
    }) as any)

    const res = await DELETE(
      makeRequest("/api/cit/adjustments/adj-001") as any,
      { params: Promise.resolve({ id: "adj-001" }) }
    )

    expect(res.status).toBe(200)
    expect(capturedUpdate).toMatchObject({
      add_backs_total: 0,
      deductions_total: 0,
      chargeable_income: 100000,
      cit_amount: 25000,
    })
  })
})
