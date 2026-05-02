/**
 * Paystack subscription verify fallback + MTN sandbox isolation.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { paystackVerifyTransaction } from "@/lib/payments/subscriptionGateway/paystackProvider"
import { mtnMomoSandboxVerifyAndApplySubscription } from "@/lib/payments/subscriptionGateway/mtnMomoSandboxProvider"
import { applyPaystackSubscriptionWebhook } from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"
import { verifyServiceSubscriptionPayment } from "@/lib/payments/subscriptionGateway/verifyServiceSubscription"

jest.mock("@/lib/payments/subscriptionGateway/paystackProvider", () => ({
  paystackVerifyTransaction: jest.fn(),
}))

jest.mock("@/lib/payments/subscriptionGateway/mtnMomoSandboxProvider", () => ({
  mtnMomoSandboxVerifyAndApplySubscription: jest.fn(),
}))

jest.mock("@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook", () => ({
  FINZA_PAYSTACK_METADATA_PURPOSE_KEY: "finza_purpose",
  FINZA_PAYSTACK_SUBSCRIPTION_PURPOSE: "service_subscription",
  isPaystackServiceSubscriptionMetadata: (meta: Record<string, unknown> | null | undefined) =>
    meta != null &&
    typeof meta === "object" &&
    String((meta as Record<string, unknown>).finza_purpose).trim() === "service_subscription",
  parseDeclaredSubscriptionTier: (raw: string | undefined) => {
    if (!raw || typeof raw !== "string") return null
    const n = raw.trim().toLowerCase()
    if (n === "starter" || n === "essentials") return "starter"
    if (n === "professional" || n === "growth" || n === "pro") return "professional"
    if (n === "business" || n === "scale" || n === "enterprise") return "business"
    return null
  },
  applyPaystackSubscriptionWebhook: jest.fn(),
}))

const mockPaystackVerify = paystackVerifyTransaction as jest.MockedFunction<typeof paystackVerifyTransaction>
const mockMtn = mtnMomoSandboxVerifyAndApplySubscription as jest.MockedFunction<
  typeof mtnMomoSandboxVerifyAndApplySubscription
>
const mockApply = applyPaystackSubscriptionWebhook as jest.MockedFunction<typeof applyPaystackSubscriptionWebhook>

const supabase = {} as SupabaseClient
const BIZ = "11111111-1111-1111-1111-111111111111"

const validMeta = {
  finza_purpose: "service_subscription",
  business_id: BIZ,
  target_tier: "starter",
  billing_cycle: "monthly",
}

describe("verifyServiceSubscriptionPayment", () => {
  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy"
    jest.clearAllMocks()
  })

  it("Paystack success + valid service subscription metadata calls applyPaystackSubscriptionWebhook", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "success",
      amount: 149,
      metadata: validMeta,
      transactionId: "987654",
      reference: "FNZ-SUB-abc",
    })
    mockApply.mockResolvedValue({ handled: true, applied: true, message: "subscription activated" })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-abc",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith({
      reference: "FNZ-SUB-abc",
      status: "success",
      amountGhs: 149,
      transactionId: "987654",
      metadata: validMeta,
    })
    expect(out.status).toBe("success")
    expect(out.activation_applied).toBe(true)
    expect(out.activation_message).toBe("subscription activated")
  })

  it("webhook already processed -> verify fallback returns idempotent without calling activate twice (apply returns duplicate)", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "success",
      amount: 149,
      metadata: validMeta,
      transactionId: "987654",
    })
    mockApply.mockResolvedValue({
      handled: true,
      applied: false,
      message: "duplicate success (idempotent)",
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-dup",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(out.status).toBe("success")
    expect(out.activation_applied).toBe(false)
    expect(out.activation_message).toContain("duplicate")
    expect(out.activation_error).toBeUndefined()
  })

  it("Paystack success + missing metadata -> no activation via apply path returning early", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "success",
      amount: 149,
      metadata: null,
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-no-meta",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).not.toHaveBeenCalled()
    expect(out.status).toBe("success")
    expect(out.activation_applied).toBe(false)
    expect(out.activation_error).toBe("missing_or_invalid_subscription_metadata")
  })

  it("Paystack pending -> no activation", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "pending",
      amount: null,
      metadata: validMeta,
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-pending",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).not.toHaveBeenCalled()
    expect(out.status).toBe("pending")
    expect(out.activation_applied).toBeUndefined()
  })

  it("Paystack failed -> no activation", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "failed",
      amount: null,
      metadata: validMeta,
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-fail",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).not.toHaveBeenCalled()
    expect(out.status).toBe("failed")
  })

  it("Paystack abandoned -> no activation", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "abandoned",
      amount: null,
      metadata: validMeta,
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-abandon",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).not.toHaveBeenCalled()
    expect(out.status).toBe("abandoned")
    expect(out.activation_applied).toBeUndefined()
  })

  it("non-FNZ-SUB reference success -> no activation", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "success",
      amount: 149,
      metadata: validMeta,
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "OTHER-REF-123",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).not.toHaveBeenCalled()
    expect(out.status).toBe("success")
    expect(out.activation_applied).toBeUndefined()
  })

  it("Paystack success but apply refuses amount mismatch -> activation_applied false with error", async () => {
    mockPaystackVerify.mockResolvedValue({
      status: "success",
      amount: 149,
      metadata: validMeta,
      transactionId: "1",
    })
    mockApply.mockResolvedValue({
      handled: true,
      applied: false,
      message: "amount mismatch — refusing to activate subscription",
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-bad-amt",
      businessIdAccessCheck: BIZ,
    })

    expect(mockApply).toHaveBeenCalled()
    expect(out.activation_applied).toBe(false)
    expect(out.activation_error).toContain("amount mismatch")
  })

  it("MTN sandbox path unchanged (no Paystack verify, no Paystack apply)", async () => {
    mockMtn.mockResolvedValue({
      success: true,
      status: "success",
      applied: true,
      message: "mtn ok",
    })

    const out = await verifyServiceSubscriptionPayment({
      supabase,
      reference: "FNZ-SUB-MTN-xyz",
      businessIdAccessCheck: BIZ,
    })

    expect(mockPaystackVerify).not.toHaveBeenCalled()
    expect(mockApply).not.toHaveBeenCalled()
    expect(mockMtn).toHaveBeenCalled()
    expect(out).toEqual({ status: "success", applied: true, message: "mtn ok" })
    expect(out.activation_applied).toBeUndefined()
  })
})
