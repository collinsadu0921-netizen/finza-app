/**
 * Unit tests for resolveAccess() and Service/Accounting workspace boundary.
 * - Service users must use /service/* for reports, ledger, health (blocked from /accounting/*).
 * - Accountant (firm user) access to /accounting/* unchanged.
 */

import {
  resolveAccess,
  getWorkspaceFromPath,
  isPosSurfacePath,
  isPinCashierRetailAllowedPath,
} from "../accessControl"
import { activateRetailPosPinUrlIsolation } from "../retail/posPinUrlIsolation"
import { getCurrentBusiness } from "../business"
import { isCashierAuthenticated } from "../cashierSession"
import { getUserRole } from "../userRoles"

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
const mockIsCashierAuthenticated = isCashierAuthenticated as jest.MockedFunction<typeof isCashierAuthenticated>
const mockGetUserRole = getUserRole as jest.MockedFunction<typeof getUserRole>

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
  describe("isPosSurfacePath", () => {
    it("matches /retail/pos, /retail/pos/*, /pos, /pos/* only", () => {
      expect(isPosSurfacePath("/retail/pos")).toBe(true)
      expect(isPosSurfacePath("/retail/pos/pin")).toBe(true)
      expect(isPosSurfacePath("/retail/pos/foo")).toBe(true)
      expect(isPosSurfacePath("/pos")).toBe(true)
      expect(isPosSurfacePath("/pos/pin")).toBe(true)
      expect(isPosSurfacePath("/retail/dashboard")).toBe(false)
      expect(isPosSurfacePath("/retail/sales/open-session")).toBe(false)
      expect(isPosSurfacePath("/inventory")).toBe(false)
    })
  })

  describe("isPinCashierRetailAllowedPath", () => {
    it("allows POS shell and POS-adjacent retail sales routes", () => {
      expect(isPinCashierRetailAllowedPath("/retail/pos")).toBe(true)
      expect(isPinCashierRetailAllowedPath("/retail/pos/pin")).toBe(true)
      expect(isPinCashierRetailAllowedPath("/retail/sales/open-session")).toBe(true)
      expect(isPinCashierRetailAllowedPath("/retail/sales/close-session")).toBe(true)
      expect(isPinCashierRetailAllowedPath("/retail/sales/offline/abc")).toBe(true)
      expect(isPinCashierRetailAllowedPath("/retail/sales/sale-id/receipt")).toBe(true)
      expect(isPinCashierRetailAllowedPath("/retail/dashboard")).toBe(false)
      expect(isPinCashierRetailAllowedPath("/retail/products")).toBe(false)
    })
  })

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
        expect(res.redirectTo).toBe("/service/dashboard")
      }
    })

    it("denies service user on /accounting/journals/*", async () => {
      const supabase = createMockSupabase({ firmUsersData: [] })
      mockGetCurrentBusiness.mockResolvedValue({ id: "b1", industry: "service" } as any)

      const res = await resolveAccess(supabase, "user-1", "/accounting/journals")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/service/dashboard")
    })

    it("denies service user on /accounting/adjustments/*", async () => {
      const supabase = createMockSupabase({ firmUsersData: [] })
      mockGetCurrentBusiness.mockResolvedValue({ id: "b1", industry: "service" } as any)

      const res = await resolveAccess(supabase, "user-1", "/accounting/adjustments")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/service/dashboard")
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
        expect(res.redirectTo).toBe("/service/dashboard")
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

  describe("resolveAccess – POS surface (PIN + cashier role)", () => {
    beforeEach(() => {
      mockIsCashierAuthenticated.mockReturnValue(false)
      mockGetUserRole.mockResolvedValue("owner" as any)
    })

    it("allows no-user + PIN on /retail/pos", async () => {
      mockIsCashierAuthenticated.mockReturnValue(true)
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, null, "/retail/pos")
      expect(res.allowed).toBe(true)
    })

    it("denies no-user + no PIN on /retail/pos with redirect to retail PIN", async () => {
      mockIsCashierAuthenticated.mockReturnValue(false)
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, null, "/retail/pos")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/retail/pos/pin")
    })

    it("denies no-user + PIN on non-POS retail routes (redirect to retail PIN)", async () => {
      mockIsCashierAuthenticated.mockReturnValue(true)
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, null, "/retail/dashboard")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/retail/pos/pin")
    })

    it("allows no-user + PIN on /retail/sales/open-session", async () => {
      mockIsCashierAuthenticated.mockReturnValue(true)
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, null, "/retail/sales/open-session")
      expect(res.allowed).toBe(true)
    })

    it("denies owner + PIN session on /retail/dashboard (redirect to POS)", async () => {
      mockIsCashierAuthenticated.mockReturnValue(true)
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, "owner-user", "/retail/dashboard")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/retail/pos")
    })

    it("allows cashier role on /retail/pos", async () => {
      mockGetUserRole.mockResolvedValue("cashier" as any)
      const supabase = createMockSupabase()
      mockGetCurrentBusiness.mockResolvedValue({ id: "b-retail", industry: "retail" } as any)
      const res = await resolveAccess(supabase, "cashier-user", "/retail/pos")
      expect(res.allowed).toBe(true)
    })

    it("allows cashier role on /retail/admin/staff", async () => {
      mockGetUserRole.mockResolvedValue("cashier" as any)
      const supabase = createMockSupabase()
      mockGetCurrentBusiness.mockResolvedValue({ id: "b-retail", industry: "retail" } as any)
      const res = await resolveAccess(supabase, "cashier-user", "/retail/admin/staff")
      expect(res.allowed).toBe(true)
    })

    it("denies cashier role on non-POS retail routes (e.g. dashboard)", async () => {
      mockGetUserRole.mockResolvedValue("cashier" as any)
      const supabase = createMockSupabase()
      mockGetCurrentBusiness.mockResolvedValue({ id: "b-retail", industry: "retail" } as any)
      const res = await resolveAccess(supabase, "cashier-user", "/retail/dashboard")
      expect(res.allowed).toBe(false)
      expect(res.redirectTo).toBe("/retail/pos")
    })

    it("allows signed-in user with PIN session on /retail/admin/staff", async () => {
      mockIsCashierAuthenticated.mockReturnValue(true)
      mockGetUserRole.mockResolvedValue("owner" as any)
      const supabase = createMockSupabase()
      mockGetCurrentBusiness.mockResolvedValue({ id: "b-retail", industry: "retail" } as any)
      const res = await resolveAccess(supabase, "owner-user", "/retail/admin/staff")
      expect(res.allowed).toBe(true)
    })
  })

  describe("resolveAccess – retail PIN URL isolation (signed-in owner)", () => {
    const sessionMem: Record<string, string> = {}
    const mockSessionStorage = {
      getItem: (k: string) => sessionMem[k] ?? null,
      setItem: (k: string, v: string) => {
        sessionMem[k] = String(v)
      },
      removeItem: (k: string) => {
        delete sessionMem[k]
      },
      clear: () => {
        Object.keys(sessionMem).forEach((key) => delete sessionMem[key])
      },
      key: () => "",
      get length() {
        return Object.keys(sessionMem).length
      },
    } as Storage

    beforeAll(() => {
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true,
        value: mockSessionStorage,
      })
    })

    afterAll(() => {
      Reflect.deleteProperty(globalThis, "sessionStorage")
    })

    beforeEach(() => {
      mockSessionStorage.clear()
      mockIsCashierAuthenticated.mockReturnValue(false)
      mockGetUserRole.mockResolvedValue("owner" as any)
      mockGetCurrentBusiness.mockResolvedValue({ id: "b-retail", industry: "retail" } as any)
    })

    it("allows owner to /retail/admin when PIN URL lock is not active", async () => {
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, "owner-1", "/retail/admin/registers")
      expect(res.allowed).toBe(true)
    })

    it("allows owner to /retail/admin when PIN URL lock is active (back-office bypasses kiosk lock)", async () => {
      activateRetailPosPinUrlIsolation()
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, "owner-1", "/retail/admin/registers")
      expect(res.allowed).toBe(true)
    })

    it("allows owner to /retail/settings and /retail/reports when PIN URL lock is active", async () => {
      activateRetailPosPinUrlIsolation()
      const supabase = createMockSupabase()
      const settings = await resolveAccess(supabase, "owner-1", "/retail/settings/receipt")
      const reports = await resolveAccess(supabase, "owner-1", "/retail/reports/sales")
      expect(settings.allowed).toBe(true)
      expect(reports.allowed).toBe(true)
    })

    it("allows owner to /retail/admin/staff when PIN URL lock is active", async () => {
      activateRetailPosPinUrlIsolation()
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, "owner-1", "/retail/admin/staff")
      expect(res.allowed).toBe(true)
    })

    it("allows owner to /retail/pos/pin when PIN URL lock is active", async () => {
      activateRetailPosPinUrlIsolation()
      const supabase = createMockSupabase()
      const res = await resolveAccess(supabase, "owner-1", "/retail/pos/pin")
      expect(res.allowed).toBe(true)
    })
  })
})
