import {
  isWorkspaceBusinessOwner,
  sidebarBrandingFromWorkspaceBusiness,
  workspaceBusinessIndustry,
} from "@/lib/sidebar/sidebarWorkspaceBusiness"

describe("sidebarWorkspaceBusiness", () => {
  it("detects owner from business.owner_id and session user id", () => {
    expect(
      isWorkspaceBusinessOwner(
        { id: "biz-1", owner_id: "user-1" },
        { id: "user-1", email: "a@b.com", user_metadata: {} }
      )
    ).toBe(true)
    expect(
      isWorkspaceBusinessOwner(
        { id: "biz-1", owner_id: "user-2" },
        { id: "user-1", email: "a@b.com", user_metadata: {} }
      )
    ).toBe(false)
  })

  it("does not infer owner without owner_id", () => {
    expect(
      isWorkspaceBusinessOwner(
        { id: "biz-1" },
        { id: "user-1", email: "a@b.com", user_metadata: {} }
      )
    ).toBe(false)
  })

  it("maps branding fields from workspace business", () => {
    expect(
      sidebarBrandingFromWorkspaceBusiness({
        id: "biz-1",
        trading_name: "Acme Trading",
        logo_url: "https://cdn/logo.png",
      })
    ).toEqual({
      name: "Acme Trading",
      logo_url: "https://cdn/logo.png",
    })
  })

  it("reads industry from workspace business", () => {
    expect(
      workspaceBusinessIndustry({ id: "biz-1", industry: "service" })
    ).toBe("service")
  })
})
