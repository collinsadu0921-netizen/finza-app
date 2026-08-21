/**
 * Readiness must resolve authority once and reuse engagement facts.
 */

import { GET } from "@/app/api/accounting/readiness/route"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { resolveAccountingRequestAuthority } from "@/lib/accounting/resolveAccountingRequestAuthority"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"

jest.mock("@/lib/supabaseServer", () => ({
  createSupabaseServerClient: jest.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "partner-1" } }, error: null }) },
  })),
}))

jest.mock("@/lib/accounting/permissions", () => ({
  assertAccountingAccess: jest.fn(),
  accountingUserFromRequest: jest.fn(() => ({})),
}))

jest.mock("@/lib/accounting/resolveAccountingRequestAuthority", () => {
  const actual = jest.requireActual("@/lib/accounting/resolveAccountingRequestAuthority")
  return {
    ...actual,
    resolveAccountingRequestAuthority: jest.fn(),
    getAccountingDataClient: jest.fn((_auth, client) => client),
  }
})

jest.mock("@/lib/accounting/authorityEngine", () => ({
  getAccountingAuthority: jest.fn(),
}))

jest.mock("@/lib/accounting/readiness", () => ({
  checkAccountingReadiness: jest.fn(),
}))

const mockResolve = resolveAccountingRequestAuthority as jest.MockedFunction<
  typeof resolveAccountingRequestAuthority
>
const mockFirm = getAccountingAuthority as jest.MockedFunction<typeof getAccountingAuthority>
const mockReady = checkAccountingReadiness as jest.MockedFunction<typeof checkAccountingReadiness>

describe("readiness authority reuse", () => {
  it("does not perform a second engagement lookup when authority already returned Practice facts", async () => {
    mockResolve.mockResolvedValue({
      ok: true,
      userId: "partner-1",
      businessId: "biz-a",
      requiredLevel: "read",
      grantedLevel: "write",
      authoritySource: "practice",
      isPractice: true,
      firmId: "firm-a",
      engagementId: "eng-1",
      engagementStatus: "accepted",
      practiceRole: "partner",
      assignmentScoped: false,
      reason: "ACTIVE",
      serviceRole: null,
      timings: {
        role_ms: 10,
        authority_ms: 20,
        membership_ms: 8,
        engagement_ms: 12,
        assignment_ms: 0,
        total_ms: 30,
        strategy: "parallel",
      },
    })
    mockReady.mockResolvedValue({ ready: true })

    const res = await GET(
      new Request("http://localhost/api/accounting/readiness?business_id=biz-a") as never
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ready).toBe(true)
    expect(body.access_level).toBe("write")
    expect(body.engagement_status).toBe("accepted")
    expect(body.authority_source).toBe("accountant")
    expect(mockResolve).toHaveBeenCalledTimes(1)
    expect(mockFirm).not.toHaveBeenCalled()
  })
})
