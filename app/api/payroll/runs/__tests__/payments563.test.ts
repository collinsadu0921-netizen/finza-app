/**
 * POST payment routes — idempotency header and RPC wiring (563)
 */

import { POST as postRunPayment } from "@/app/api/payroll/runs/[id]/payments/route"
import { POST as postBatchItemPayment } from "@/app/api/payroll/runs/[id]/payment-batches/[batchId]/items/[itemId]/record-payment/route"
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
  enforceServiceIndustryMinTier: jest.fn().mockResolvedValue(null),
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

const STABLE_KEY = "client-stable-key-001"

function buildPaymentClient(rpcResult: { data: unknown; error: unknown }) {
  const rpc = jest.fn().mockResolvedValue(rpcResult)
  const makeQuery = (resolved: unknown) => {
    const q: Record<string, unknown> = {
      select: jest.fn(() => q),
      eq: jest.fn(() => q),
      is: jest.fn(() => q),
      not: jest.fn(() => q),
      order: jest.fn(() => q),
      single: jest.fn().mockResolvedValue(resolved),
      then: (resolve: (v: unknown) => void) => resolve(resolved),
    }
    return q
  }
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    rpc,
    from: jest.fn((table: string) => {
      if (table === "payroll_runs") {
        return makeQuery({
          data: { id: "run-1", business_id: "biz-1", status: "approved", total_net_salary: 1000 },
          error: null,
        })
      }
      return makeQuery({ data: [], error: null })
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1", name: "Test" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("POST /api/payroll/runs/[id]/payments", () => {
  it("rejects missing Idempotency-Key", async () => {
    mockCreateSupabase.mockResolvedValue(buildPaymentClient({ data: null, error: null }) as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payments", {
      method: "POST",
      body: JSON.stringify({
        payment_date: "2026-06-15",
        amount: 500,
        payment_account_id: "acc-1",
      }),
    })
    const res = await postRunPayment(req, { params: { id: "run-1" } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe("PAYROLL_PAYMENT_IDEMPOTENCY_KEY_REQUIRED")
  })

  it("rejects invalid key length", async () => {
    mockCreateSupabase.mockResolvedValue(buildPaymentClient({ data: null, error: null }) as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payments", {
      method: "POST",
      headers: { "Idempotency-Key": "short" },
      body: JSON.stringify({
        payment_date: "2026-06-15",
        amount: 500,
        payment_account_id: "acc-1",
      }),
    })
    const res = await postRunPayment(req, { params: { id: "run-1" } })
    expect(res.status).toBe(400)
  })

  it("rejects header/body idempotency mismatch", async () => {
    mockCreateSupabase.mockResolvedValue(buildPaymentClient({ data: null, error: null }) as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payments", {
      method: "POST",
      headers: { "Idempotency-Key": STABLE_KEY },
      body: JSON.stringify({
        payment_date: "2026-06-15",
        amount: 500,
        payment_account_id: "acc-1",
        idempotency_key: "other-stable-key-002",
      }),
    })
    const res = await postRunPayment(req, { params: { id: "run-1" } })
    expect(res.status).toBe(400)
  })

  it("calls RPC without p_actor_id and with stable header key", async () => {
    const client = buildPaymentClient({
      data: { reused: false, payment_id: "pay-1", journal_entry_id: "je-1", amount: 500 },
      error: null,
    })
    mockCreateSupabase.mockResolvedValue(client as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payments", {
      method: "POST",
      headers: { "Idempotency-Key": STABLE_KEY },
      body: JSON.stringify({
        payment_date: "2026-06-15",
        amount: 500,
        payment_account_id: "acc-1",
      }),
    })
    const res = await postRunPayment(req, { params: { id: "run-1" } })
    expect(res.status).toBe(201)
    expect(client.rpc).toHaveBeenCalledWith(
      "record_payroll_payment_atomic",
      expect.objectContaining({
        p_idempotency_key: STABLE_KEY,
        p_business_id: "biz-1",
        p_payroll_run_id: "run-1",
      })
    )
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty("p_actor_id")
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty("p_batch_id")
  })

  it("returns reused result on idempotent retry", async () => {
    const client = buildPaymentClient({
      data: { reused: true, payment_id: "pay-1", journal_entry_id: "je-1", amount: 500 },
      error: null,
    })
    mockCreateSupabase.mockResolvedValue(client as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payments", {
      method: "POST",
      headers: { "Idempotency-Key": STABLE_KEY },
      body: JSON.stringify({
        payment_date: "2026-06-15",
        amount: 500,
        payment_account_id: "acc-1",
      }),
    })
    const res = await postRunPayment(req, { params: { id: "run-1" } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reused).toBe(true)
  })

  it("maps idempotency conflict to 409", async () => {
    const client = buildPaymentClient({
      data: null,
      error: { message: "PAYROLL_PAYMENT_IDEMPOTENCY_CONFLICT: key reused" },
    })
    mockCreateSupabase.mockResolvedValue(client as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payments", {
      method: "POST",
      headers: { "Idempotency-Key": STABLE_KEY },
      body: JSON.stringify({
        payment_date: "2026-06-15",
        amount: 500,
        payment_account_id: "acc-1",
      }),
    })
    const res = await postRunPayment(req, { params: { id: "run-1" } })
    expect(res.status).toBe(409)
  })
})

describe("POST batch item record-payment", () => {
  it("requires Idempotency-Key header", async () => {
    mockCreateSupabase.mockResolvedValue(buildPaymentClient({ data: null, error: null }) as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payment-batches/b1/items/i1/record-payment", {
      method: "POST",
      body: JSON.stringify({
        payment_date: "2026-06-15",
        payment_account_id: "acc-1",
      }),
    })
    const res = await postBatchItemPayment(req, {
      params: { id: "run-1", batchId: "b1", itemId: "i1" },
    })
    expect(res.status).toBe(400)
  })

  it("calls batch RPC without p_actor_id", async () => {
    const client = buildPaymentClient({
      data: { reused: false, payment_id: "pay-2", batch_status: "partially_paid" },
      error: null,
    })
    mockCreateSupabase.mockResolvedValue(client as any)
    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payment-batches/b1/items/i1/record-payment", {
      method: "POST",
      headers: { "Idempotency-Key": STABLE_KEY },
      body: JSON.stringify({
        payment_date: "2026-06-15",
        payment_account_id: "acc-1",
      }),
    })
    const res = await postBatchItemPayment(req, {
      params: { id: "run-1", batchId: "b1", itemId: "i1" },
    })
    expect(res.status).toBe(201)
    expect(client.rpc).toHaveBeenCalledWith(
      "record_payroll_batch_item_payment_atomic",
      expect.objectContaining({ p_idempotency_key: STABLE_KEY, p_batch_item_id: "i1" })
    )
    expect(client.rpc.mock.calls[0][1]).not.toHaveProperty("p_actor_id")
  })
})
