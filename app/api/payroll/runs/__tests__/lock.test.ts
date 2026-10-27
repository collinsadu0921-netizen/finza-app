/**
 * PUT /api/payroll/runs/[id] — payroll locking idempotency and immutability.
 *
 * Regression coverage for the P0 lock replay defect:
 *   approved -> locked succeeds
 *   locked -> locked reuses the canonical RPC result without an update
 *   locked + notes/status edit is rejected
 *   unauthorized and cross-business requests are blocked
 */

import { PUT } from "@/app/api/payroll/runs/[id]/route"
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

type QueryResult = { data: unknown; error: unknown }

function makeQuery(singleResults: QueryResult[], updateMock: jest.Mock) {
  const q: Record<string, unknown> = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    is: jest.fn(() => q),
    update: jest.fn(() => {
      updateMock()
      return q
    }),
    single: jest.fn(() => Promise.resolve(singleResults.shift() ?? { data: null, error: null })),
    then: (resolve: (value: QueryResult) => void) => resolve({ data: null, error: null }),
  }
  return q
}

function buildClient(opts: {
  existing: QueryResult
  reload?: QueryResult
  updated?: QueryResult
  lockResult?: QueryResult
}) {
  const updateMock = jest.fn()
  const singleResults: QueryResult[] = [
    opts.existing,
    opts.reload ?? { data: null, error: null },
    opts.updated ?? { data: null, error: null },
  ]
  const rpc = jest.fn().mockResolvedValue(
    opts.lockResult ?? { data: { reused: false, status: "locked" }, error: null }
  )
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: "u1" } } }) },
    rpc,
    from: jest.fn((table: string) => {
      if (table === "payroll_runs") return makeQuery(singleResults, updateMock)
      return makeQuery([], updateMock)
    }),
    updateMock,
  }
}

function putRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/payroll/runs/run-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const approvedRun = {
  data: {
    status: "approved",
    journal_entry_id: "je-1",
    payroll_frequency: "monthly",
    calculation_engine_version: "finza-ghana-v2",
    paye_rate_version: "gh-paye-2024-01",
    pension_rate_version: "gh-pension-2026-01",
    calculation_jurisdiction: "GH",
    statutory_period_basis: "2026-10-01",
  },
  error: null,
}

const lockedRun = {
  data: {
    ...approvedRun.data,
    status: "locked",
  },
  error: null,
}

const reloadedLocked = {
  data: { id: "run-1", business_id: "biz-1", status: "locked" },
  error: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetBusiness.mockResolvedValue({ id: "biz-1", name: "Test" } as any)
  mockRequirePermission.mockResolvedValue({ allowed: true } as any)
})

describe("PUT /api/payroll/runs/[id] — locking", () => {
  it("locks an approved run via the canonical RPC and does not update the table", async () => {
    const client = buildClient({
      existing: approvedRun,
      reload: reloadedLocked,
      lockResult: { data: { reused: false, status: "locked" }, error: null },
    })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await PUT(putRequest({ status: "locked" }), { params: { id: "run-1" } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.reused).toBe(false)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith("lock_payroll_run_atomic", {
      p_business_id: "biz-1",
      p_payroll_run_id: "run-1",
    })
    expect(client.updateMock).not.toHaveBeenCalled()
  })

  it("returns success with reused=true for an already locked run without updating it", async () => {
    const client = buildClient({
      existing: lockedRun,
      reload: reloadedLocked,
      lockResult: { data: { reused: true, status: "locked" }, error: null },
    })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await PUT(putRequest({ status: "locked" }), { params: { id: "run-1" } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.reused).toBe(true)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.updateMock).not.toHaveBeenCalled()
  })

  it("rejects notes on a locked run without calling the lock RPC or updating", async () => {
    const client = buildClient({ existing: lockedRun, reload: reloadedLocked })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await PUT(putRequest({ notes: "should not change" }), { params: { id: "run-1" } })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe("PAYROLL_RUN_IMMUTABLE")
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.updateMock).not.toHaveBeenCalled()
  })

  it("rejects a non-lock status change on a locked run", async () => {
    const client = buildClient({ existing: lockedRun, reload: reloadedLocked })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await PUT(putRequest({ status: "draft" }), { params: { id: "run-1" } })

    expect(res.status).toBe(409)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.updateMock).not.toHaveBeenCalled()
  })

  it("blocks a user without payroll lock permission", async () => {
    mockRequirePermission.mockResolvedValue({ allowed: false } as any)
    const client = buildClient({ existing: lockedRun, reload: reloadedLocked })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await PUT(putRequest({ status: "locked" }), { params: { id: "run-1" } })

    expect(res.status).toBe(403)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.updateMock).not.toHaveBeenCalled()
  })

  it("returns 404 for a run outside the current business", async () => {
    const client = buildClient({ existing: { data: null, error: { code: "PGRST116" } } })
    mockCreateSupabase.mockResolvedValue(client as any)

    const res = await PUT(putRequest({ status: "locked" }), { params: { id: "run-1" } })

    expect(res.status).toBe(404)
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.updateMock).not.toHaveBeenCalled()
  })
})
