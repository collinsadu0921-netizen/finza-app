/** @jest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import ProtectedLayout from "@/components/ProtectedLayout"

const mockReplace = jest.fn()
let mockPathname = "/service/invoices"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockPathname,
}))

jest.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
  },
}))

jest.mock("@/lib/accessControl", () => ({
  resolveAccess: jest.fn(),
  isPosSurfacePath: jest.fn(() => false),
}))

jest.mock("@/lib/autoBindStore", () => ({
  autoBindSingleStore: jest.fn(),
}))

jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))

jest.mock("@/lib/userRoles", () => ({
  getUserRole: jest.fn(),
}))

jest.mock("@/lib/cashierSession", () => ({
  isCashierAuthenticated: jest.fn(() => false),
}))

jest.mock("@/lib/hooks/useExportMode", () => ({
  useExportMode: jest.fn(() => false),
}))

jest.mock("@/components/service/ServiceSubscriptionContext", () => ({
  ServiceSubscriptionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock("@/components/service/ServiceWorkspaceSubscriptionBanners", () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock("@/components/StoreSwitcher", () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock("@/components/Sidebar", () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock("@/components/sidebar/SidebarLayoutContext", () => ({
  SidebarLayoutProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SIDEBAR_MAIN_OFFSET_CLASS: "",
}))

jest.mock("@/components/RetailPosIdleSessionWatcher", () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock("@/components/AppIdleTimeoutWatcher", () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock("@/components/AiAssistant", () => ({
  __esModule: true,
  default: () => null,
}))

jest.mock("@/components/platform/PlatformAnnouncementsHost", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock("@/components/ProtectedLayout-assistantSnapshot", () => ({
  fetchAssistantBusinessSnapshot: jest.fn(),
}))

import { supabase } from "@/lib/supabaseClient"
import { resolveAccess } from "@/lib/accessControl"
import { autoBindSingleStore } from "@/lib/autoBindStore"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

describe("ProtectedLayout checkAccess orchestration (Sprint 2B)", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    jest.clearAllMocks()
    mockPathname = "/service/invoices"
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    jest.mocked(supabase.auth.getSession).mockResolvedValue({
      data: {
        session: {
          user: {
            id: "user-1",
            email: "test@example.com",
            user_metadata: {},
          },
        },
      },
      error: null,
    } as never)

    jest.mocked(resolveAccess).mockResolvedValue({
      allowed: true,
      resolvedContext: {
        business: {
          id: "biz-1",
          industry: "service",
          default_currency: "GHS",
        },
        role: "owner",
      },
    } as never)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  async function waitForChild() {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (container.querySelector('[data-testid="protected-child"]')) return
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error("Protected child did not render")
  }

  it("skips autoBindSingleStore on /service/* paths", async () => {
    act(() => {
      root.render(
        <ProtectedLayout>
          <div data-testid="protected-child">ok</div>
        </ProtectedLayout>
      )
    })

    await waitForChild()

    expect(autoBindSingleStore).not.toHaveBeenCalled()
  })

  it("reuses resolveAccess resolvedContext without post-access getCurrentBusiness", async () => {
    act(() => {
      root.render(
        <ProtectedLayout>
          <div data-testid="protected-child">ok</div>
        </ProtectedLayout>
      )
    })

    await waitForChild()

    expect(getCurrentBusiness).not.toHaveBeenCalled()
    expect(getUserRole).not.toHaveBeenCalled()
  })

  it("calls autoBindSingleStore on retail paths", async () => {
    mockPathname = "/retail/dashboard"
    jest.mocked(autoBindSingleStore).mockResolvedValue(false)

    act(() => {
      root.render(
        <ProtectedLayout>
          <div data-testid="protected-child">ok</div>
        </ProtectedLayout>
      )
    })

    await waitForChild()

    expect(autoBindSingleStore).toHaveBeenCalled()
  })
})
