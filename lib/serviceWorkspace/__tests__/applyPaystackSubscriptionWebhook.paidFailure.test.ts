/**
 * Paid-renewal failure must use current_period_ends_at + 3 days
 * and must never slide that deadline forward.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals"

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/activateServiceSubscription", () => ({
  activateServiceSubscription: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification", () => ({
  sendSubscriptionLifecycleNotification: jest.fn().mockResolvedValue({ ok: true }),
}))

jest.mock("@/lib/serviceWorkspace/loadBusinessBillingRow", () => ({
  isBusinessBillingExempt: jest.fn().mockResolvedValue(false),
  loadBusinessSubscriptionRow: jest.fn(),
}))

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { activateServiceSubscription } from "@/lib/serviceWorkspace/activateServiceSubscription"
import { sendSubscriptionLifecycleNotification } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"
import { loadBusinessSubscriptionRow } from "@/lib/serviceWorkspace/loadBusinessBillingRow"
import { applyPaystackSubscriptionWebhook } from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"

const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const PERIOD_END = "2026-08-06T18:00:00.000Z"
const GRACE_END = "2026-08-09T18:00:00.000Z"

const meta = {
  finza_purpose: "service_subscription",
  business_id: BIZ,
  target_tier: "starter",
  billing_cycle: "monthly",
}

function buildSupabase(opts?: { updateData?: { id: string }[] }) {
  const upsert = jest.fn().mockResolvedValue({ error: null })
  const updatePayloads: Record<string, unknown>[] = []
  const updateEqs: Array<{ col: string; val: unknown }> = []
  const update = jest.fn().mockImplementation((payload: Record<string, unknown>) => {
    updatePayloads.push(payload)
    const chain: Record<string, unknown> = {}
    const eq = jest.fn().mockImplementation((col: string, val: unknown) => {
      updateEqs.push({ col, val })
      return chain
    })
    const is = jest.fn().mockImplementation(() => chain)
    const select = jest.fn().mockResolvedValue({
      data: opts?.updateData ?? [{ id: BIZ }],
      error: null,
    })
    chain.eq = eq
    chain.is = is
    chain.select = select
    return chain
  })

  return {
    supabase: {
      from: jest.fn((table: string) => {
        if (table === "paystack_subscription_webhook_events") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            upsert,
          }
        }
        if (table === "businesses") {
          return { update }
        }
        return {}
      }),
    },
    upsert,
    update,
    updatePayloads,
    updateEqs,
  }
}

const paidRow = {
  subscription_started_at: "2026-07-06T18:00:00.000Z",
  current_period_ends_at: PERIOD_END,
  service_subscription_status: "active",
}

describe("applyPaystackSubscriptionWebhook paid failure", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-08-07T18:00:00.000Z"))
    jest.mocked(activateServiceSubscription).mockResolvedValue({ ok: true })
    jest.mocked(loadBusinessSubscriptionRow).mockResolvedValue(paidRow)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("1. failed renewal after period expiry uses deterministic grace", async () => {
    const { supabase, updatePayloads } = buildSupabase()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never)

    const out = await applyPaystackSubscriptionWebhook({
      reference: "ref_fail_after",
      status: "failed",
      amountGhs: 149,
      metadata: meta,
    })

    expect(out.applied).toBe(true)
    expect(updatePayloads[0]?.service_subscription_status).toBe("past_due")
    expect(updatePayloads[0]?.subscription_grace_until).toBe(GRACE_END)
    expect(sendSubscriptionLifecycleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "payment_failed_grace_started",
        lifecycleKey: `${PERIOD_END}|${BIZ}`,
      })
    )
  })

  it("2. multiple failures do not move the grace deadline forward", async () => {
    const first = buildSupabase()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(first.supabase as never)
    await applyPaystackSubscriptionWebhook({
      reference: "ref_fail_a",
      status: "failed",
      amountGhs: 149,
      metadata: meta,
    })

    jest.setSystemTime(new Date("2026-08-08T18:00:00.000Z"))
    const second = buildSupabase()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(second.supabase as never)
    await applyPaystackSubscriptionWebhook({
      reference: "ref_fail_b",
      status: "failed",
      amountGhs: 149,
      metadata: meta,
    })

    expect(first.updatePayloads[0]?.subscription_grace_until).toBe(GRACE_END)
    expect(second.updatePayloads[0]?.subscription_grace_until).toBe(GRACE_END)
  })

  it("3. failure before paid-through date does not shorten already-paid access", async () => {
    jest.setSystemTime(new Date("2026-08-01T18:00:00.000Z"))
    const { supabase, update } = buildSupabase()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never)

    const out = await applyPaystackSubscriptionWebhook({
      reference: "ref_fail_before",
      status: "failed",
      amountGhs: 149,
      metadata: meta,
    })

    expect(out.message).toContain("paid period still valid")
    expect(update).not.toHaveBeenCalled()
    expect(sendSubscriptionLifecycleNotification).not.toHaveBeenCalled()
  })

  it("4. failure after deterministic grace does not grant fresh grace", async () => {
    jest.setSystemTime(new Date("2026-08-10T18:00:00.000Z"))
    const { supabase, updatePayloads } = buildSupabase()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never)

    const out = await applyPaystackSubscriptionWebhook({
      reference: "ref_fail_late",
      status: "failed",
      amountGhs: 149,
      metadata: meta,
    })

    expect(out.message).toContain("paid grace expired")
    expect(updatePayloads[0]?.service_subscription_status).toBe("locked")
    expect(updatePayloads[0]?.subscription_grace_until).toBe(GRACE_END)
    expect(sendSubscriptionLifecycleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "subscription_locked",
        lifecycleKey: `${PERIOD_END}|${BIZ}`,
      })
    )
  })

  it("5. successful renewal goes through activateServiceSubscription", async () => {
    const { supabase, update } = buildSupabase()
    jest.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never)

    const out = await applyPaystackSubscriptionWebhook({
      reference: "ref_ok",
      status: "success",
      amountGhs: 149,
      metadata: meta,
    })

    expect(out.applied).toBe(true)
    expect(activateServiceSubscription).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        businessId: BIZ,
        tier: "starter",
        cycle: "monthly",
        subscriptionNotificationLifecycleKey: "ref_ok",
      })
    )
    expect(update).not.toHaveBeenCalled()
  })
})
