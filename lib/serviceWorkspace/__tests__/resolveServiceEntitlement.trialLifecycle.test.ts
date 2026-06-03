import { describe, it, expect } from "@jest/globals"
import { resolveServiceEntitlement } from "@/lib/serviceWorkspace/resolveServiceEntitlement"

const EXPIRED = new Date("2020-01-01T00:00:00.000Z")
const FUTURE = new Date("2099-12-31T00:00:00.000Z")
const NOW = new Date("2026-06-01T12:00:00.000Z")

describe("resolveServiceEntitlement — trial lifecycle", () => {
  it("active trial before trial_ends_at can write", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "business",
        service_subscription_status: "trialing",
        trial_ends_at: FUTURE.toISOString(),
      },
      NOW
    )

    expect(e.isTrialing).toBe(true)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.effectiveTier).toBe("business")
  })

  it("expired unpaid trial in grace allows writes and warning state", () => {
    const graceUntil = new Date(NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "business",
        service_subscription_status: "past_due",
        trial_ends_at: EXPIRED.toISOString(),
        subscription_grace_until: graceUntil,
      },
      NOW
    )

    expect(e.trialExpiredWithoutPayment).toBe(true)
    expect(e.trialGraceActive).toBe(true)
    expect(e.trialGraceExpired).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.inGracePeriod).toBe(true)
  })

  it("after grace expiry writes are blocked (locked status)", () => {
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

  it("locked unpaid trial is not tier-downgraded (raw tier preserved)", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "business",
        service_subscription_status: "locked",
        trial_ends_at: EXPIRED.toISOString(),
        subscription_grace_until: EXPIRED.toISOString(),
      },
      NOW
    )

    expect(e.effectiveTier).toBe("business")
    expect(e.rawTier).toBe("business")
  })

  it("paid active tenant can write normally", () => {
    const e = resolveServiceEntitlement(
      {
        service_subscription_tier: "professional",
        service_subscription_status: "active",
        subscription_started_at: "2025-06-01T00:00:00.000Z",
        current_period_ends_at: FUTURE.toISOString(),
      },
      NOW
    )

    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.effectiveTier).toBe("professional")
  })
})
