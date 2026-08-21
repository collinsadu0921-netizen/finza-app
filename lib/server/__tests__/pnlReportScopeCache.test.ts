import type { SupabaseClient } from "@supabase/supabase-js"

import {
  resetPnlScopeCacheForTests,
  resolvePnlReportScopeAndAuthority,
} from "@/lib/server/pnlReportScopeCache"

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/business", () => ({
  resolveBusinessScopeForUser: jest.fn(),
}))

jest.mock("@/lib/accounting/auth", () => ({
  checkAccountingAuthority: jest.fn(),
}))

jest.mock("@/lib/accounting/resolveAccountingRequestAuthority", () => ({
  resolveAccountingRequestAuthority: jest.fn(),
}))

import { getUserRole } from "@/lib/userRoles"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { resolveAccountingRequestAuthority } from "@/lib/accounting/resolveAccountingRequestAuthority"

const mockGetUserRole = getUserRole as jest.MockedFunction<typeof getUserRole>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockCheckAuthority = checkAccountingAuthority as jest.MockedFunction<
  typeof checkAccountingAuthority
>
const mockResolveAuthority = resolveAccountingRequestAuthority as jest.MockedFunction<
  typeof resolveAccountingRequestAuthority
>

const supabase = {} as SupabaseClient

function practiceOk() {
  return {
    ok: true as const,
    userId: "firm-user",
    businessId: "biz-a",
    requiredLevel: "read" as const,
    grantedLevel: "read" as const,
    authoritySource: "practice" as const,
    isPractice: true,
    firmId: "firm-1",
    engagementId: "eng-1",
    engagementStatus: "accepted",
    practiceRole: "partner",
    assignmentScoped: false,
    reason: "ACTIVE",
    serviceRole: null,
    timings: {
      role_ms: 1,
      authority_ms: 1,
      membership_ms: 1,
      engagement_ms: 1,
      assignment_ms: 0,
      total_ms: 2,
      strategy: "parallel" as const,
    },
  }
}

function ownerOk() {
  return {
    ...practiceOk(),
    userId: "user-1",
    grantedLevel: "owner" as const,
    authoritySource: "owner" as const,
    isPractice: false,
    firmId: null,
    engagementId: null,
    engagementStatus: null,
    practiceRole: null,
    serviceRole: "owner",
    timings: { ...practiceOk().timings, strategy: "parallel" as const },
  }
}

describe("pnlReportScopeCache", () => {
  const prevTtl = process.env.FINZA_PNL_REPORT_SCOPE_CACHE_TTL_SEC

  beforeEach(() => {
    resetPnlScopeCacheForTests()
    jest.clearAllMocks()
    process.env.FINZA_PNL_REPORT_SCOPE_CACHE_TTL_SEC = "45"
    mockGetUserRole.mockResolvedValue("owner")
    mockResolveScope.mockResolvedValue({ ok: true, businessId: "biz-a" })
    mockCheckAuthority.mockResolvedValue({
      authorized: true,
      businessId: "biz-a",
      authority_source: "owner",
    })
    mockResolveAuthority.mockResolvedValue(ownerOk())
  })

  afterEach(() => {
    if (prevTtl === undefined) {
      delete process.env.FINZA_PNL_REPORT_SCOPE_CACHE_TTL_SEC
    } else {
      process.env.FINZA_PNL_REPORT_SCOPE_CACHE_TTL_SEC = prevTtl
    }
  })

  it("caches positive scope and authority on second explicit business_id request", async () => {
    const first = await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")
    const second = await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")

    expect(first.ok).toBe(true)
    expect(first.ok && first.pnlScopeCacheStatus).toBe("miss")
    expect(second.ok).toBe(true)
    expect(second.ok && second.pnlScopeCacheStatus).toBe("hit")
    expect(mockResolveAuthority).toHaveBeenCalledTimes(1)
    expect(mockResolveScope).toHaveBeenCalledTimes(0)
    expect(mockCheckAuthority).toHaveBeenCalledTimes(0)
  })

  it("allows Practice firm user with no Service role when authority grants", async () => {
    mockResolveAuthority.mockResolvedValue(practiceOk())

    const result = await resolvePnlReportScopeAndAuthority(supabase, "firm-user", "biz-a")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.role).toBe("accountant")
      expect(result.value.authority.authority_source).toBe("accountant")
      expect(result.value.isPractice).toBe(true)
    }
    expect(mockResolveScope).not.toHaveBeenCalled()
  })

  it("does not cache authority denials", async () => {
    mockResolveAuthority.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
      reasonCode: "INSUFFICIENT_AUTHORITY",
      businessId: "biz-a",
    })

    await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")
    await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")

    expect(mockResolveAuthority).toHaveBeenCalledTimes(2)
  })

  it("still uses resolveBusinessScopeForUser for implicit business", async () => {
    await resolvePnlReportScopeAndAuthority(supabase, "user-1", null)
    expect(mockResolveScope).toHaveBeenCalled()
  })
})
