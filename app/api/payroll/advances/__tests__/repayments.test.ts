/**
 * POST /api/payroll/advances/[id]/repayments
 */

import { POST } from "@/app/api/payroll/advances/[id]/repayments/route"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/userPermissions", () => ({
  requirePermission: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryMinTier", () => ({
  enforceServiceIndustryMinTierWrite: jest.fn().mockResolvedValue(null),
}))

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"

const mockCreateSupabase = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockGetBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>
const mockRequirePermission = requirePermission as jest.MockedFunction<typeof requirePermission>

const advance = {
  id: "adv-1",
  business_id: "biz-1",
  staff_id: "staff-1",
  amount: 1000,
  repaid_amount: 0,
  status: "outstanding",
  cancelled_at: null,
  cleared_at: null,
}

function buildSupabase(overrides: {
  advance?: typeof advance | null
  payrollRun?: { id: string; business_id: string; status: string } | null
  entry?: { id: string; staff_id: string; payroll_run_id: string } | null
  repaymentInsert?: { data: unknown; error: unknown }
  advanceUpdate?: { data: unknown; error: unknown }
}) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    from: jest.fn((table: string) => {
      if (table === "salary_advances") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: overrides.advance === undefined ? advance : overrides.advance,
            error: overrides.advance === null ? { message: "not found" } : null,
          }),
          update: jest.fn().mockReturnThis(),
          delete: jest.fn().mockReturnThis(),
        }
      }
      if (table === "payroll_runs") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          is: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: overrides.payrollRun === undefined ? { id: "run-1", business_id: "biz-1", status: "draft" } : overrides.payrollRun,
            error: overrides.payrollRun === null ? { message: "not found" } : null,
          }),
        }
      }
      if (table === "payroll_entries") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: overrides.entry === undefined ? { id: "entry-1", staff_id: "staff-1", payroll_run_id: "run-1" } : overrides.entry,
            error: overrides.entry === null ? { message: "not found" } : null,
          }),
        }
      }
      if (table === "salary_advance_repayments") {
        const chain = {
          insert: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue(
            overrides.repaymentInsert ?? {
              data: { id: "rep-1", amount: 300, status: "posted" },
              error: null,
            }
          ),
          delete: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
        }
        return chain
      }
      return {} as any
    }),
  } as any
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1", address_country: "GH" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("POST /api/payroll/advances/[id]/repayments", () => {
  it("records partial repayment and returns updated advance", async () => {
    const supabase = buildSupabase({
      advanceUpdate: {
        data: { ...advance, repaid_amount: 300, status: "partially_repaid" },
        error: null,
      },
    })
    const updateChain = {
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { ...advance, repaid_amount: 300, status: "partially_repaid" },
        error: null,
      }),
    }
    supabase.from = jest.fn((table: string) => {
      const base = buildSupabase({}).from(table)
      if (table === "salary_advances") {
        return {
          ...base,
          update: jest.fn().mockReturnValue(updateChain),
        }
      }
      return base
    }) as any

    mockCreateSupabase.mockResolvedValue(supabase)

    const res = await POST(
      new NextRequest("http://localhost/api/payroll/advances/adv-1/repayments", {
        method: "POST",
        body: JSON.stringify({ amount: 300, payroll_run_id: "run-1", payroll_entry_id: "entry-1" }),
      }),
      { params: Promise.resolve({ id: "adv-1" }) }
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.advance.status).toBe("partially_repaid")
    expect(body.outstanding_amount).toBe(700)
  })

  it("rejects overpayment", async () => {
    mockCreateSupabase.mockResolvedValue(buildSupabase({}))

    const res = await POST(
      new NextRequest("http://localhost/api/payroll/advances/adv-1/repayments", {
        method: "POST",
        body: JSON.stringify({ amount: 1500, payroll_run_id: "run-1" }),
      }),
      { params: Promise.resolve({ id: "adv-1" }) }
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/exceeds outstanding/)
  })

  it("rejects advance from another tenant", async () => {
    mockCreateSupabase.mockResolvedValue(buildSupabase({ advance: null }))

    const res = await POST(
      new NextRequest("http://localhost/api/payroll/advances/adv-other/repayments", {
        method: "POST",
        body: JSON.stringify({ amount: 100, payroll_run_id: "run-1" }),
      }),
      { params: Promise.resolve({ id: "adv-other" }) }
    )

    expect(res.status).toBe(404)
  })

  it("rejects payroll run from another tenant", async () => {
    mockCreateSupabase.mockResolvedValue(buildSupabase({ payrollRun: null }))

    const res = await POST(
      new NextRequest("http://localhost/api/payroll/advances/adv-1/repayments", {
        method: "POST",
        body: JSON.stringify({ amount: 100, payroll_run_id: "run-other" }),
      }),
      { params: Promise.resolve({ id: "adv-1" }) }
    )

    expect(res.status).toBe(404)
  })

  it("rejects repayment on cleared advance", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildSupabase({
        advance: { ...advance, repaid_amount: 1000, status: "cleared" },
      })
    )

    const res = await POST(
      new NextRequest("http://localhost/api/payroll/advances/adv-1/repayments", {
        method: "POST",
        body: JSON.stringify({ amount: 100, payroll_run_id: "run-1" }),
      }),
      { params: Promise.resolve({ id: "adv-1" }) }
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/fully repaid/)
  })

  it("rejects entry staff mismatch", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildSupabase({
        entry: { id: "entry-1", staff_id: "staff-other", payroll_run_id: "run-1" },
      })
    )

    const res = await POST(
      new NextRequest("http://localhost/api/payroll/advances/adv-1/repayments", {
        method: "POST",
        body: JSON.stringify({ amount: 100, payroll_run_id: "run-1", payroll_entry_id: "entry-1" }),
      }),
      { params: Promise.resolve({ id: "adv-1" }) }
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/staff member/)
  })
})
