/**
 * activateServiceSubscription fires subscription_reactivated email after successful DB update (non-blocking).
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"

jest.mock("@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification", () => ({
  sendSubscriptionLifecycleNotification: jest.fn().mockResolvedValue({ ok: true }),
}))

import { sendSubscriptionLifecycleNotification } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"
import { activateServiceSubscription } from "@/lib/serviceWorkspace/activateServiceSubscription"

const BIZ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

beforeEach(() => {
  jest.mocked(sendSubscriptionLifecycleNotification).mockClear()
})

describe("activateServiceSubscription notification", () => {
  it("schedules subscription_reactivated after successful update", async () => {
    let updated = false
    let bizFromCalls = 0
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "businesses") {
          bizFromCalls += 1
          if (bizFromCalls === 1) {
            return {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              is: jest.fn().mockReturnThis(),
              maybeSingle: jest.fn().mockResolvedValue({
                data: {
                  id: BIZ,
                  subscription_started_at: null,
                  current_period_ends_at: null,
                },
                error: null,
              }),
            }
          }
          return {
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                is: jest.fn().mockImplementation(() => {
                  updated = true
                  return Promise.resolve({ error: null })
                }),
              }),
            }),
          }
        }
        return {}
      }),
    } as never

    const out = await activateServiceSubscription(supabase, {
      businessId: BIZ,
      tier: "starter",
      cycle: "monthly",
      paidAt: "2026-05-01T12:00:00.000Z",
      subscriptionNotificationLifecycleKey: "paystack-ref-xyz",
    })

    expect(out.ok).toBe(true)
    expect(updated).toBe(true)

    expect(sendSubscriptionLifecycleNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ,
        eventType: "subscription_reactivated",
        lifecycleKey: "paystack-ref-xyz",
      })
    )
  })
})
