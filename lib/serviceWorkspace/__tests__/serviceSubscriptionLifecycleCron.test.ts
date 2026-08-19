/**
 * Service subscription lifecycle cron: windows, lock rules, resilience to send failures.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import {
  createSubscriptionLifecycleCronQueries,
  executeServiceSubscriptionLifecycleCron,
  type SubscriptionLifecycleCronQueries,
} from "@/lib/serviceWorkspace/serviceSubscriptionLifecycleCron"
import { sendSubscriptionLifecycleNotification } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"
import type { SendSubscriptionLifecycleNotificationResult } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"

type SendFn = typeof sendSubscriptionLifecycleNotification

const NOW = new Date("2026-06-15T08:00:00.000Z")

function emptyQueries(overrides: Partial<SubscriptionLifecycleCronQueries>): SubscriptionLifecycleCronQueries {
  return {
    listTrialEnding3d: async () => [],
    listTrialEnding1d: async () => [],
    listExpiredUnpaidTrialsNeedingGrace: async () => [],
    startTrialPostExpiryGrace: async () => ({ error: null }),
    listExpiredPaidActiveSubscriptions: async () => [],
    transitionExpiredPaidToPastDue: async () => ({ updated: true, error: null }),
    lockExpiredPaidBeyondGrace: async () => ({ updated: true, error: null }),
    listPaidPastDueSubscriptions: async () => [],
    normalizePaidPastDueGrace: async () => ({ updated: true, error: null }),
    lockPaidPastDueBeyondGrace: async () => ({ updated: true, error: null }),
    listGraceEnding24h: async () => [],
    listLockExpiredGrace: async () => [],
    lockPastDueGraceExpired: async () => ({ error: null }),
    ...overrides,
  }
}

describe("executeServiceSubscriptionLifecycleCron", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("starts 3-day grace for expired unpaid trials and notifies", async () => {
    const startGrace = jest.fn(async () => ({ error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_grace" } as const)
    )
    const queries = emptyQueries({
      listExpiredUnpaidTrialsNeedingGrace: async () => [
        { id: "biz-expired", trial_ends_at: "2026-06-01T00:00:00.000Z" },
      ],
      startTrialPostExpiryGrace: startGrace,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.trialGraceStartedChecked).toBe(1)
    expect(summary.trialGraceStartedUpdated).toBe(1)
    expect(summary.trialGraceStartedNotified).toBe(1)
    expect(startGrace).toHaveBeenCalledTimes(1)
    const graceIso = startGrace.mock.calls[0][1] as string
    expect(new Date(graceIso).getTime()).toBeGreaterThan(NOW.getTime())
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-expired",
        eventType: "trial_grace_started",
      })
    )
  })

  it("does not overwrite existing subscription_grace_until (start returns no row)", async () => {
    const startGrace = jest.fn(async () => ({ error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_skip" } as const)
    )
    const queries = emptyQueries({
      listExpiredUnpaidTrialsNeedingGrace: async () => [],
      startTrialPostExpiryGrace: startGrace,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.trialGraceStartedChecked).toBe(0)
    expect(startGrace).not.toHaveBeenCalled()
  })

  it("sends trial_ending_3d once per candidate", async () => {
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_1" } as const)
    )
    const queries = emptyQueries({
      listTrialEnding3d: async () => [
        { id: "biz-3d", trial_ends_at: "2026-06-18T12:00:00.000Z" },
      ],
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.trialEnding3dChecked).toBe(1)
    expect(summary.trialEnding3dSent).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-3d",
        eventType: "trial_ending_3d",
        lifecycleKey: "2026-06-18|biz-3d",
      })
    )
  })

  it("sends trial_ending_1d once per candidate", async () => {
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_2" } as const)
    )
    const queries = emptyQueries({
      listTrialEnding1d: async () => [
        { id: "biz-1d", trial_ends_at: "2026-06-16T10:00:00.000Z" },
      ],
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.trialEnding1dChecked).toBe(1)
    expect(summary.trialEnding1dSent).toBe(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1d",
        eventType: "trial_ending_1d",
        lifecycleKey: "2026-06-16|biz-1d",
      })
    )
  })

  it("sends grace_ending_24h once per candidate", async () => {
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_3" } as const)
    )
    const graceUntil = "2026-06-16T08:00:00.000Z"
    const queries = emptyQueries({
      listGraceEnding24h: async () => [{ id: "biz-grace", subscription_grace_until: graceUntil }],
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.graceEndingChecked).toBe(1)
    expect(summary.graceEndingSent).toBe(1)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-grace",
        eventType: "grace_ending_24h",
        lifecycleKey: `${graceUntil}|biz-grace`,
      })
    )
  })

  it("updates past_due + expired grace to locked and sends subscription_locked", async () => {
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_4" } as const)
    )
    const lock = jest.fn(async () => ({ error: null }))
    const graceUntil = "2026-06-14T12:00:00.000Z"
    const queries = emptyQueries({
      listLockExpiredGrace: async () => [{ id: "biz-lock", subscription_grace_until: graceUntil }],
      lockPastDueGraceExpired: lock,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.lockedChecked).toBe(1)
    expect(summary.lockedUpdated).toBe(1)
    expect(summary.lockedNotified).toBe(1)
    expect(lock).toHaveBeenCalledWith("biz-lock", NOW)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-lock",
        eventType: "subscription_locked",
        lifecycleKey: `${graceUntil}|biz-lock`,
      })
    )
  })

  it("does not lock when listLockExpiredGrace is empty (e.g. null grace)", async () => {
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_x" } as const)
    )
    const lock = jest.fn(async () => ({ error: null }))
    const queries = emptyQueries({
      listLockExpiredGrace: async () => [],
      lockPastDueGraceExpired: lock,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.lockedChecked).toBe(0)
    expect(summary.lockedUpdated).toBe(0)
    expect(lock).not.toHaveBeenCalled()
  })

  it("records email failure but continues processing remaining rows", async () => {
    let call = 0
    const send = jest.fn(async (): Promise<SendSubscriptionLifecycleNotificationResult> => {
      call += 1
      if (call === 1) return { ok: false, reason: "send_failed" }
      return { ok: true, providerMessageId: "re_ok" }
    })
    const queries = emptyQueries({
      listTrialEnding3d: async () => [
        { id: "biz-a", trial_ends_at: "2026-06-18T12:00:00.000Z" },
        { id: "biz-b", trial_ends_at: "2026-06-18T14:00:00.000Z" },
      ],
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.trialEnding3dChecked).toBe(2)
    expect(summary.trialEnding3dSent).toBe(1)
    expect(summary.errors.some((e) => e.includes("biz-a") && e.includes("send_failed"))).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it("continues when send throws", async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ ok: true, providerMessageId: "re_ok" } as const)
    const queries = emptyQueries({
      listTrialEnding1d: async () => [
        { id: "biz-x", trial_ends_at: "2026-06-16T10:00:00.000Z" },
        { id: "biz-y", trial_ends_at: "2026-06-16T11:00:00.000Z" },
      ],
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send as unknown as SendFn, NOW)

    expect(summary.trialEnding1dChecked).toBe(2)
    expect(summary.trialEnding1dSent).toBe(1)
    expect(summary.errors.some((e) => e.includes("trial_ending_1d") && e.includes("network"))).toBe(true)
  })

  it("starts deterministic paid grace for an active period that just expired", async () => {
    const periodEnd = "2026-06-14T08:00:00.000Z"
    const transition = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_paid_grace" } as const)
    )
    const queries = emptyQueries({
      listExpiredPaidActiveSubscriptions: async () => [
        {
          id: "biz-paid-grace",
          service_subscription_status: "active",
          current_period_ends_at: periodEnd,
        },
      ],
      transitionExpiredPaidToPastDue: transition,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.paidPeriodExpiredChecked).toBe(1)
    expect(summary.paidGraceStartedUpdated).toBe(1)
    expect(summary.paidGraceStartedNotified).toBe(1)
    expect(summary.paidPeriodExpiredLocked).toBe(0)
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-paid-grace",
        expectedStatus: "active",
        expectedPeriodEndsAt: periodEnd,
        graceUntilIso: "2026-06-17T08:00:00.000Z",
      })
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-paid-grace",
        eventType: "subscription_period_expired_grace_started",
        lifecycleKey: `${periodEnd}|biz-paid-grace`,
      })
    )
  })

  it("locks a paid period expired more than 3 days ago without gifting grace from now", async () => {
    const periodEnd = "2026-06-01T08:00:00.000Z"
    const lockPaid = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_paid_lock" } as const)
    )
    const queries = emptyQueries({
      listExpiredPaidActiveSubscriptions: async () => [
        {
          id: "biz-paid-lock",
          service_subscription_status: "active",
          current_period_ends_at: periodEnd,
        },
      ],
      lockExpiredPaidBeyondGrace: lockPaid,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.paidPeriodExpiredLocked).toBe(1)
    expect(summary.paidGraceStartedUpdated).toBe(0)
    expect(lockPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-paid-lock",
        expectedPeriodEndsAt: periodEnd,
        graceUntilIso: "2026-06-04T08:00:00.000Z",
      })
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "subscription_locked",
        lifecycleKey: `${periodEnd}|biz-paid-lock`,
      })
    )
  })

  it("does not process billing_exempt candidates because they are excluded from the list", async () => {
    const transition = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true } as const)
    )
    const queries = emptyQueries({
      listExpiredPaidActiveSubscriptions: async () => [],
      transitionExpiredPaidToPastDue: transition,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)
    expect(summary.paidPeriodExpiredChecked).toBe(0)
    expect(transition).not.toHaveBeenCalled()
  })

  it("does not overwrite a successful renewal that races the cron update", async () => {
    const transition = jest.fn(async () => ({ updated: false, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_race" } as const)
    )
    const queries = emptyQueries({
      listExpiredPaidActiveSubscriptions: async () => [
        {
          id: "biz-race",
          service_subscription_status: "active",
          current_period_ends_at: "2026-06-14T08:00:00.000Z",
        },
      ],
      transitionExpiredPaidToPastDue: transition,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, NOW)

    expect(summary.paidGraceStartedUpdated).toBe(0)
    expect(summary.paidGraceStartedNotified).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it("is idempotent on rerun: no second paid-grace transition or email", async () => {
    const transition = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_once" } as const)
    )
    const candidate = {
      id: "biz-once",
      service_subscription_status: "active",
      current_period_ends_at: "2026-06-14T08:00:00.000Z",
    }
    const first = emptyQueries({
      listExpiredPaidActiveSubscriptions: async () => [candidate],
      transitionExpiredPaidToPastDue: transition,
    })
    const second = emptyQueries({
      listExpiredPaidActiveSubscriptions: async () => [],
      transitionExpiredPaidToPastDue: transition,
    })

    const firstSummary = await executeServiceSubscriptionLifecycleCron(first, send, NOW)
    const secondSummary = await executeServiceSubscriptionLifecycleCron(second, send, NOW)

    expect(firstSummary.paidGraceStartedUpdated).toBe(1)
    expect(firstSummary.paidGraceStartedNotified).toBe(1)
    expect(secondSummary.paidPeriodExpiredChecked).toBe(0)
    expect(secondSummary.paidGraceStartedUpdated).toBe(0)
    expect(transition).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe("paid past_due deterministic grace normalization", () => {
  const PERIOD_END = "2026-08-06T18:00:00.000Z"
  const DETERMINISTIC_GRACE = "2026-08-09T18:00:00.000Z"
  const INSIDE_GRACE = new Date("2026-08-08T12:00:00.000Z")
  const AT_DEADLINE = new Date("2026-08-09T18:00:00.000Z")
  const LONG_EXPIRED = new Date("2026-08-20T18:00:00.000Z")

  function paidPastDue(graceUntil: string | null) {
    return {
      id: "biz-paid-pd",
      service_subscription_status: "past_due",
      current_period_ends_at: PERIOD_END,
      subscription_grace_until: graceUntil,
    }
  }

  it("remains past_due while deterministic grace is still active", async () => {
    const normalize = jest.fn(async () => ({ updated: true, error: null }))
    const lock = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_norm" } as const)
    )
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue("2026-08-15T00:00:00.000Z")],
      normalizePaidPastDueGrace: normalize,
      lockPaidPastDueBeyondGrace: lock,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, INSIDE_GRACE)

    expect(summary.paidPastDueChecked).toBe(1)
    expect(summary.paidPastDueNormalized).toBe(1)
    expect(summary.paidPastDueLocked).toBe(0)
    expect(lock).not.toHaveBeenCalled()
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-paid-pd",
        expectedStatus: "past_due",
        expectedPeriodEndsAt: PERIOD_END,
        graceUntilIso: DETERMINISTIC_GRACE,
      })
    )
    expect(send).not.toHaveBeenCalled()
  })

  it("normalizes a NULL stored grace to the deterministic deadline", async () => {
    const normalize = jest.fn(async () => ({ updated: true, error: null }))
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue(null)],
      normalizePaidPastDueGrace: normalize,
    })
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> => ({ ok: true } as const)
    )

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, INSIDE_GRACE)
    expect(summary.paidPastDueNormalized).toBe(1)
    expect(normalize.mock.calls[0][0].graceUntilIso).toBe(DETERMINISTIC_GRACE)
  })

  it("shortens a stored grace later than the deterministic deadline", async () => {
    const normalize = jest.fn(async () => ({ updated: true, error: null }))
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue("2026-08-15T18:00:00.000Z")],
      normalizePaidPastDueGrace: normalize,
    })
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> => ({ ok: true } as const)
    )

    await executeServiceSubscriptionLifecycleCron(queries, send, INSIDE_GRACE)
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({ graceUntilIso: DETERMINISTIC_GRACE })
    )
  })

  it("extends a stored grace earlier than the deterministic deadline", async () => {
    const normalize = jest.fn(async () => ({ updated: true, error: null }))
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue("2026-08-07T18:00:00.000Z")],
      normalizePaidPastDueGrace: normalize,
    })
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> => ({ ok: true } as const)
    )

    await executeServiceSubscriptionLifecycleCron(queries, send, INSIDE_GRACE)
    expect(normalize).toHaveBeenCalledWith(
      expect.objectContaining({ graceUntilIso: DETERMINISTIC_GRACE })
    )
  })

  it("locks at the deterministic deadline and does not gift a fresh 3 days", async () => {
    const lock = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_lock" } as const)
    )
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue("2026-08-15T18:00:00.000Z")],
      lockPaidPastDueBeyondGrace: lock,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, AT_DEADLINE)

    expect(summary.paidPastDueLocked).toBe(1)
    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedStatus: "past_due",
        expectedPeriodEndsAt: PERIOD_END,
        graceUntilIso: DETERMINISTIC_GRACE,
      })
    )
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "subscription_locked",
        lifecycleKey: `${PERIOD_END}|biz-paid-pd`,
      })
    )
  })

  it("locks a long-expired paid past_due without granting fresh grace from cron time", async () => {
    const lock = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_late" } as const)
    )
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue(null)],
      lockPaidPastDueBeyondGrace: lock,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, LONG_EXPIRED)
    expect(summary.paidPastDueLocked).toBe(1)
    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({ graceUntilIso: DETERMINISTIC_GRACE })
    )
  })

  it("is idempotent when stored grace is already the deterministic deadline", async () => {
    const normalize = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> => ({ ok: true } as const)
    )
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue(DETERMINISTIC_GRACE)],
      normalizePaidPastDueGrace: normalize,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, INSIDE_GRACE)
    expect(summary.paidPastDueNormalized).toBe(0)
    expect(normalize).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it("does not process billing_exempt or archived rows because they are excluded from the list", async () => {
    const normalize = jest.fn(async () => ({ updated: true, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> => ({ ok: true } as const)
    )
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [],
      normalizePaidPastDueGrace: normalize,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, INSIDE_GRACE)
    expect(summary.paidPastDueChecked).toBe(0)
    expect(normalize).not.toHaveBeenCalled()
  })

  it("does not overwrite a concurrent successful renewal", async () => {
    const lock = jest.fn(async () => ({ updated: false, error: null }))
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_race_pd" } as const)
    )
    const queries = emptyQueries({
      listPaidPastDueSubscriptions: async () => [paidPastDue("2026-08-15T18:00:00.000Z")],
      lockPaidPastDueBeyondGrace: lock,
    })

    const summary = await executeServiceSubscriptionLifecycleCron(queries, send, AT_DEADLINE)
    expect(summary.paidPastDueLocked).toBe(0)
    expect(summary.lockedNotified).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it("sends grace-start then lock once each for the same paid period", async () => {
    const send = jest.fn(
      async (): Promise<SendSubscriptionLifecycleNotificationResult> =>
        ({ ok: true, providerMessageId: "re_seq" } as const)
    )
    const transition = jest.fn(async () => ({ updated: true, error: null }))
    const lock = jest.fn(async () => ({ updated: true, error: null }))

    const t0 = new Date("2026-08-06T19:00:00.000Z")
    const t0Repeat = t0
    const tLock = new Date("2026-08-09T18:00:00.000Z")

    const first = emptyQueries({
      listExpiredPaidActiveSubscriptions: async () => [
        {
          id: "biz-seq",
          service_subscription_status: "active",
          current_period_ends_at: PERIOD_END,
        },
      ],
      transitionExpiredPaidToPastDue: transition,
    })
    const firstRepeat = emptyQueries({
      listPaidPastDueSubscriptions: async () => [
        {
          id: "biz-seq",
          service_subscription_status: "past_due",
          current_period_ends_at: PERIOD_END,
          subscription_grace_until: DETERMINISTIC_GRACE,
        },
      ],
      normalizePaidPastDueGrace: async () => ({ updated: true, error: null }),
    })
    const lockPass = emptyQueries({
      listPaidPastDueSubscriptions: async () => [
        {
          id: "biz-seq",
          service_subscription_status: "past_due",
          current_period_ends_at: PERIOD_END,
          subscription_grace_until: DETERMINISTIC_GRACE,
        },
      ],
      lockPaidPastDueBeyondGrace: lock,
    })
    const lockRepeat = emptyQueries({
      listPaidPastDueSubscriptions: async () => [],
    })

    const s1 = await executeServiceSubscriptionLifecycleCron(first, send, t0)
    const s2 = await executeServiceSubscriptionLifecycleCron(firstRepeat, send, t0Repeat)
    const s3 = await executeServiceSubscriptionLifecycleCron(lockPass, send, tLock)
    const s4 = await executeServiceSubscriptionLifecycleCron(lockRepeat, send, tLock)

    expect(s1.paidGraceStartedNotified).toBe(1)
    expect(s2.paidPastDueNormalized).toBe(0)
    expect(s3.paidPastDueLocked).toBe(1)
    expect(s3.lockedNotified).toBe(1)
    expect(s4.paidPastDueLocked).toBe(0)

    const graceSends = send.mock.calls.filter(
      (c) => c[0].eventType === "subscription_period_expired_grace_started"
    )
    const lockSends = send.mock.calls.filter((c) => c[0].eventType === "subscription_locked")
    expect(graceSends).toHaveLength(1)
    expect(lockSends).toHaveLength(1)
    expect(graceSends[0][0].lifecycleKey).toBe(`${PERIOD_END}|biz-seq`)
    expect(lockSends[0][0].lifecycleKey).toBe(`${PERIOD_END}|biz-seq`)
    expect(graceSends[0][0].lifecycleKey).toBe(lockSends[0][0].lifecycleKey)
  })
})

describe("paid past_due mutation race guards", () => {
  it("requires matching id, past_due status, period end, non-exempt, and not archived", async () => {
    const chain: Record<string, unknown> = {}
    const eq = jest.fn(() => chain)
    const is = jest.fn(() => chain)
    const select = jest.fn().mockResolvedValue({ data: [], error: null })
    chain.eq = eq
    chain.is = is
    chain.select = select
    const update = jest.fn().mockReturnValue(chain)
    const supabase = {
      from: jest.fn(() => ({ update })),
    }
    const queries = createSubscriptionLifecycleCronQueries(supabase as never)
    const now = new Date("2026-08-09T18:00:00.000Z")
    const result = await queries.lockPaidPastDueBeyondGrace({
      businessId: "biz-guard",
      expectedStatus: "past_due",
      expectedPeriodEndsAt: "2026-08-06T18:00:00.000Z",
      graceUntilIso: "2026-08-09T18:00:00.000Z",
      now,
    })

    expect(result.updated).toBe(false)
    expect(eq.mock.calls).toEqual(
      expect.arrayContaining([
        ["id", "biz-guard"],
        ["service_subscription_status", "past_due"],
        ["current_period_ends_at", "2026-08-06T18:00:00.000Z"],
        ["billing_exempt", false],
      ])
    )
    expect(is).toHaveBeenCalledWith("archived_at", null)
  })
})
