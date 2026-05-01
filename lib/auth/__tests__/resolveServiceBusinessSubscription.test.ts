import { resolveServiceBusinessSubscriptionFromUserMetadata } from "../resolveServiceBusinessSubscription"

describe("resolveServiceBusinessSubscriptionFromUserMetadata", () => {
  it("trialing when service trial metadata is complete", () => {
    const r = resolveServiceBusinessSubscriptionFromUserMetadata({
      trial_intent: true,
      trial_workspace: "service",
      trial_plan: "professional",
    })
    expect(r.service_subscription_status).toBe("trialing")
    expect(r.service_subscription_tier).toBe("professional")
    expect(r.trial_started_at).toBeTruthy()
    expect(r.trial_ends_at).toBeTruthy()
  })

  it("does not trial or honor trial_plan tier for non-service trial_workspace", () => {
    const r = resolveServiceBusinessSubscriptionFromUserMetadata({
      trial_intent: true,
      trial_workspace: "retail",
      trial_plan: "business",
    })
    expect(r.service_subscription_status).toBe("active")
    expect(r.service_subscription_tier).toBe("starter")
  })

  it("uses signup_service_plan when no trial", () => {
    const r = resolveServiceBusinessSubscriptionFromUserMetadata({
      signup_service_plan: "growth",
    })
    expect(r.service_subscription_status).toBe("active")
    expect(r.service_subscription_tier).toBe("professional")
  })

  it("defaults to starter", () => {
    const r = resolveServiceBusinessSubscriptionFromUserMetadata({})
    expect(r.service_subscription_tier).toBe("starter")
    expect(r.service_subscription_status).toBe("active")
  })
})
