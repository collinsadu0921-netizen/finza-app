/** @jest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import ProtectedLayout from "@/components/ProtectedLayout"

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/service/dashboard",
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
  ServiceSubscriptionProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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

describe("ProtectedLayout hook order", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    jest.clearAllMocks()
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
    jest.mocked(autoBindSingleStore).mockResolvedValue(false)
    jest.mocked(resolveAccess).mockResolvedValue({ allowed: true } as never)
    jest.mocked(getCurrentBusiness).mockResolvedValue({
      id: "biz-1",
      default_currency: "GHS",
      industry: "service",
    } as never)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it(
    "renders loading then access-granted without React hook-order errors",
    async () => {
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => {})

      act(() => {
        root.render(
          <ProtectedLayout>
            <div data-testid="protected-child">Child content</div>
          </ProtectedLayout>
        )
      })

      expect(container.textContent).toContain("Loading...")

      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        if (container.querySelector('[data-testid="protected-child"]')) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      expect(container.querySelector('[data-testid="protected-child"]')).not.toBeNull()

      const hookOrderMessages = consoleError.mock.calls
        .map((call) => String(call[0]))
        .filter(
          (message) =>
            message.includes("Rendered more hooks") ||
            message.includes("Rendered fewer hooks") ||
            message.includes("Minified React error #310")
        )

      expect(hookOrderMessages).toEqual([])

      consoleError.mockRestore()
    }
  )
})
