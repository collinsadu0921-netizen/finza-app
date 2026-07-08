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

import { getUserRole } from "@/lib/userRoles"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { checkAccountingAuthority } from "@/lib/accounting/auth"

const mockGetUserRole = getUserRole as jest.MockedFunction<typeof getUserRole>
const mockResolveScope = resolveBusinessScopeForUser as jest.MockedFunction<
  typeof resolveBusinessScopeForUser
>
const mockCheckAuthority = checkAccountingAuthority as jest.MockedFunction<
  typeof checkAccountingAuthority
>

const supabase = {} as SupabaseClient

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
    expect(mockGetUserRole).toHaveBeenCalledTimes(1)
    expect(mockResolveScope).toHaveBeenCalledTimes(1)
    expect(mockCheckAuthority).toHaveBeenCalledTimes(1)
  })

  it("does not cache scope failures", async () => {
    mockResolveScope.mockResolvedValue({ ok: false, status: 403, error: "Forbidden" })

    await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")
    await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")

    expect(mockGetUserRole).toHaveBeenCalledTimes(2)
    expect(mockResolveScope).toHaveBeenCalledTimes(2)
  })

  it("does not cache authority denials", async () => {
    mockCheckAuthority.mockResolvedValue({
      authorized: false,
      businessId: "biz-a",
    })

    await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")
    await resolvePnlReportScopeAndAuthority(supabase, "user-1", "biz-a")

    expect(mockCheckAuthority).toHaveBeenCalledTimes(2)
  })
})
