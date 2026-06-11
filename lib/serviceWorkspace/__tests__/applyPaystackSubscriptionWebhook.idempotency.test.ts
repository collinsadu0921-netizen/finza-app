/**
 * applyPaystackSubscriptionWebhook idempotency — duplicate success must not re-activate.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"

jest.mock("@/lib/supabaseAdmin", () => ({
  createSupabaseAdminClient: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/activateServiceSubscription", () => ({
  activateServiceSubscription: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/loadBusinessBillingRow", () => ({
  isBusinessBillingExempt: jest.fn().mockResolvedValue(false),
}))

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { activateServiceSubscription } from "@/lib/serviceWorkspace/activateServiceSubscription"
import { applyPaystackSubscriptionWebhook } from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"

const BIZ = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

const meta = {
  finza_purpose: "service_subscription",
  business_id: BIZ,
  target_tier: "starter",
  billing_cycle: "monthly",
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(activateServiceSubscription).mockResolvedValue({ ok: true })
})

describe("applyPaystackSubscriptionWebhook idempotency", () => {
  it("skips activateServiceSubscription on duplicate success", async () => {
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "paystack_subscription_webhook_events") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: { outcome: "success" }, error: null }),
            upsert: jest.fn().mockResolvedValue({ error: null }),
          }
        }
        return {}
      }),
    }
    jest.mocked(createSupabaseAdminClient).mockReturnValue(supabase as never)

    const out = await applyPaystackSubscriptionWebhook({
      reference: "FNZ-SUB-dup",
      status: "success",
      amountGhs: 149,
      transactionId: "tx-dup",
      metadata: meta,
    })

    expect(out.handled).toBe(true)
    expect(out.applied).toBe(false)
    expect(out.message).toContain("duplicate")
    expect(activateServiceSubscription).not.toHaveBeenCalled()
  })
})
