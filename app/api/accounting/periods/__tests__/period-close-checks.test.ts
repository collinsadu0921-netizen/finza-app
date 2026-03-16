/**
 * Period close audit checks: run_period_close_checks enforcement.
 * Tests that close is blocked with explicit messages when checks fail,
 * and that close proceeds when checks pass. Logs each attempt to period_close_attempts.
 */

import { POST } from "../close/route"
import { NextRequest } from "next/server"

const businessId = "b1000000-0000-0000-0000-000000000001"
const periodStart = "2025-01-01"
const periodId = "p2000000-0000-0000-0000-000000000002"

const mockUser = { id: "u3000000-0000-0000-0000-000000000003" }

const mockSupabase = {
  auth: { getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
  rpc: jest.fn(),
  from: jest.fn(),
}

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(() => Promise.resolve(mockSupabase)),
}))
jest.mock("@/lib/accountingAuth", () => ({
  checkAccountingAuthority: jest.fn(() =>
    Promise.resolve({ authorized: true, businessId })
  ),
}))
jest.mock("@/lib/firmOnboarding", () => ({
  checkFirmOnboardingForAction: jest.fn(() =>
    Promise.resolve({ isComplete: true, firmId: null })
  ),
}))
jest.mock("@/lib/firmEngagements", () => ({
  getActiveEngagement: jest.fn(() => Promise.resolve(null)),
  isEngagementEffective: jest.fn(() => true),
}))
jest.mock("@/lib/firmAuthority", () => ({
  resolveAuthority: jest.fn(() => ({ allowed: true })),
}))
jest.mock("@/lib/firmActivityLog", () => ({
  logBlockedActionAttempt: jest.fn(() => Promise.resolve()),
}))

function jsonRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/accounting/periods/close", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

const periodCloseAttemptsInsert = jest.fn().mockResolvedValue({ error: null })

