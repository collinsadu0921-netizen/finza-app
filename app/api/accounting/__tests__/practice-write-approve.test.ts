/**
 * Practice WRITE + APPROVE capability hierarchy at the operation boundary.
 */
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(),
}))
jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))
jest.mock("@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi", () => ({
  enforceServiceIndustryBusinessTierForAccountingApi: jest.fn(async () => null),
  enforceServiceIndustryBusinessTierForAccountingWrite: jest.fn(async () => null),
}))
jest.mock("@/lib/auditLog", () => ({
  logAudit: jest.fn(async () => undefined),
}))
jest.mock("@/lib/accounting/resolveAccountingRequestAuthority", () => {
  const actual = jest.requireActual("@/lib/accounting/resolveAccountingRequestAuthority")
  return {
    ...actual,
    resolveAccountingRequestAuthority: jest.fn(),
    getAccountingDataClient: jest.fn((auth: { isPractice: boolean }, userScoped: unknown) =>
      auth.isPractice ? { __client: "admin" } : userScoped
    ),
  }
})

import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import {
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import { POST as reversalPOST } from "@/app/api/accounting/reversal/route"
import { POST as applyAdjustment } from "@/app/api/accounting/adjustments/apply/route"

const mockResolve = resolveAccountingRequestAuthority as jest.MockedFunction<
  typeof resolveAccountingRequestAuthority
>
const mockGetDataClient = getAccountingDataClient as jest.MockedFunction<typeof getAccountingDataClient>
const mockCreateServer = createSupabaseServerClient as jest.MockedFunction<
  typeof createSupabaseServerClient
>
const mockCreateAdmin = createSupabaseAdminClient as jest.MockedFunction<typeof createSupabaseAdminClient>

const BIZ_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const BIZ_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
const JE_A = "11111111-1111-4111-8111-111111111111"
const USER = "user-1"

function practiceAuth(level: "read" | "write" | "approve") {
  return {
    ok: true as const,
    userId: USER,
    businessId: BIZ_A,
    requiredLevel: level,
    grantedLevel: level,
    authoritySource: "practice" as const,
    isPractice: true,
    firmId: "firm-1",
    engagementId: "eng-1",
    practiceRole: "partner",
    assignmentScoped: false,
    reason: null,
    serviceRole: null,
  }
}

function serviceOwner() {
  return {
    ok: true as const,
    userId: USER,
    businessId: BIZ_A,
    requiredLevel: "approve" as const,
    grantedLevel: "owner" as const,
    authoritySource: "owner" as const,
    isPractice: false,
    firmId: null,
    engagementId: null,
    practiceRole: null,
    assignmentScoped: false,
    reason: null,
    serviceRole: "owner",
  }
}

function denied(code: string, status: 403 | 404 = 403) {
  return {
    ok: false as const,
    status,
    error: "Forbidden",
    reasonCode: code,
    businessId: BIZ_A,
  }
}

type QueryResult = { data: unknown; error: unknown }

function chainable(result: QueryResult) {
  const q: Record<string, unknown> = {}
  const self = () => q
  for (const m of ["select", "eq", "neq", "in", "gte", "lte", "is", "order", "limit", "update"]) {
    q[m] = jest.fn(self)
  }
  q.maybeSingle = jest.fn(async () => ({ data: result.data, error: result.error }))
  q.single = jest.fn(async () => ({ data: result.data, error: result.error }))
  Object.assign(q, {
    then(resolve: (v: QueryResult) => void) {
      resolve(result)
    },
  })
  return q
}

function reversalClient(opts?: { alreadyReversed?: boolean; businessId?: string }) {
  const journal = {
    id: JE_A,
    business_id: opts?.businessId ?? BIZ_A,
    date: "2026-08-20",
    description: "Loan",
    period_id: "p1",
    reference_type: "manual",
    reference_id: null,
  }
  return {
    from: jest.fn((table: string) => {
      if (table === "journal_entries") {
        const q = chainable({
          data: opts?.alreadyReversed ? { id: "rev-existing" } : journal,
          error: null,
        })
        // first journal lookup vs existing reversal distinguished by later eq on reference_type
        let seenRefType = false
        const origEq = q.eq as jest.Mock
        q.eq = jest.fn((col: string, val: unknown) => {
          if (col === "reference_type") seenRefType = true
          origEq(col, val)
          if (seenRefType) {
            return chainable({
              data: opts?.alreadyReversed ? { id: "rev-existing" } : null,
              error: null,
            })
          }
          return q
        })
        return q
      }
      if (table === "accounting_periods") {
        return chainable({ data: { id: "p1", status: "open" }, error: null })
      }
      if (table === "journal_entry_lines") {
        return chainable({
          data: [
            { id: "l1", account_id: "a1", debit: 100, credit: 0, description: "Dr" },
            { id: "l2", account_id: "a2", debit: 0, credit: 100, description: "Cr" },
          ],
          error: null,
        })
      }
      return chainable({ data: null, error: null })
    }),
    rpc: jest.fn(async () => ({ data: "new-rev-je", error: null })),
  }
}

function adjustmentClient() {
  return {
    from: jest.fn((table: string) => {
      if (table === "businesses") return chainable({ data: { id: BIZ_A }, error: null })
      if (table === "accounting_periods") return chainable({ data: { id: "p1" }, error: null })
      return chainable({ data: null, error: null })
    }),
    rpc: jest.fn(async () => ({ data: "adj-je-1", error: null })),
  }
}

describe("Practice capability hierarchy", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateServer.mockResolvedValue({
      auth: { getUser: jest.fn(async () => ({ data: { user: { id: USER } } })) },
      from: jest.fn(() => chainable({ data: null, error: null })),
    } as never)
    mockGetDataClient.mockImplementation((auth, userScoped) =>
      auth.isPractice ? (mockCreateAdmin() as never) : (userScoped as never)
    )
  })

  describe("reversal requires APPROVE", () => {
    it("READ reverse denied", async () => {
      mockResolve.mockResolvedValue(denied("INSUFFICIENT_ACCESS_LEVEL"))
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "UAT reverse denial reason",
          }),
        })
      )
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.reason_code).toBe("INSUFFICIENT_ACCESS_LEVEL")
      expect(body.error).toMatch(/Approve access is required/)
    })

    it("WRITE reverse denied", async () => {
      mockResolve.mockResolvedValue(denied("INSUFFICIENT_ACCESS_LEVEL"))
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "WRITE must not reverse journals",
          }),
        })
      )
      expect(res.status).toBe(403)
      expect((await res.json()).reason_code).toBe("INSUFFICIENT_ACCESS_LEVEL")
    })

    it("APPROVE reverse allowed", async () => {
      mockResolve.mockResolvedValue(practiceAuth("approve"))
      const admin = reversalClient()
      mockCreateAdmin.mockReturnValue(admin as never)
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Partner approved reversal",
            reversal_date: "2026-08-20",
          }),
        })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.reversal_journal_entry_id).toBe("new-rev-je")
      expect(mockResolve).toHaveBeenCalledWith(
        expect.objectContaining({ requiredLevel: "approve", businessId: BIZ_A })
      )
    })

    it("Service owner reverse still allowed", async () => {
      mockResolve.mockResolvedValue(serviceOwner())
      const userClient = reversalClient()
      mockCreateServer.mockResolvedValue({
        auth: { getUser: jest.fn(async () => ({ data: { user: { id: USER } } })) },
        ...userClient,
      } as never)
      mockGetDataClient.mockReturnValue(userClient as never)
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Owner reversing a posted journal",
            reversal_date: "2026-08-20",
          }),
        })
      )
      expect(res.status).toBe(200)
    })

    it("forged business_id denied", async () => {
      mockResolve.mockResolvedValue({
        ok: false,
        status: 403,
        error: "Forbidden",
        reasonCode: "INSUFFICIENT_AUTHORITY",
        businessId: BIZ_B,
      })
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_B,
            reason: "Trying another client journal",
          }),
        })
      )
      expect(res.status).toBe(403)
    })

    it("Client A cannot reverse Client B journal", async () => {
      mockResolve.mockResolvedValue(practiceAuth("approve"))
      const admin = reversalClient({ businessId: BIZ_A })
      admin.from = jest.fn((table: string) => {
        if (table === "journal_entries") {
          return chainable({ data: null, error: null })
        }
        return chainable({ data: null, error: null })
      })
      mockCreateAdmin.mockReturnValue(admin as never)
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            business_id: BIZ_A,
            reason: "Cross-client journal probe",
          }),
        })
      )
      expect(res.status).toBe(404)
      expect((await res.json()).reason_code).toBe("JOURNAL_NOT_FOUND")
    })

    it("pending engagement denied", async () => {
      mockResolve.mockResolvedValue(denied("ENGAGEMENT_PENDING"))
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Pending must not reverse",
          }),
        })
      )
      expect(res.status).toBe(403)
      expect((await res.json()).reason_code).toBe("ENGAGEMENT_PENDING")
    })

    it("suspended engagement denied", async () => {
      mockResolve.mockResolvedValue(denied("ENGAGEMENT_SUSPENDED"))
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Suspended must not reverse",
          }),
        })
      )
      expect((await res.json()).reason_code).toBe("ENGAGEMENT_SUSPENDED")
    })

    it("terminated engagement denied", async () => {
      mockResolve.mockResolvedValue(denied("ENGAGEMENT_TERMINATED"))
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Terminated must not reverse",
          }),
        })
      )
      expect((await res.json()).reason_code).toBe("ENGAGEMENT_TERMINATED")
    })

    it("unassigned staff denied", async () => {
      mockResolve.mockResolvedValue(denied("CLIENT_NOT_ASSIGNED"))
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Unassigned staff reverse",
          }),
        })
      )
      expect((await res.json()).reason_code).toBe("CLIENT_NOT_ASSIGNED")
    })

    it("ineffective dates denied", async () => {
      mockResolve.mockResolvedValue(denied("ENGAGEMENT_NOT_EFFECTIVE"))
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Not yet effective reverse",
          }),
        })
      )
      expect((await res.json()).reason_code).toBe("ENGAGEMENT_NOT_EFFECTIVE")
    })

    it("duplicate reversal rejected", async () => {
      mockResolve.mockResolvedValue(practiceAuth("approve"))
      mockCreateAdmin.mockReturnValue(reversalClient({ alreadyReversed: true }) as never)
      const res = await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            reason: "Already reversed once before",
            reversal_date: "2026-08-20",
          }),
        })
      )
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.already_reversed).toBe(true)
    })

    it("forged access_level in body is ignored", async () => {
      mockResolve.mockResolvedValue(denied("INSUFFICIENT_ACCESS_LEVEL"))
      await reversalPOST(
        new NextRequest("http://localhost/api/accounting/reversal", {
          method: "POST",
          body: JSON.stringify({
            original_je_id: JE_A,
            business_id: BIZ_A,
            access_level: "approve",
            firm_id: "forged-firm",
            reason: "Forged access level in body",
          }),
        })
      )
      expect(mockResolve).toHaveBeenCalledWith(
        expect.objectContaining({ requiredLevel: "approve", businessId: BIZ_A })
      )
    })
  })

  describe("adjusting journal requires WRITE", () => {
    const payload = {
      business_id: BIZ_A,
      period_start: "2026-08-01",
      entry_date: "2026-08-20",
      description: "Accrue expense",
      adjustment_reason: "Month-end accrual",
      lines: [
        { account_id: "exp-1", debit: 100, credit: 0 },
        { account_id: "liab-1", debit: 0, credit: 100 },
      ],
    }

    it("READ create denied", async () => {
      mockResolve.mockResolvedValue(denied("INSUFFICIENT_ACCESS_LEVEL"))
      const res = await applyAdjustment(
        new NextRequest("http://localhost/api/accounting/adjustments/apply", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      )
      expect(res.status).toBe(403)
      expect((await res.json()).reason_code).toBe("INSUFFICIENT_ACCESS_LEVEL")
    })

    it("WRITE create allowed", async () => {
      mockResolve.mockResolvedValue(practiceAuth("write"))
      mockCreateAdmin.mockReturnValue(adjustmentClient() as never)
      const res = await applyAdjustment(
        new NextRequest("http://localhost/api/accounting/adjustments/apply", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      )
      expect(res.status).toBe(200)
      expect((await res.json()).journal_entry_id).toBe("adj-je-1")
      expect(mockResolve).toHaveBeenCalledWith(
        expect.objectContaining({ requiredLevel: "write", businessId: BIZ_A })
      )
    })

    it("APPROVE create allowed", async () => {
      mockResolve.mockResolvedValue(practiceAuth("approve"))
      mockCreateAdmin.mockReturnValue(adjustmentClient() as never)
      const res = await applyAdjustment(
        new NextRequest("http://localhost/api/accounting/adjustments/apply", {
          method: "POST",
          body: JSON.stringify(payload),
        })
      )
      expect(res.status).toBe(200)
    })

    it("unbalanced journal rejected", async () => {
      mockResolve.mockResolvedValue(practiceAuth("write"))
      mockCreateAdmin.mockReturnValue({
        ...adjustmentClient(),
        rpc: jest.fn(async () => ({ data: null, error: { message: "Journal entry must balance" } })),
      } as never)
      const res = await applyAdjustment(
        new NextRequest("http://localhost/api/accounting/adjustments/apply", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            lines: [
              { account_id: "exp-1", debit: 100, credit: 0 },
              { account_id: "liab-1", debit: 0, credit: 50 },
            ],
          }),
        })
      )
      expect(res.status).toBe(400)
    })

    it("wrong client denied", async () => {
      mockResolve.mockResolvedValue({
        ok: false,
        status: 403,
        error: "Forbidden",
        reasonCode: "INSUFFICIENT_AUTHORITY",
        businessId: BIZ_B,
      })
      const res = await applyAdjustment(
        new NextRequest("http://localhost/api/accounting/adjustments/apply", {
          method: "POST",
          body: JSON.stringify({ ...payload, business_id: BIZ_B }),
        })
      )
      expect(res.status).toBe(403)
    })
  })
})
