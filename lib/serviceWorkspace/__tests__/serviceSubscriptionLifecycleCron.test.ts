/**
 * Service subscription lifecycle cron: windows, lock rules, resilience to send failures.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import {
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
})
