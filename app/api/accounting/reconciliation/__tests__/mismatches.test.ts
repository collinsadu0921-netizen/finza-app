/**
 * GET /api/accounting/reconciliation/mismatches — minimal tests.
 * No real Supabase. Mocks: createSupabaseServerClient, requireBusinessRole, engine, table.
 */

import { GET } from "../mismatches/route"
import { NextRequest } from "next/server"
import {
  resultOk,
  resultWarn,
  resultFail,
} from "@/lib/accounting/reconciliation/__tests__/reconciliation-api-fixtures"
import { ReconciliationStatus } from "@/lib/accounting/reconciliation/types"

const mockRequireBusinessRole = jest.fn()
const mockIsUserAccountantReadonly = jest.fn()
const mockGetLedgerAdjustmentPolicy = jest.fn()
const mockCreateReconciliationEngine = jest.fn()

function chainResolve(value: unknown) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() => Promise.resolve(value)),
  }
  return chain
}

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn(),
}

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(() => Promise.resolve(mockSupabase)),
}))
jest.mock("@/lib/auth/requireBusinessRole", () => ({
  requireBusinessRole: (...args: unknown[]) => mockRequireBusinessRole(...args),
}))
jest.mock("@/lib/userRoles", () => ({
  isUserAccountantReadonly: (...args: unknown[]) => mockIsUserAccountantReadonly(...args),
}))
jest.mock("@/lib/accounting/reconciliation/governance", () => {
  const real = jest.requireActual("@/lib/accounting/reconciliation/governance") as typeof import("@/lib/accounting/reconciliation/governance")
  return {
    ...real,
    getLedgerAdjustmentPolicy: (...args: unknown[]) => mockGetLedgerAdjustmentPolicy(...args),
  }
})
jest.mock("@/lib/accounting/reconciliation/engine-impl", () => ({
  createReconciliationEngine: (...args: unknown[]) => mockCreateReconciliationEngine(...args),
}))

function requestWithQuery(businessId: string, limit?: number, periodId?: string): NextRequest {
  const params = new URLSearchParams({ businessId })
  if (limit != null) params.set("limit", String(limit))
  if (periodId != null) params.set("periodId", periodId)
  return new NextRequest(`http://localhost/api/accounting/reconciliation/mismatches?${params}`)
}

describe("GET /api/accounting/reconciliation/mismatches", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsUserAccountantReadonly.mockResolvedValue(false)
    mockGetLedgerAdjustmentPolicy.mockResolvedValue({
      adjustment_requires_accountant: true,
      adjustment_requires_owner_over_amount: 0,
      adjustment_requires_two_person_rule: false,
    })
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: "b1",
      role: "admin",
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "invoices") {
        return chainResolve({ data: [] })
      }
      return chainResolve({ data: null })
    })
  })

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server")
    mockRequireBusinessRole.mockResolvedValue(NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }))
    const req = requestWithQuery("b1")
    const res = await GET(req)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe("UNAUTHORIZED")
  })

  it("returns 400 when businessId missing", async () => {
    const req = new NextRequest("http://localhost/api/accounting/reconciliation/mismatches")
    const res = await GET(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/businessId/i)
  })

  it("returns empty results and proposals when no invoices", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "invoices") return chainResolve({ data: [] })
      return chainResolve({ data: null })
    })
    const req = requestWithQuery("b1")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.results).toEqual([])
    expect(data.proposals).toEqual([])
    expect(data.mismatches).toEqual([])
    expect(typeof data.canPostLedger).toBe("boolean")
  })

  it("returns only WARN/FAIL (excludes OK)", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "invoices") {
        return chainResolve({ data: [{ id: "inv-1" }, { id: "inv-2" }] })
      }
      return chainResolve({ data: null })
    })
    const mockReconcile = jest.fn()
      .mockResolvedValueOnce({ ...resultOk, scope: { ...resultOk.scope, invoiceId: "inv-1" } })
      .mockResolvedValueOnce({ ...resultWarn, scope: { ...resultWarn.scope, invoiceId: "inv-2" } })
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })

    const req = requestWithQuery("b1")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data.results)).toBe(true)
    expect(Array.isArray(data.proposals)).toBe(true)
    expect(data.results.length).toBe(1)
    expect(data.proposals.length).toBe(1)
    expect(data.results[0].status).toBe(ReconciliationStatus.WARN)
    expect(data.results[0].scope.invoiceId).toBe("inv-2")
  })

  it("includes proposals array aligned with results", async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "invoices") {
        return chainResolve({ data: [{ id: "inv-a" }] })
      }
      return chainResolve({ data: null })
    })
    const resultA = { ...resultFail, scope: { ...resultFail.scope, invoiceId: "inv-a" } }
    const mockReconcile = jest.fn().mockResolvedValue(resultA)
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })

    const req = requestWithQuery("b1")
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.results.length).toBe(1)
    expect(data.proposals.length).toBe(1)
    expect(data.mismatches.length).toBe(1)
    expect(data.mismatches[0].result).toEqual(data.results[0])
    expect(data.mismatches[0].proposal).toEqual(data.proposals[0])
    expect(data.proposals[0].audit_metadata.detected_delta).toBe(data.results[0].delta)
    expect(typeof data.canPostLedger).toBe("boolean")
  })
})
