import {
  resolveSubscriptionEntitlementScopeMode,
  subscriptionEntitlementFromBusinessRow,
  workspaceBusinessSubscriptionKey,
} from "@/lib/serviceWorkspace/subscriptionEntitlementFromBusinessRow"

describe("subscriptionEntitlementFromBusinessRow", () => {
  it("derives entitlement from a workspace business row", () => {
    const entitlement = subscriptionEntitlementFromBusinessRow({
      service_subscription_tier: "professional",
      service_subscription_status: "active",
      billing_exempt: false,
    })
    expect(entitlement.rawTier).toBe("professional")
    expect(entitlement.status).toBe("active")
  })

  it("uses context when URL business matches workspace business", () => {
    expect(
      resolveSubscriptionEntitlementScopeMode("biz-1", "biz-1")
    ).toBe("context")
  })

  it("uses explicit URL query when override differs from context", () => {
    expect(
      resolveSubscriptionEntitlementScopeMode("biz-1", "biz-2")
    ).toBe("url_query")
  })

  it("uses context for session scope when no URL override", () => {
    expect(resolveSubscriptionEntitlementScopeMode("biz-1", null)).toBe(
      "context"
    )
  })

  it("falls back when workspace context is absent", () => {
    expect(resolveSubscriptionEntitlementScopeMode(null, null)).toBe("fallback")
  })

  it("changes subscription key when tier changes for the same business", () => {
    const before = workspaceBusinessSubscriptionKey({
      id: "biz-1",
      service_subscription_tier: "starter",
      service_subscription_status: "trialing",
    })
    const after = workspaceBusinessSubscriptionKey({
      id: "biz-1",
      service_subscription_tier: "professional",
      service_subscription_status: "active",
    })
    expect(before).not.toBe(after)
  })
})
