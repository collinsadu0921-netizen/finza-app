/**
 * Unit tests for resolveAccess() and Service/Accounting workspace boundary.
 * - Service users must use /service/* for reports, ledger, health (blocked from /accounting/*).
 * - Accountant (firm user) access to /accounting/* unchanged.
 */

import {
  resolveAccess,
  getWorkspaceFromPath,
} from "../accessControl"
import { getCurrentBusiness } from "../business"

jest.mock("../business")
jest.mock("../userRoles", () => ({
  getUserRole: jest.fn().mockResolvedValue("owner"),
  isUserAccountantReadonly: jest.fn().mockReturnValue(false),
}))
jest.mock("../storeSession", () => ({
  getActiveStoreId: jest.fn().mockReturnValue(null),
}))
jest.mock("../cashierSession", () => ({
  isCashierAuthenticated: jest.fn().mockReturnValue(false),
}))

const mockGetCurrentBusiness = getCurrentBusiness as jest.MockedFunction<typeof getCurrentBusiness>

function createMockSupabase(overrides: {
  firmUsersData?: Array<{ firm_id: string }>
  authUser?: { user_metadata?: Record<string, unknown> } | null
} = {}) {
  const { firmUsersData = [], authUser = { user_metadata: {} } } = overrides
  const from = jest.fn().mockImplementation((table: string) => {
    if (table === "accounting_firm_users") {
      return {
        select: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ data: firmUsersData }),
          }),
        }),
      }
    }
    return { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }
  })
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: authUser } }),
    },
    from,
  } as any
}

describe("accessControl", () => {
  describe("getWorkspaceFromPath", () => {
    it("returns accounting for /accounting/* paths", () => {
      expect(getWorkspaceFromPath("/accounting/ledger")).toBe("accounting")
      expect(getWorkspaceFromPath("/accounting/adjustments")).toBe("accounting")
      expect(getWorkspaceFromPath("/accounting/reports/profit-and-loss")).toBe("accounting")
    })

    it("returns service for /dashboard and /service/* routes", () => {
      expect(getWorkspaceFromPath("/dashboard")).toBe("service")
      expect(getWorkspaceFromPath("/service/reports/profit-and-loss")).toBe("service")
      expect(getWorkspaceFromPath("/service/ledger")).toBe("service")
    })

    it("returns retail for /retail/*", () => {
      expect(getWorkspaceFromPath("/retail/dashboard")).toBe("retail")
    })
  })

  describe("resolveAccess – Service workspace blocked from accounting", () => {
    it("denies service user on all /accounting/* (use /service/* instead)", async () => {
      const supabase = createMockSupabase({ firmUsersData: [] })
      mockGetCurrentBusiness.mockResolvedValue({ id: "b1", industry: "service" } as any)

      for (const path of [
        "/accounting/reports",
        "/accounting/reports/profit-and-loss",
        "/accounting/ledger",
        "/accounting/reconciliation",
      ]) {
        const res = await resolveAccess(supabase, "user-1", path)
        expect(res.allowed).toBe(false)
        expect(res.redirectTo).toBe("/dashboard")
      }
    })

    it("denies service user on /accounting/journals/*", async () => {
      const supabase = createMockSupabase({ firmUsersData: [] })
      mockGetCurrentBusiness.mockResolvedValue({ id: "b1", industry: "service" } as any)

      const res = await resolveAccess(supabase, "user-1", "/accounting/journals")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/dashboard")
    })

    it("denies service user on /accounting/adjustments/*", async () => {
      const supabase = createMockSupabase({ firmUsersData: [] })
      mockGetCurrentBusiness.mockResolvedValue({ id: "b1", industry: "service" } as any)

      const res = await resolveAccess(supabase, "user-1", "/accounting/adjustments")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/dashboard")
    })

    it("denies service user on /accounting/periods/*, /accounting/forensic/*, /accounting/tenants/*", async () => {
      const supabase = createMockSupabase({ firmUsersData: [] })
      mockGetCurrentBusiness.mockResolvedValue({ id: "b1", industry: "service" } as any)

      for (const path of [
        "/accounting/periods",
        "/accounting/forensic",
        "/accounting/tenants",
      ]) {
        const res = await resolveAccess(supabase, "user-1", path)
        expect(res.allowed).toBe(false)
        expect(res.redirectTo).toBe("/dashboard")
      }
    })
  })

  describe("resolveAccess – Accountant workspace unaffected", () => {
    it("allows firm user on any accounting path (no business)", async () => {
      const supabase = createMockSupabase({ firmUsersData: [{ firm_id: "firm-1" }] })
      mockGetCurrentBusiness.mockResolvedValue(null)

      const allowed = await resolveAccess(supabase, "user-1", "/accounting/adjustments")
      expect(allowed.allowed).toBe(true)

      const journals = await resolveAccess(supabase, "user-1", "/accounting/journals")
      expect(journals.allowed).toBe(true)
    })
  })
})
