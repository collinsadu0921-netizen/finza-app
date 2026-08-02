/** @jest-environment jsdom */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { ServiceSubscriptionProvider } from "@/components/service/ServiceSubscriptionContext"
import { getCurrentBusiness } from "@/lib/business"

jest.mock("next/navigation", () => ({
  usePathname: () => "/service/invoices",
  useSearchParams: () => new URLSearchParams(""),
}))

jest.mock("@/lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
    },
    from: jest.fn(),
  },
}))

jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(),
}))

const mockUseWorkspaceBusiness = jest.fn()
jest.mock("@/components/WorkspaceBusinessContext", () => ({
  useWorkspaceBusiness: () => mockUseWorkspaceBusiness(),
}))

import { supabase } from "@/lib/supabaseClient"

const workspaceBusiness = {
  id: "biz-ctx",
  owner_id: "user-1",
  service_subscription_tier: "professional",
  service_subscription_status: "active",
  billing_exempt: false,
}

describe("ServiceSubscriptionProvider workspace context reuse", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    jest.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseWorkspaceBusiness.mockReturnValue({
      business: workspaceBusiness,
      sessionUser: { id: "user-1", email: "a@b.com", user_metadata: {} },
    })
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("does not call getCurrentBusiness when workspace context matches session scope", async () => {
    await act(async () => {
      root.render(
        <ServiceSubscriptionProvider>
          <div data-testid="child">ok</div>
        </ServiceSubscriptionProvider>
      )
      await Promise.resolve()
    })

    expect(getCurrentBusiness).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe("ServiceSubscriptionProvider fallback", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    jest.clearAllMocks()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    mockUseWorkspaceBusiness.mockReturnValue({
      business: null,
      sessionUser: null,
    })
    jest.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    } as never)
    jest.mocked(getCurrentBusiness).mockResolvedValue({
      id: "biz-fallback",
      service_subscription_tier: "starter",
      service_subscription_status: "active",
    } as never)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it("falls back to getCurrentBusiness when workspace context is absent", async () => {
    await act(async () => {
      root.render(
        <ServiceSubscriptionProvider>
          <div>ok</div>
        </ServiceSubscriptionProvider>
      )
      await Promise.resolve()
    })

    expect(getCurrentBusiness).toHaveBeenCalled()
  })
})
