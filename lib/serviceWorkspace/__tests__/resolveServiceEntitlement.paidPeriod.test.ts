import { describe, it, expect } from "@jest/globals"
import { resolveServiceEntitlement } from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { deterministicPaidGraceEnd } from "@/lib/serviceWorkspace/paidSubscriptionPeriod"

const NOW = new Date("2026-08-10T18:00:00.000Z")
const STARTED = "2026-06-01T18:00:00.000Z"

function paidRow(overrides: Record<string, string | null | boolean> = {}) {
  return {
    service_subscription_tier: "professional",
    service_subscription_status: "active",
    subscription_started_at: STARTED,
    current_period_ends_at: "2026-09-10T18:00:00.000Z",
    billing_exempt: false,
    ...overrides,
  }
}

describe("resolveServiceEntitlement — paid period clock", () => {
  it("1. paid active before period end is writable and not in paid grace", () => {
    const e = resolveServiceEntitlement(paidRow(), NOW)
    expect(e.periodExpired).toBe(false)
    expect(e.inGracePeriod).toBe(false)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
  })

  it("2. stale active expired by 1 day with null grace is in paid grace and writable", () => {
    const periodEnd = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
    const e = resolveServiceEntitlement(
      paidRow({
        current_period_ends_at: periodEnd.toISOString(),
        subscription_grace_until: null,
      }),
      NOW
    )
    expect(e.periodExpired).toBe(true)
    expect(e.inGracePeriod).toBe(true)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.graceEndsAt?.toISOString()).toBe(
      deterministicPaidGraceEnd(periodEnd).toISOString()
    )
  })

  it("3a. exact deterministic boundary now = period_end + 3 days is read-only", () => {
    const periodEnd = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000)
    const e = resolveServiceEntitlement(
      paidRow({
        current_period_ends_at: periodEnd.toISOString(),
        subscription_grace_until: null,
      }),
      NOW
    )
    expect(e.isReadOnlyLocked).toBe(true)
    expect(e.canWriteFinancialRecords).toBe(false)
    expect(e.inGracePeriod).toBe(false)
  })

  it("3. stale active expired by more than 3 days with null grace is read-only", () => {
    const periodEnd = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000)
    const e = resolveServiceEntitlement(
      paidRow({
        current_period_ends_at: periodEnd.toISOString(),
        subscription_grace_until: null,
      }),
      NOW
    )
    expect(e.periodExpired).toBe(true)
    expect(e.inGracePeriod).toBe(false)
    expect(e.isReadOnlyLocked).toBe(true)
    expect(e.canWriteFinancialRecords).toBe(false)
  })

  it("4. stale active expired >3 days cannot be extended by a future DB grace value", () => {
    const periodEnd = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000)
    const e = resolveServiceEntitlement(
      paidRow({
        current_period_ends_at: periodEnd.toISOString(),
        subscription_grace_until: new Date(
          NOW.getTime() + 9 * 24 * 60 * 60 * 1000
        ).toISOString(),
      }),
      NOW
    )
    expect(e.isReadOnlyLocked).toBe(true)
    expect(e.canWriteFinancialRecords).toBe(false)
    expect(e.inGracePeriod).toBe(false)
    expect(e.graceEndsAt?.getTime()).toBe(
      deterministicPaidGraceEnd(periodEnd).getTime()
    )
  })

  it("5. paid past_due within deterministic grace is writable", () => {
    const periodEnd = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000)
    const e = resolveServiceEntitlement(
      paidRow({
        service_subscription_status: "past_due",
        current_period_ends_at: periodEnd.toISOString(),
        subscription_grace_until: deterministicPaidGraceEnd(periodEnd).toISOString(),
      }),
      NOW
    )
    expect(e.inGracePeriod).toBe(true)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
  })

  it("6. paid past_due after deterministic grace is read-only", () => {
    const periodEnd = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000)
    const e = resolveServiceEntitlement(
      paidRow({
        service_subscription_status: "past_due",
        current_period_ends_at: periodEnd.toISOString(),
        subscription_grace_until: deterministicPaidGraceEnd(periodEnd).toISOString(),
      }),
      NOW
    )
    expect(e.isReadOnlyLocked).toBe(true)
    expect(e.canWriteFinancialRecords).toBe(false)
    expect(e.inGracePeriod).toBe(false)
  })

  it("7. billing_exempt remains unrestricted when the paid period is expired", () => {
    const e = resolveServiceEntitlement(
      paidRow({
        billing_exempt: true,
        current_period_ends_at: "2020-01-01T00:00:00.000Z",
        service_subscription_status: "locked",
      }),
      NOW
    )
    expect(e.billingExempt).toBe(true)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.effectiveTier).toBe("business")
  })

  it("8. future paid period retains access after a failed-renewal past_due state", () => {
    const e = resolveServiceEntitlement(
      paidRow({
        service_subscription_status: "past_due",
        current_period_ends_at: "2026-09-10T18:00:00.000Z",
        subscription_grace_until: "2026-08-08T18:00:00.000Z",
      }),
      NOW
    )
    expect(e.periodExpired).toBe(false)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.inGracePeriod).toBe(false)
  })

  it("9. legacy paid row with NULL current_period_ends_at keeps prior writable semantics", () => {
    const e = resolveServiceEntitlement(
      paidRow({
        current_period_ends_at: null,
        subscription_grace_until: null,
      }),
      NOW
    )
    expect(e.periodExpired).toBe(false)
    expect(e.isReadOnlyLocked).toBe(false)
    expect(e.canWriteFinancialRecords).toBe(true)
    expect(e.inGracePeriod).toBe(false)
  })

  it("status locked remains locked even inside the paid window", () => {
    const e = resolveServiceEntitlement(
      paidRow({
        service_subscription_status: "locked",
        current_period_ends_at: "2026-09-10T18:00:00.000Z",
      }),
      NOW
    )
    expect(e.isReadOnlyLocked).toBe(true)
    expect(e.canWriteFinancialRecords).toBe(false)
  })
})
