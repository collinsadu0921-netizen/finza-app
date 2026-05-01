/**
 * Paystack subscription webhook: failure path triggers payment_failed_grace_started notification (non-blocking).
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification", () => ({
  sendSubscriptionLifecycleNotification: jest.fn().mockResolvedValue({ ok: true }),
}))

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { sendSubscriptionLifecycleNotification } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"
import { applyPaystackSubscriptionWebhook } from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"

const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

beforeEach(() => {
  jest.mocked(sendSubscriptionLifecycleNotification).mockClear()
})

function buildWebhookSupabase(existingOutcome: string | null) {
  const upsert = jest.fn().mockResolvedValue({ error: null })
  const update = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      is: jest.fn().mockResolvedValue({ error: null }),
    }),
  })

  return {
    from: jest.fn((table: string) => {
      if (table === "paystack_subscription_webhook_events") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue(
            existingOutcome ? { data: { outcome: existingOutcome }, error: null } : { data: null, error: null }
          ),
          upsert,
        }
      }
      if (table === "businesses") {
        return { update }
      }
      return {}
    }),
  }
}

describe("applyPaystackSubscriptionWebhook subscription emails", () => {
  it("invokes payment_failed_grace_started after grace update on failed charge", async () => {
    const supabase = buildWebhookSupabase(null)
    jest.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never)

    const meta = {
      finza_purpose: "service_subscription",
      business_id: BIZ,
      billing_cycle: "monthly",
      target_tier: "professional",
    }

    const out = await applyPaystackSubscriptionWebhook({
      reference: "ref_fail_1",
      status: "failed",
      amountGhs: 1,
      transactionId: "tx1",
      metadata: meta,
    })

    expect(out.handled).toBe(true)
    expect(sendSubscriptionLifecycleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ,
        eventType: "payment_failed_grace_started",
      })
    )
    const call = jest.mocked(sendSubscriptionLifecycleNotification).mock.calls[0][0]
    expect(call.lifecycleKey).toContain("ref_fail_1")
  })
})
