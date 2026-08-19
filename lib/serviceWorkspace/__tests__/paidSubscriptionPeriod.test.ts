import { describe, it, expect } from "@jest/globals"
import {
  deterministicPaidGraceEnd,
  lifecycleKeyPaidPeriod,
  resolvePaidPeriodClock,
  sameTimestamp,
  PAID_POST_EXPIRY_GRACE_MS,
} from "@/lib/serviceWorkspace/paidSubscriptionPeriod"

const PERIOD_END = new Date("2026-08-06T18:00:00.000Z")
const STARTED = new Date("2026-07-06T18:00:00.000Z")

describe("paidSubscriptionPeriod", () => {
  it("caps paid grace at period end + 3 days", () => {
    expect(deterministicPaidGraceEnd(PERIOD_END).toISOString()).toBe(
      "2026-08-09T18:00:00.000Z"
    )
    expect(PAID_POST_EXPIRY_GRACE_MS).toBe(3 * 24 * 60 * 60 * 1000)
  })

  it("treats now < grace_end as grace and now >= grace_end as expired", () => {
    const justBefore = resolvePaidPeriodClock({
      now: new Date("2026-08-09T17:59:59.999Z"),
      subscriptionStartedAt: STARTED,
      periodEndsAt: PERIOD_END,
      status: "active",
    })
    expect(justBefore.paidGraceActive).toBe(true)
    expect(justBefore.paidGraceExpired).toBe(false)

    const atDeadline = resolvePaidPeriodClock({
      now: new Date("2026-08-09T18:00:00.000Z"),
      subscriptionStartedAt: STARTED,
      periodEndsAt: PERIOD_END,
      status: "active",
    })
    expect(atDeadline.paidGraceActive).toBe(false)
    expect(atDeadline.paidGraceExpired).toBe(true)
  })

  it("does not treat legacy paid rows with a null period as paid-with-period", () => {
    const clock = resolvePaidPeriodClock({
      now: new Date("2026-08-10T18:00:00.000Z"),
      subscriptionStartedAt: STARTED,
      periodEndsAt: null,
      status: "active",
    })
    expect(clock.isPaidWithKnownPeriod).toBe(false)
    expect(clock.paidGraceExpired).toBe(false)
  })

  it("builds a period-scoped lifecycle key", () => {
    expect(lifecycleKeyPaidPeriod("2026-08-06T18:00:00.000Z", "biz-1")).toBe(
      "2026-08-06T18:00:00.000Z|biz-1"
    )
  })

  it("compares grace timestamps by instant, not string identity", () => {
    expect(sameTimestamp("2026-08-09T18:00:00.000Z", "2026-08-09T18:00:00.000Z")).toBe(true)
    expect(sameTimestamp("2026-08-09T18:00:00.000Z", "2026-08-09T18:00:00.001Z")).toBe(false)
    expect(sameTimestamp(null, "2026-08-09T18:00:00.000Z")).toBe(false)
  })
})
