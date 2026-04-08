import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { paystackVerifyTransaction } from "./paystackProvider"
import { mtnMomoSandboxVerifyAndApplySubscription } from "./mtnMomoSandboxProvider"
import type { SubscriptionPaymentGatewayId } from "./types"

export function detectSubscriptionGatewayFromReference(reference: string): SubscriptionPaymentGatewayId {
  const r = reference.trim()
  if (r.startsWith("FNZ-SUB-MTN-")) return "mtn_momo_sandbox"
  return "paystack"
}

/**
 * Paystack: polling only (subscription activation stays on webhook, unchanged).
 * MTN sandbox: server verify + applyPaystackSubscriptionWebhook inside the MTN adapter.
 */
export async function verifyServiceSubscriptionPayment(params: {
  supabase: SupabaseClient
  reference: string
  gateway?: SubscriptionPaymentGatewayId | null
  /** Required for MTN path — must match payment_provider_transactions.business_id */
  businessIdAccessCheck?: string | null
}): Promise<{
  status: string
  gateway_response?: string
  amount?: number | null
  message?: string
  applied?: boolean
  error?: string
}> {
  const ref = params.reference.trim()
  if (!ref) {
    return { status: "error", error: "reference is required" }
  }

  const gateway = params.gateway?.trim() || detectSubscriptionGatewayFromReference(ref)

  if (gateway === "mtn_momo_sandbox") {
    if (!params.businessIdAccessCheck?.trim()) {
      return { status: "error", error: "business_id is required for MTN subscription verify" }
    }
    const out = await mtnMomoSandboxVerifyAndApplySubscription(params.supabase, ref, {
      businessIdMustMatch: params.businessIdAccessCheck.trim(),
    })
    if (!out.success) {
      return { status: "error", error: out.error }
    }
    return {
      status: out.status,
      message: out.message,
      applied: out.applied,
    }
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return { status: "pending", error: "Paystack not configured" }
  }

  const v = await paystackVerifyTransaction(secretKey, ref)

  return {
    status: v.status,
    gateway_response: v.gateway_response,
    amount: v.amount ?? null,
    error: v.error,
  }
}