describe("Period close audit checks", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    periodCloseAttemptsInsert.mockResolvedValue({ error: null })
    mockSupabase.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === "can_accountant_access_business") return Promise.resolve({ data: "write", error: null })
      if (name === "is_user_accountant_write") return Promise.resolve({ data: true, error: null })
      if (name === "check_period_close_readiness")
        return Promise.resolve({
          data: { status: "READY", blockers: [], warnings: [], period_id: periodId },
          error: null,
        })
      return Promise.resolve({ data: null, error: null })
    })
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "accounting_periods") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              id: periodId,
              business_id: businessId,
              period_start: periodStart,
              period_end: "2025-01-31",
              status: "open",
              close_requested_at: null,
              close_requested_by: null,
            },
            error: null,
          }),
          update: jest.fn().mockReturnThis(),
        }
      }
      if (table === "period_close_attempts") {
        return { insert: periodCloseAttemptsInsert }
      }
      if (table === "accounting_period_actions") {
        return { insert: jest.fn().mockResolvedValue({ error: null }) }
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: null, error: null }) }
    })
  })

  it("blocks request_close with 400 and explicit failures when run_period_close_checks fails (TRIAL_BALANCE_UNBALANCED)", async () => {
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === "run_period_close_checks") {
        return Promise.resolve({
          data: {
            ok: false,
            failures: [
              {
                code: "TRIAL_BALANCE_UNBALANCED",
                title: "Trial balance is not balanced",
                detail: "Total debits (100) do not equal total credits (99). Trial balance must balance (zero tolerance) before period close.",
              },
            ],
          },
          error: null,
        })
      }
      if (name === "can_accountant_access_business") return Promise.resolve({ data: "write", error: null })
      if (name === "is_user_accountant_write") return Promise.resolve({ data: true, error: null })
      if (name === "check_period_close_readiness")
        return Promise.resolve({ data: { status: "READY", blockers: [], period_id: periodId }, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const res = await POST(jsonRequest({ business_id: businessId, period_start: periodStart, action: "request_close" }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/audit checks failed|Period cannot be closed/)
    expect(Array.isArray(data.failures)).toBe(true)
    expect(data.failures).toHaveLength(1)
    expect(data.failures[0].code).toBe("TRIAL_BALANCE_UNBALANCED")
    expect(data.failures[0].title).toMatch(/Trial balance/)
    expect(data.failures[0].detail).toBeDefined()

    expect(mockSupabase.from).toHaveBeenCalledWith("period_close_attempts")
    expect(periodCloseAttemptsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: businessId,
        period_id: periodId,
        checks_passed: false,
        failures: expect.arrayContaining([expect.objectContaining({ code: "TRIAL_BALANCE_UNBALANCED" })]),
      })
    )
  })

  it("blocks request_close with 400 when AR_RECONCILIATION_MISMATCH", async () => {
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === "run_period_close_checks") {
        return Promise.resolve({
          data: {
            ok: false,
            failures: [
              {
                code: "AR_RECONCILIATION_MISMATCH",
                title: "Period AR does not match operational expected",
                detail: "Ledger AR total (500) does not equal operational expected total (480). Resolve mismatches via reconciliation before close.",
              },
            ],
          },
          error: null,
        })
      }
      if (name === "can_accountant_access_business") return Promise.resolve({ data: "write", error: null })
      if (name === "is_user_accountant_write") return Promise.resolve({ data: true, error: null })
      if (name === "check_period_close_readiness")
        return Promise.resolve({ data: { status: "READY", blockers: [], period_id: periodId }, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const res = await POST(jsonRequest({ business_id: businessId, period_start: periodStart, action: "request_close" }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.failures[0].code).toBe("AR_RECONCILIATION_MISMATCH")
  })

  it("blocks request_close with 400 when UNRESOLVED_AR_MISMATCHES", async () => {
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === "run_period_close_checks") {
        return Promise.resolve({
          data: {
            ok: false,
            failures: [
              {
                code: "UNRESOLVED_AR_MISMATCHES",
                title: "2 invoice(s) with unresolved AR mismatch",
                detail: "2 invoice(s) have ledger vs operational mismatch and no posted reconciliation adjustment. Resolve or post adjustments before close.",
              },
            ],
          },
          error: null,
        })
      }
      if (name === "can_accountant_access_business") return Promise.resolve({ data: "write", error: null })
      if (name === "is_user_accountant_write") return Promise.resolve({ data: true, error: null })
      if (name === "check_period_close_readiness")
        return Promise.resolve({ data: { status: "READY", blockers: [], period_id: periodId }, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    const res = await POST(jsonRequest({ business_id: businessId, period_start: periodStart, action: "request_close" }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.failures[0].code).toBe("UNRESOLVED_AR_MISMATCHES")
  })

  it("allows request_close when run_period_close_checks returns ok and logs attempt", async () => {
    mockSupabase.rpc.mockImplementation((name: string) => {
      if (name === "run_period_close_checks") {
        return Promise.resolve({ data: { ok: true, failures: [] }, error: null })
      }
      if (name === "can_accountant_access_business") return Promise.resolve({ data: "write", error: null })
      if (name === "is_user_accountant_write") return Promise.resolve({ data: true, error: null })
      if (name === "check_period_close_readiness")
        return Promise.resolve({ data: { status: "READY", blockers: [], period_id: periodId }, error: null })
      return Promise.resolve({ data: null, error: null })
    })

    let accountingPeriodsCallCount = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "accounting_periods") {
        accountingPeriodsCallCount++
        if (accountingPeriodsCallCount === 1) {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                id: periodId,
                business_id: businessId,
                period_start: periodStart,
                period_end: "2025-01-31",
                status: "open",
                close_requested_at: null,
                close_requested_by: null,
              },
              error: null,
            }),
          }
        }
        return {
          update: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: {
              id: periodId,
              business_id: businessId,
              period_start: periodStart,
              status: "closing",
              close_requested_at: new Date().toISOString(),
              close_requested_by: mockUser.id,
            },
            error: null,
          }),
        }
      }
      if (table === "period_close_attempts") return { insert: periodCloseAttemptsInsert }
      if (table === "accounting_period_actions") return { insert: jest.fn().mockResolvedValue({ error: null }) }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockResolvedValue({ data: null, error: null }) }
    })

    const res = await POST(jsonRequest({ business_id: businessId, period_start: periodStart, action: "request_close" }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.period).toBeDefined()
    expect(data.period.status).toBe("closing")

    expect(periodCloseAttemptsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: businessId,
        period_id: periodId,
        checks_passed: true,
        failures: [],
      })
    )
  })
})
