/** @jest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import Sidebar from "@/components/Sidebar"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), prefetch: jest.fn() }),
  usePathname: jest.fn(() => "/service/invoices"),
  useSearchParams: jest.fn(() => new URLSearchParams("")),
}))

jest.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      signOut: jest.fn(),
      onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
    },
    from: jest.fn(),
  },
}))

jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
  getSelectedBusinessId: jest.fn(() => null),
  clearSelectedBusinessId: jest.fn(),
}))

jest.mock("@/lib/industryMode", () => ({
  getTabIndustryMode: jest.fn(() => "service"),
  clearTabIndustryMode: jest.fn(),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/accounting/accountantFirmUserSession", () => ({
  resolveIsAccountantFirmUser: jest.fn(),
  clearAccountantFirmUserSessionCache: jest.fn(),
}))

jest.mock("@/components/service/ServiceSubscriptionContext", () => ({
  useServiceSubscription: jest.fn(() => ({
    canAccessTier: () => true,
    entitlementResolved: true,
  })),
}))

jest.mock("@/components/sidebar/SidebarLayoutContext", () => ({
  useSidebarLayout: () => ({
    collapsed: false,
    toggleCollapsed: jest.fn(),
    enabled: true,
  }),
  SIDEBAR_MAIN_OFFSET_CLASS: "",
}))

jest.mock("@/components/BusinessLogoDisplay", () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock("@/components/sidebar/SidebarNavTooltip", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import { usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { resolveIsAccountantFirmUser } from "@/lib/accounting/accountantFirmUserSession"
import { WorkspaceBusinessProvider } from "@/components/WorkspaceBusinessContext"

function renderSidebarWithContext(
  root: Root,
  business: Record<string, unknown> | null
) {
  act(() => {
    root.render(
      <WorkspaceBusinessProvider
        value={{
          business: business as never,
          sessionUser: business
            ? { id: "user-1", email: "owner@example.com", user_metadata: {} }
            : null,
        }}
      >
        <Sidebar />
      </WorkspaceBusinessProvider>
    )
  })
}

describe("Sidebar shell deduplication", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    jest.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    jest.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    } as never)
    jest.mocked(resolveIsAccountantFirmUser).mockResolvedValue(false)
    jest.mocked(getUserRole).mockResolvedValue("owner")
    jest.mocked(supabase.from).mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        }),
      }),
    } as never)
  })

  afterEach(() => {
    root.unmount()
    container.remove()
  })

  async function flushEffects() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  it("skips getCurrentBusiness when workspace context provides the service business", async () => {
    renderSidebarWithContext(root, {
      id: "biz-ctx",
      owner_id: "user-1",
      industry: "service",
      trading_name: "Acme",
      logo_url: null,
    })

    await flushEffects()

    expect(getCurrentBusiness).not.toHaveBeenCalled()
  })

  it("does not query business_users custom_permissions for workspace owner", async () => {
    renderSidebarWithContext(root, {
      id: "biz-ctx",
      owner_id: "user-1",
      industry: "service",
    })

    await flushEffects()

    const businessUsersCalls = jest
      .mocked(supabase.from)
      .mock.calls.filter(([table]) => table === "business_users")
    expect(businessUsersCalls).toHaveLength(0)
    expect(getUserRole).not.toHaveBeenCalled()
  })

  it("calls getCurrentBusiness when workspace context is absent", async () => {
    jest.mocked(getCurrentBusiness).mockResolvedValue({
      id: "biz-fallback",
      industry: "service",
      owner_id: "user-1",
    } as never)

    renderSidebarWithContext(root, null)

    await flushEffects()

    expect(getCurrentBusiness).toHaveBeenCalled()
  })

  it("resolves accountant firm membership once across pathname changes", async () => {
    renderSidebarWithContext(root, {
      id: "biz-ctx",
      owner_id: "user-1",
      industry: "service",
    })

    await flushEffects()

    jest.mocked(usePathname).mockReturnValue("/service/payments")

    renderSidebarWithContext(root, {
      id: "biz-ctx",
      owner_id: "user-1",
      industry: "service",
    })

    await flushEffects()

    expect(resolveIsAccountantFirmUser).toHaveBeenCalledTimes(1)
  })
})
