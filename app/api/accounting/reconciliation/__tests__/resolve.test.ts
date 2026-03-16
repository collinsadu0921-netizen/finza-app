/**
 * POST /api/accounting/reconciliation/resolve — minimal tests.
 * No real Supabase. Mocks: createSupabaseServerClient, requireBusinessRole, engine, RPC, table, governance.
 */

import { POST } from "../resolve/route"
import { NextRequest } from "next/server"
import {
  resultWarn,
  resultOk,
  resolveBodyValid,
  clientSeen,
  proposedFixStrict,
} from "@/lib/accounting/reconciliation/__tests__/reconciliation-api-fixtures"
import { ReconciliationStatus } from "@/lib/accounting/reconciliation/types"
import {
  proposalHashFromResultAndProposal,
} from "@/lib/accounting/reconciliation/governance"
import { produceLedgerCorrectionProposal } from "@/lib/accounting/reconciliation/resolution"

const mockRequireBusinessRole = jest.fn()
const mockIsUserAccountantReadonly = jest.fn()
const mockGetLedgerAdjustmentPolicy = jest.fn()
const mockCreateReconciliationEngine = jest.fn()

function chainResolve(value: unknown) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockImplementation(() => Promise.resolve(value)),
  }
  return chain
}

const mockSupabase = {
  auth: { getUser: jest.fn() },
  from: jest.fn(),
  rpc: jest.fn(),
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

function jsonRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/accounting/reconciliation/resolve", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

/**
 * Build resolve body with proposal_hash. Hash is full (result + proposed_fix).
 * For success: pass resultBefore so hash matches server's re-run; for 409 tests
 * use stale hash (resultWarn + proposedFixStrict) so server returns 409.
 */
function bodyWithHash(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = { ...resolveBodyValid, ...overrides } as Record<string, unknown>
  const resultBefore = body.resultBefore as import("@/lib/accounting/reconciliation/types").ReconciliationResult | undefined
  const proposal_hash = resultBefore != null
    ? (() => {
        const proposal = produceLedgerCorrectionProposal(resultBefore)
        return proposal.proposed_fix
          ? proposalHashFromResultAndProposal(resultBefore, proposal.proposed_fix)
          : proposalHashFromResultAndProposal(resultWarn, proposedFixStrict)
      })()
    : proposalHashFromResultAndProposal(resultWarn, proposedFixStrict)
  const { resultBefore: _r, ...rest } = body
  return { ...rest, proposal_hash }
}

describe("POST /api/accounting/reconciliation/resolve", () => {
  const defaultPolicy = {
    adjustment_requires_accountant: true,
    adjustment_requires_owner_over_amount: 0,
    adjustment_requires_two_person_rule: false,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockIsUserAccountantReadonly.mockResolvedValue(false)
    mockGetLedgerAdjustmentPolicy.mockResolvedValue(defaultPolicy)
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "accounts") {
        return chainResolve({
          data: [
            { id: "acc-1100", code: "1100" },
            { id: "acc-4000", code: "4000" },
          ],
        })
      }
      if (table === "reconciliation_resolutions") {
        return { insert: jest.fn().mockResolvedValue({ error: null }) }
      }
      if (table === "ledger_adjustment_approvals") {
        return { insert: jest.fn().mockResolvedValue({ error: null }) }
      }
      return chainResolve({ data: null })
    })
  })

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server")
    mockRequireBusinessRole.mockResolvedValue(NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }))
    const req = jsonRequest(bodyWithHash())
    const res = await POST(req)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe("UNAUTHORIZED")
  })

  it("returns 400 when proposal_hash is missing", async () => {
    const req = jsonRequest({ ...resolveBodyValid })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/proposal_hash/)
  })

  it("returns 409 when proposal_hash is stale (hash lock); stale proposals cannot be posted", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "admin",
    })
    const resultBefore = { ...resultOk, delta: -5, status: ReconciliationStatus.FAIL }
    const mockReconcile = jest.fn().mockResolvedValue(resultBefore)
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })
    const req = jsonRequest({ ...resolveBodyValid, proposal_hash: "stale-or-wrong-hash" })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe("STALE_RECONCILIATION")
    expect(data.result).toBeDefined()
    expect(data.proposal).toBeDefined()
    expect(data.proposal_hash).toBeDefined()
  })

  it("returns 403 when user lacks role", async () => {
    const { NextResponse } = await import("next/server")
    mockRequireBusinessRole.mockResolvedValue(NextResponse.json({ error: "FORBIDDEN" }, { status: 403 }))
    const req = jsonRequest(bodyWithHash())
    const res = await POST(req)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toBe("FORBIDDEN")
  })

  it("returns 403 when user role is not owner/admin/accountant", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "manager",
    })
    const req = jsonRequest(bodyWithHash())
    const res = await POST(req)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/Only accountants|admins|owner can post ledger adjustments/)
  })

  it("returns 403 when accountant has readonly access", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "accountant",
    })
    mockIsUserAccountantReadonly.mockResolvedValue(true)
    const req = jsonRequest(bodyWithHash())
    const res = await POST(req)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toMatch(/Only accountants with write access can post ledger adjustments/)
  })

  it("returns 400 when proposed_fix is null", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "admin",
    })
    const body = { ...resolveBodyValid, proposed_fix: null, proposal_hash: "any" }
    const req = jsonRequest(body)
    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/proposed_fix|journal_entry|lines/i)
  })

  it("returns 409 when delta drifted (STALE_RECONCILIATION)", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "admin",
    })
    const resultBeforeDrifted = { ...resultWarn, delta: -10 }
    const mockReconcile = jest.fn().mockResolvedValue(resultBeforeDrifted)
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })
    const req = jsonRequest(bodyWithHash())
    const res = await POST(req)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.error).toBe("STALE_RECONCILIATION")
    expect(data.result).toBeDefined()
    expect(data.proposal).toBeDefined()
  })

  it("returns 200 on success when proposal_hash matches re-run (hash-locked)", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "admin",
    })
    const resultBefore = { ...resultOk, delta: clientSeen.detected_delta, status: ReconciliationStatus.WARN }
    const resultAfter = { ...resultOk, status: ReconciliationStatus.OK }
    let callCount = 0
    const mockReconcile = jest.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve(callCount === 1 ? resultBefore : resultAfter)
    })
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })
    mockSupabase.rpc.mockResolvedValue({ data: "je-id-123", error: null })

    const req = jsonRequest(bodyWithHash({ resultBefore }))
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.before).toBeDefined()
    expect(data.after).toBeDefined()
    expect(data.after.status).toBe(ReconciliationStatus.OK)
    expect(data.journal_entry_id).toBe("je-id-123")
    expect(data.posted).toBe(true)
  })

  it("returns 403 awaiting_owner_approval when delta exceeds owner threshold and user is not owner", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "accountant",
    })
    mockGetLedgerAdjustmentPolicy.mockResolvedValue({
      adjustment_requires_accountant: true,
      adjustment_requires_owner_over_amount: 10,
      adjustment_requires_two_person_rule: false,
    })
    const resultBefore = { ...resultOk, delta: -50, status: ReconciliationStatus.FAIL }
    const resultAfter = { ...resultOk, delta: 0, status: ReconciliationStatus.OK }
    let callCount = 0
    const mockReconcile = jest.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve(callCount === 1 ? resultBefore : resultAfter)
    })
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })

    const req = jsonRequest(bodyWithHash({
      resultBefore,
      clientSeen: { detected_delta: -50, ledgerBalance: 50, expectedBalance: 100 },
    }))
    const res = await POST(req)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.awaiting_owner_approval).toBe(true)
  })

  it("allows owner to post when delta exceeds owner threshold", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "owner",
    })
    mockGetLedgerAdjustmentPolicy.mockResolvedValue({
      adjustment_requires_accountant: true,
      adjustment_requires_owner_over_amount: 10,
      adjustment_requires_two_person_rule: false,
    })
    const resultBefore = { ...resultOk, delta: -50, status: ReconciliationStatus.FAIL }
    const resultAfter = { ...resultOk, delta: 0, status: ReconciliationStatus.OK }
    let callCount = 0
    const mockReconcile = jest.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve(callCount === 1 ? resultBefore : resultAfter)
    })
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })
    mockSupabase.rpc.mockResolvedValue({ data: "je-id-456", error: null })

    const req = jsonRequest(bodyWithHash({
      resultBefore,
      clientSeen: { detected_delta: -50, ledgerBalance: 50, expectedBalance: 100 },
    }))
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.posted).toBe(true)
  })

  it("records approval only and returns posted: false when approve_only and two-person rule", async () => {
    mockRequireBusinessRole.mockResolvedValue({
      userId: "u1",
      businessId: resolveBodyValid.businessId,
      role: "accountant",
    })
    mockGetLedgerAdjustmentPolicy.mockResolvedValue({
      adjustment_requires_accountant: true,
      adjustment_requires_owner_over_amount: 0,
      adjustment_requires_two_person_rule: true,
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "ledger_adjustment_approvals") {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: [] }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === "accounts") {
        return chainResolve({ data: [{ id: "acc-1100", code: "1100" }, { id: "acc-4000", code: "4000" }] })
      }
      if (table === "reconciliation_resolutions") return { insert: jest.fn().mockResolvedValue({ error: null }) }
      return chainResolve({ data: null })
    })
    const resultBefore = { ...resultOk, delta: -5, status: ReconciliationStatus.FAIL }
    const mockReconcile = jest.fn().mockResolvedValue(resultBefore)
    mockCreateReconciliationEngine.mockReturnValue({ reconcileInvoice: mockReconcile })

    const req = jsonRequest(bodyWithHash({ resultBefore, approve_only: true }))
    const res = await POST(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.posted).toBe(false)
    expect(data.awaiting_second_approval).toBe(true)
  })
})
