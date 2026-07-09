/**
 * DELETE /api/payroll/runs/[id] — draft payroll run deletion.
 */

import { DELETE } from "../runs/[id]/route"
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

function buildDeleteMocks(opts: {
  run?: Record<string, unknown> | null
  paymentCount?: number
  deleteRunError?: { message: string } | null
}) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: opts.run ?? null,
    error: opts.run === undefined ? { message: "not found" } : null,
  })

  const paymentHead = jest.fn().mockResolvedValue({
    count: opts.paymentCount ?? 0,
    error: null,
  })

  const entriesDelete = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  })

  const batchUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        is: jest.fn().mockResolvedValue({ error: null }),
      }),
    }),
  })

  const payslipsDelete = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  })

  const runUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: opts.deleteRunError ?? null }),
    }),
  })

  const from = jest.fn((table: string) => {
    if (table === "payroll_runs") {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: jest.fn().mockReturnValue({ maybeSingle }),
            }),
          }),
        }),
        update: runUpdate,
      }
    }
    if (table === "payroll_payments") {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              is: paymentHead,
            }),
          }),
        }),
      }
    }
    if (table === "payroll_entries") {
      return { delete: entriesDelete }
    }
    if (table === "payroll_payment_batches") {
      return { update: batchUpdate }
    }
    if (table === "payslips") {
      return { delete: payslipsDelete }
    }
    throw new Error(`unexpected table ${table}`)
  })

  mockCreateSupabase.mockResolvedValue({
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    from,
  } as any)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("DELETE /api/payroll/runs/[id]", () => {
  it("soft-deletes draft run with no payments", async () => {
    buildDeleteMocks({
      run: { id: "run-1", business_id: "biz-1", status: "draft", journal_entry_id: null },
      paymentCount: 0,
    })

    const res = await DELETE(new NextRequest("http://localhost/api/payroll/runs/run-1"), {
      params: Promise.resolve({ id: "run-1" }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
  })

  it("blocks delete for approved runs", async () => {
    buildDeleteMocks({
      run: { id: "run-1", business_id: "biz-1", status: "approved", journal_entry_id: "je-1" },
    })

    const res = await DELETE(new NextRequest("http://localhost/api/payroll/runs/run-1"), {
      params: Promise.resolve({ id: "run-1" }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/draft/i)
  })

  it("blocks delete when salary payments exist", async () => {
    buildDeleteMocks({
      run: { id: "run-1", business_id: "biz-1", status: "draft", journal_entry_id: null },
      paymentCount: 1,
    })

    const res = await DELETE(new NextRequest("http://localhost/api/payroll/runs/run-1"), {
      params: Promise.resolve({ id: "run-1" }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/payment/i)
  })
})
