import { resolvePracticeClientBooksContext } from "../resolvePracticeClientBooksContext"

jest.mock("@/lib/accounting/authorityEngine", () => ({
  getAccountingAuthority: jest.fn(),
}))
jest.mock("@/lib/serviceBusinessContext", () => ({
  resolveServiceBusinessContext: jest.fn(),
}))
jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { resolveServiceBusinessContext } from "@/lib/serviceBusinessContext"
import { getUserRole } from "@/lib/userRoles"

const mockAuthority = getAccountingAuthority as jest.MockedFunction<typeof getAccountingAuthority>
const mockServiceCtx = resolveServiceBusinessContext as jest.MockedFunction<
  typeof resolveServiceBusinessContext
>
const mockGetRole = getUserRole as jest.MockedFunction<typeof getUserRole>

function supabaseWithFirm(hasFirm: boolean, businessName = "ABC Ltd") {
  return {
    from: jest.fn((table: string) => {
      if (table === "accounting_firm_users") {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({
                  data: hasFirm ? { firm_id: "firm-1" } : null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === "businesses") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { name: businessName } }),
            }),
          }),
        }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
    }),
  } as never
}

describe("resolvePracticeClientBooksContext", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("allows an engaged firm user to open client books", async () => {
    mockAuthority.mockResolvedValue({
      allowed: true,
      level: "read",
      reason: "ACTIVE",
      firmId: "firm-1",
      engagementId: "eng-1",
      engagementStatus: "accepted",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      debug: {},
    })

    const ctx = await resolvePracticeClientBooksContext({
      supabase: supabaseWithFirm(true),
      userId: "firm-user",
      urlBusinessId: "biz-abc",
    })
    expect(ctx.kind).toBe("practice")
    if (ctx.kind === "practice") {
      expect(ctx.clientName).toBe("ABC Ltd")
      expect(ctx.accessLevel).toBe("read")
    }
  })

  it("denies a firm user with no engagement", async () => {
    mockAuthority.mockResolvedValue({
      allowed: false,
      level: null,
      reason: "NO_ENGAGEMENT",
      firmId: null,
      engagementId: null,
      engagementStatus: null,
      effectiveFrom: null,
      effectiveTo: null,
      debug: {},
    })

    const ctx = await resolvePracticeClientBooksContext({
      supabase: supabaseWithFirm(true),
      userId: "firm-user",
      urlBusinessId: "biz-xyz",
    })
    expect(ctx.kind).toBe("denied")
  })

  it("denies suspended and terminated engagements", async () => {
    for (const reason of ["ENGAGEMENT_SUSPENDED", "ENGAGEMENT_TERMINATED"]) {
      mockAuthority.mockResolvedValue({
        allowed: false,
        level: null,
        reason,
        firmId: "firm-1",
        engagementId: "eng-1",
        engagementStatus: reason === "ENGAGEMENT_SUSPENDED" ? "suspended" : "terminated",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        debug: {},
      })
      const ctx = await resolvePracticeClientBooksContext({
        supabase: supabaseWithFirm(true),
        userId: "firm-user",
        urlBusinessId: "biz-abc",
      })
      expect(ctx.kind).toBe("denied")
    }
  })

  it("keeps normal Service owners on their own business", async () => {
    mockServiceCtx.mockResolvedValue({ businessId: "owned-biz" })
    mockGetRole.mockResolvedValue("owner")

    const ctx = await resolvePracticeClientBooksContext({
      supabase: supabaseWithFirm(false),
      userId: "owner-1",
      urlBusinessId: "owned-biz",
    })
    expect(ctx.kind).toBe("service")
    if (ctx.kind === "service") expect(ctx.businessId).toBe("owned-biz")
  })

  it("denies a Service owner impersonating another business via URL", async () => {
    mockServiceCtx.mockResolvedValue({ businessId: "owned-biz" })
    mockGetRole.mockResolvedValue(null)

    const ctx = await resolvePracticeClientBooksContext({
      supabase: supabaseWithFirm(false),
      userId: "owner-1",
      urlBusinessId: "other-biz",
    })
    expect(ctx.kind).toBe("denied")
  })
})
