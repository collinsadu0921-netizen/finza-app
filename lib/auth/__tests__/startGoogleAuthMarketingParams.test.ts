jest.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signInWithOAuth: jest.fn() } },
}))

jest.mock("@/lib/auth/publicAppUrl", () => ({
  getPublicAppUrl: () => "https://app.example.com",
}))

import { buildOAuthRedirectToWithMarketingContext } from "../startGoogleAuth"

describe("buildOAuthRedirectToWithMarketingContext", () => {
  it("forwards workspace, trial, plan, and billing_cycle to /auth/callback", () => {
    const url = buildOAuthRedirectToWithMarketingContext({
      workspace: "service",
      trial: "1",
      plan: "professional",
      billing_cycle: "monthly",
    })
    const u = new URL(url)
    expect(u.pathname).toBe("/auth/callback")
    expect(u.searchParams.get("workspace")).toBe("service")
    expect(u.searchParams.get("trial")).toBe("1")
    expect(u.searchParams.get("plan")).toBe("professional")
    expect(u.searchParams.get("billing_cycle")).toBe("monthly")
  })

  it("accepts cycle as alias and emits billing_cycle on callback URL", () => {
    const url = buildOAuthRedirectToWithMarketingContext({
      workspace: "service",
      trial: "1",
      plan: "starter",
      cycle: "annual",
    })
    const u = new URL(url)
    expect(u.searchParams.get("billing_cycle")).toBe("annual")
    expect(u.searchParams.get("cycle")).toBeNull()
  })
})
