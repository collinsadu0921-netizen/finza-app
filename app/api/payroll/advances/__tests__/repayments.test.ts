/**
 * POST /api/payroll/advances/[id]/repayments — direct repayment with accounting
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
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn().mockResolvedValue(undefined),
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
}

function buildClient(opts: {
  rpc?: { data: unknown; error: unknown }
  advanceUpdate?: any
}) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    rpc: jest.fn().mockResolvedValue(
      opts.rpc ?? {
        data: {
          reused: false,
          repayment_id: "rep-1",
          journal_entry_id: "je-1",
          amount: 300,
          status: "posted",
          repayment_method: "direct_bank",
          repaid_amount: 300,
          outstanding: 700,
          advance_status: "partially_repaid",
        },
        error: null,
      }
    ),
    from: jest.fn((table: string) => {
      if (table === "salary_advances") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: opts.advanceUpdate ?? { ...advance, repaid_amount: 300, status: "partially_repaid" },
            error: null,
          }),
        }
      }
      return {} as any
    }),
  }
}

describe("POST /api/payroll/advances/[id]/repayments", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetBusiness.mockResolvedValue({ id: "biz-1" } as any)
    mockRequirePermission.mockResolvedValue({ allowed: true } as any)
  })

  it("rejects legacy payroll_run_id repayment without payment_account_id", async () => {
    mockCreateSupabase.mockResolvedValue(buildClient({}) as any)
    const req = new NextRequest("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ amount: 100, payroll_run_id: "run-1" }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: "adv-1" }) })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("SALARY_ADVANCE_DIRECT_REPAYMENT_REQUIRES_ACCOUNTING")
  })

  it("posts cash/bank repayment via RPC", async () => {
    const client = buildClient({})
    mockCreateSupabase.mockResolvedValue(client as any)
    const req = new NextRequest("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        amount: 300,
        payment_account_id: "acct-bank",
        payment_date: "2026-06-01",
        idempotency_key: "key-1",
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: "adv-1" }) })
    expect(res.status).toBe(200)
    expect(client.rpc).toHaveBeenCalledWith(
      "post_salary_advance_direct_repayment",
      expect.objectContaining({
        p_business_id: "biz-1",
        p_advance_id: "adv-1",
        p_amount: 300,
        p_payment_account_id: "acct-bank",
        p_idempotency_key: "key-1",
      })
    )
    const body = await res.json()
    expect(body.outstanding_amount).toBe(700)
    expect(body.repayment.journal_entry_id).toBe("je-1")
  })

  it("returns existing repayment for duplicate idempotency key", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({
        rpc: {
          data: {
            reused: true,
            repayment_id: "rep-1",
            journal_entry_id: "je-1",
            amount: 300,
            status: "posted",
            outstanding: 700,
          },
          error: null,
        },
      }) as any
    )
    const req = new NextRequest("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        amount: 300,
        payment_account_id: "acct-bank",
        payment_date: "2026-06-01",
        idempotency_key: "key-1",
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: "adv-1" }) })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.reused).toBe(true)
  })

  it("blocks over-repayment from RPC error", async () => {
    mockCreateSupabase.mockResolvedValue(
      buildClient({
        rpc: {
          data: null,
          error: { message: "Repayment exceeds outstanding balance", details: null },
        },
      }) as any
    )
    const req = new NextRequest("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({
        amount: 9999,
        payment_account_id: "acct-bank",
        payment_date: "2026-06-01",
        idempotency_key: "key-2",
      }),
    })
    const res = await POST(req, { params: Promise.resolve({ id: "adv-1" }) })
    expect(res.status).toBe(400)
  })
})
