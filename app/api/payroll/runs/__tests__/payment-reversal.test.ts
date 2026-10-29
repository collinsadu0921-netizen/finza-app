/**
 * POST /api/payroll/runs/[id]/payments/[paymentId]/reverse
 * Phase 1 controlled salary-payment reversal route.
 */

import { POST as postReversal } from "@/app/api/payroll/runs/[id]/payments/[paymentId]/reverse/route"
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

function buildClient(options: {
  payment?: unknown
  rpcResult?: { data: unknown; error: unknown }
} = {}) {
  const rpc = jest.fn().mockResolvedValue(options.rpcResult ?? { data: null, error: null })
  const paymentQuery: Record<string, unknown> = {
    select: jest.fn(() => paymentQuery),
    eq: jest.fn(() => paymentQuery),
    is: jest.fn(() => paymentQuery),
    maybeSingle: jest.fn().mockResolvedValue({
      data: options.payment !== undefined ? options.payment : { id: "pay-1", payroll_run_id: "run-1" },
      error: null,
    }),
  }
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    rpc,
    from: jest.fn((table: string) => {
      if (table === "payroll_payments") return paymentQuery
      throw new Error(`Unexpected table ${table}`)
    }),
  }
}

function reversalRequest(body: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost/api/payroll/runs/run-1/payments/pay-1/reverse",
    { method: "POST", body: JSON.stringify(body) }
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1", name: "Test" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("POST payroll payment reversal", () => {
  it("rejects a missing or short reason", async () => {
    mockCreateSupabase.mockResolvedValue(buildClient() as any)
    const res = await postReversal(reversalRequest({ reversal_date: "2026-10-29", reason: "x" }), {
      params: { id: "run-1", paymentId: "pay-1" },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("PAYROLL_PAYMENT_REVERSAL_INVALID_INPUT")
  })

  it("rejects an unauthorized user before calling the RPC", async () => {
    mockRequirePermission.mockResolvedValue({ allowed: false } as any)
    const client = buildClient()
    mockCreateSupabase.mockResolvedValue(client as any)
    const res = await postReversal(
      reversalRequest({ reversal_date: "2026-10-29", reason: "Duplicate payment" }),
      { params: { id: "run-1", paymentId: "pay-1" } }
    )
    expect(res.status).toBe(403)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("rejects a payment that is not on the requested run", async () => {
    const client = buildClient({ payment: null })
    mockCreateSupabase.mockResolvedValue(client as any)
    const res = await postReversal(
      reversalRequest({ reversal_date: "2026-10-29", reason: "Duplicate payment" }),
      { params: { id: "run-1", paymentId: "pay-1" } }
    )
    expect(res.status).toBe(404)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it("calls reverse_payroll_payment_atomic with validated inputs", async () => {
    const client = buildClient({
      rpcResult: {
        data: {
          reused: false,
          payment_id: "pay-1",
          reversal_journal_id: "je-rev-1",
          original_journal_id: "je-orig-1",
        },
        error: null,
      },
    })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await postReversal(
      reversalRequest({ reversal_date: "2026-10-29", reason: "Employee was paid twice" }),
      { params: { id: "run-1", paymentId: "pay-1" } }
    )

    expect(res.status).toBe(200)
    expect(client.rpc).toHaveBeenCalledWith("reverse_payroll_payment_atomic", {
      p_business_id: "biz-1",
      p_payroll_payment_id: "pay-1",
      p_reversal_date: "2026-10-29",
      p_reason: "Employee was paid twice",
    })
  })

  it("maps a closed reversal period to 409", async () => {
    const client = buildClient({
      rpcResult: {
        data: null,
        error: { message: "PAYROLL_PAYMENT_REVERSAL_PERIOD_CLOSED: period closed" },
      },
    })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await postReversal(
      reversalRequest({ reversal_date: "2026-10-29", reason: "Duplicate payment" }),
      { params: { id: "run-1", paymentId: "pay-1" } }
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("PAYROLL_PAYMENT_REVERSAL_PERIOD_CLOSED")
  })

  it("returns a reused reversal without creating another journal", async () => {
    const client = buildClient({
      rpcResult: {
        data: { reused: true, payment_id: "pay-1", reversal_journal_id: "je-rev-1" },
        error: null,
      },
    })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await postReversal(
      reversalRequest({ reversal_date: "2026-10-29", reason: "Duplicate payment" }),
      { params: { id: "run-1", paymentId: "pay-1" } }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reused).toBe(true)
  })
})
