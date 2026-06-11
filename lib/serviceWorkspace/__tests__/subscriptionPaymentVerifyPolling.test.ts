/**
 * Paystack subscription verify polling (card callback + MoMo success).
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals"
import {
  buildSubscriptionVerifyUrl,
  interpretSubscriptionVerifySuccess,
  pollSubscriptionPaymentVerify,
  shouldConfirmPaystackSubscriptionViaVerify,
} from "@/lib/serviceWorkspace/subscriptionPaymentVerifyPolling"

const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const REF = "FNZ-SUB-momo-test"

describe("shouldConfirmPaystackSubscriptionViaVerify", () => {
  it("returns true for Paystack MoMo immediate success", () => {
    expect(shouldConfirmPaystackSubscriptionViaVerify("success")).toBe(true)
    expect(shouldConfirmPaystackSubscriptionViaVerify("SUCCESS")).toBe(true)
  })

  it("returns true for Paystack OTP submit success (same terminal status)", () => {
    expect(shouldConfirmPaystackSubscriptionViaVerify("success")).toBe(true)
  })

  it("returns false for pending/pay_offline/failed", () => {
    expect(shouldConfirmPaystackSubscriptionViaVerify("pending")).toBe(false)
    expect(shouldConfirmPaystackSubscriptionViaVerify("pay_offline")).toBe(false)
    expect(shouldConfirmPaystackSubscriptionViaVerify("failed")).toBe(false)
  })
})

describe("buildSubscriptionVerifyUrl", () => {
  it("builds verify URL with reference and business_id", () => {
    expect(buildSubscriptionVerifyUrl(REF, BIZ)).toBe(
      `/api/payments/subscription/verify?reference=${encodeURIComponent(REF)}&business_id=${encodeURIComponent(BIZ)}`
    )
  })
})

describe("pollSubscriptionPaymentVerify", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("Paystack MoMo immediate success polls verify until Paystack reports success", async () => {
    const fetchFn = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        json: async () => ({ status: "pending" }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({
          status: "success",
          activation_applied: true,
          activation_message: "subscription activated",
        }),
      } as Response)

    const outcome = await pollSubscriptionPaymentVerify({
      reference: REF,
      businessId: BIZ,
      fetchFn,
      maxAttempts: 5,
      intervalMs: 0,
      sleep: async () => {},
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[0][0]).toBe(buildSubscriptionVerifyUrl(REF, BIZ))
    expect(outcome.kind).toBe("activated")
    if (outcome.kind === "activated") {
      expect(outcome.toastType).toBe("success")
      expect(outcome.message).toContain("plan has been updated")
    }
  })

  it("duplicate idempotent verify does not imply a second activation extend", async () => {
    const fetchFn = jest.fn<typeof fetch>().mockResolvedValue({
      json: async () => ({
        status: "success",
        activation_applied: false,
        activation_message: "duplicate success (idempotent)",
      }),
    } as Response)

    const outcome = await pollSubscriptionPaymentVerify({
      reference: REF,
      businessId: BIZ,
      fetchFn,
      maxAttempts: 1,
      intervalMs: 0,
      sleep: async () => {},
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(outcome.kind).toBe("activated")
    if (outcome.kind === "activated") {
      expect(outcome.message).toContain("plan is active")
    }
  })
})

describe("interpretSubscriptionVerifySuccess", () => {
  it("maps activation_applied true to updated plan message", () => {
    const out = interpretSubscriptionVerifySuccess(
      { status: "success", activation_applied: true },
      REF
    )
    expect(out.toastType).toBe("success")
    expect(out.message).toContain("updated")
  })
})
