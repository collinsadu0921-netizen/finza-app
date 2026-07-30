/**
 * Batch workflow API routes — migration 564 RPC wiring
 */

import { PATCH as patchBatch } from "@/app/api/payroll/runs/[id]/payment-batches/[batchId]/route"
import { PATCH as patchBatchItem } from "@/app/api/payroll/runs/[id]/payment-batches/[batchId]/items/[itemId]/route"
import { NextRequest } from "next/server"
import { readFileSync } from "fs"
import { resolve } from "path"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))
jest.mock("@/lib/userPermissions", () => ({
  requirePermission: jest.fn(),
  hasPermission: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1", name: "Test" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("batch PATCH route uses RPC", () => {
  it("calls transition_payroll_payment_batch_status_atomic", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { reused: false, status: "ready" },
      error: null,
    })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: "batch-1", status: "ready", business_id: "biz-1" },
          error: null,
        }),
      })),
    } as any)

    const req = new NextRequest("http://localhost/api/payroll/runs/run-1/payment-batches/batch-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "ready" }),
    })
    const res = await patchBatch(req, { params: { id: "run-1", batchId: "batch-1" } })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("transition_payroll_payment_batch_status_atomic", {
      p_business_id: "biz-1",
      p_payroll_run_id: "run-1",
      p_batch_id: "batch-1",
      p_next_status: "ready",
    })
  })
})

describe("batch item PATCH route uses RPC", () => {
  it("rejects paid status with 409", async () => {
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc: jest.fn(),
    } as any)
    const req = new NextRequest(
      "http://localhost/api/payroll/runs/run-1/payment-batches/b1/items/i1",
      { method: "PATCH", body: JSON.stringify({ status: "paid" }) }
    )
    const res = await patchBatchItem(req, { params: { id: "run-1", batchId: "b1", itemId: "i1" } })
    expect(res.status).toBe(409)
  })

  it("calls transition_payroll_payment_batch_item_status_atomic for failed", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { reused: false, item_status: "failed", batch_status: "failed" },
      error: null,
    })
    mockCreateSupabase.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
      rpc,
      from: jest.fn((table: string) => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data:
            table === "payroll_payment_batches"
              ? { id: "b1", status: "ready", business_id: "biz-1" }
              : { id: "i1", status: "failed", batch_id: "b1" },
          error: null,
        }),
      })),
    } as any)

    const req = new NextRequest(
      "http://localhost/api/payroll/runs/run-1/payment-batches/b1/items/i1",
      { method: "PATCH", body: JSON.stringify({ status: "failed", failure_reason: "bank reject" }) }
    )
    const res = await patchBatchItem(req, { params: { id: "run-1", batchId: "b1", itemId: "i1" } })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith(
      "transition_payroll_payment_batch_item_status_atomic",
      expect.objectContaining({ p_next_status: "failed", p_failure_reason: "bank reject" })
    )
  })
})

describe("payroll page integration audit", () => {
  it("manual payment sends Idempotency-Key and no batch_id", () => {
    const src = readFileSync(resolve(process.cwd(), "app/payroll/[id]/page.tsx"), "utf8")
    expect(src).toContain('"Idempotency-Key": idempotencyKey')
    expect(src).not.toContain("manual_confirm")
    expect(src).not.toContain("batch_id: paymentForm.batch_id")
    expect(src).not.toContain("handleSelectBatchForPayment")
    expect(src).toContain("record-payment")
    expect(src).toContain("createPayrollPaymentIdempotencyKey")
  })
})
