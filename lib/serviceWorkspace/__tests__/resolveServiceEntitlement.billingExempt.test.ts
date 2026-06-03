import { describe, it, expect } from "@jest/globals"
import { resolveServiceEntitlement } from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { BILLING_EXEMPT_DEFAULT_REASON } from "@/lib/serviceWorkspace/billingExempt"

const EXPIRED = new Date("2020-01-01T00:00:00.000Z")
const NOW = new Date("2026-06-01T12:00:00.000Z")

describe("resolveServiceEntitlement — billing_exempt", () => {
  it("grants Business access when exempt even if period ended and status locked", () => {
    const e = resolveServiceEntitlement(
      {
        billing_exempt: true,
        billing_exempt_reason: "founder_internal_account",
        service_subscription_tier: "starter",
        service_subscription_status: "locked",
        current_period_ends_at: EXPIRED.toISOString(),
        subscription_grace_until: EXPIRED.toISOString(),
        trial_ends_at: EXPIRED.toISOString(),
      },
      NOW
    )

    expect(e.billingExempt).toBe(true)
    expect(e.billingExemptReason).toBe("founder_internal_account")
    expect(e.accessSource).toBe("billing_exempt")
    expect(e.effectiveTier).toBe("business")
    expect(e.isSubscriptionLocked).toBe(false)
    expect(e.inGracePeriod).toBe(false)
    expect(e.periodExpired).toBe(false)
    expect(e.trialExpired).toBe(false)
    expect(e.isTrialing).toBe(false)
    expect(e.status).toBe("active")
  })

  it("uses default reason when billing_exempt_reason is null", () => {
    const e = resolveServiceEntitlement({ billing_exempt: true }, NOW)
    expect(e.billingExemptReason).toBe(BILLING_EXEMPT_DEFAULT_REASON)
  })
})

describe("resolveServiceEntitlement — normal customers unchanged", () => {
  it("locks when grace expired on past_due", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "professional",
        service_subscription_status: "locked",
        subscription_grace_until: EXPIRED.toISOString(),
      },
      NOW
    )

    expect(e.billingExempt).toBe(false)
    expect(e.accessSource).toBe("subscription")
    expect(e.isSubscriptionLocked).toBe(true)
    expect(e.effectiveTier).toBe("professional")
  })

  it("active paid professional tier with valid period", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "professional",
        service_subscription_status: "active",
        current_period_ends_at: "2099-12-31T00:00:00.000Z",
      },
      NOW
    )

    expect(e.billingExempt).toBe(false)
    expect(e.isSubscriptionLocked).toBe(false)
    expect(e.periodExpired).toBe(false)
    expect(e.effectiveTier).toBe("professional")
  })

  it("read-only when unpaid trial expired and grace not started (stale trialing)", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "business",
        service_subscription_status: "trialing",
        trial_ends_at: EXPIRED.toISOString(),
      },
      NOW
    )

    expect(e.billingExempt).toBe(false)
    expect(e.trialExpired).toBe(true)
    expect(e.trialExpiredWithoutPayment).toBe(true)
    expect(e.effectiveTier).toBe("business")
    expect(e.rawTier).toBe("business")
    expect(e.isReadOnlyLocked).toBe(true)
    expect(e.canWriteFinancialRecords).toBe(false)
    expect(e.trialGraceActive).toBe(false)
    expect(e.trialGraceExpired).toBe(true)
  })

  it("allows writes during unpaid trial post-expiry grace", () => {
    const graceUntil = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "business",
        service_subscription_status: "past_due",
        trial_ends_at: EXPIRED.toISOString(),
        subscription_grace_until: graceUntil,
      },
      NOW
    )

    expect(e.trialGraceActive).toBe(true)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.effectiveTier).toBe("business")
  })

  it("read-only when unpaid trial grace expired", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "business",
        service_subscription_status: "locked",
        trial_ends_at: EXPIRED.toISOString(),
        subscription_grace_until: EXPIRED.toISOString(),
      },
      NOW
    )

    expect(e.isReadOnlyLocked).toBe(true)
    expect(e.canWriteFinancialRecords).toBe(false)
    expect(e.trialGraceExpired).toBe(true)
  })

  it("paid renewal past_due with active grace can still write", () => {
    const graceUntil = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString()
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "professional",
        service_subscription_status: "past_due",
        subscription_started_at: "2025-01-01T00:00:00.000Z",
        subscription_grace_until: graceUntil,
        current_period_ends_at: EXPIRED.toISOString(),
      },
      NOW
    )

    expect(e.trialExpiredWithoutPayment).toBe(false)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.inGracePeriod).toBe(true)
  })

  it("periodExpired for active subscription past current_period_ends_at", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "starter",
        service_subscription_status: "active",
        current_period_ends_at: EXPIRED.toISOString(),
      },
      NOW
    )

    expect(e.billingExempt).toBe(false)
    expect(e.periodExpired).toBe(true)
    expect(e.inGracePeriod).toBe(true)
    expect(e.isSubscriptionLocked).toBe(false)
  })
})
