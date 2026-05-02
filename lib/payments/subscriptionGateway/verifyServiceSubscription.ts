import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  applyPaystackSubscriptionWebhook,
  FINZA_PAYSTACK_METADATA_PURPOSE_KEY,
  isPaystackServiceSubscriptionMetadata,
  parseDeclaredSubscriptionTier,
} from "@/lib/serviceWorkspace/applyPaystackSubscriptionWebhook"
import { tryParseBillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import { paystackVerifyTransaction } from "./paystackProvider"
import { mtnMomoSandboxVerifyAndApplySubscription } from "./mtnMomoSandboxProvider"
import type { SubscriptionPaymentGatewayId } from "./types"

export function detectSubscriptionGatewayFromReference(reference: string): SubscriptionPaymentGatewayId {
  const r = reference.trim()
  if (r.startsWith("FNZ-SUB-MTN-")) return "mtn_momo_sandbox"
  return "paystack"
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (v == null) return ""
  return String(v).trim()
}

export type VerifyServiceSubscriptionPaymentResult = {
  status: string
  gateway_response?: string
  amount?: number | null
  message?: string
  applied?: boolean
  error?: string
  /** Paystack subscription verify only — webhook remains primary; this is an idempotent fallback. */
  activation_applied?: boolean
  activation_message?: string
  activation_error?: string
}

/**
 * Paystack: verifies transaction; on success for `FNZ-SUB-*`, idempotently applies subscription via
 * `applyPaystackSubscriptionWebhook` (same path as webhook). MTN sandbox: unchanged adapter behavior.
 */
export async function verifyServiceSubscriptionPayment(params: {
  supabase: SupabaseClient
  reference: string
  gateway?: SubscriptionPaymentGatewayId | null
  /** Required — must match Paystack metadata business_id for Paystack activation fallback. */
  businessIdAccessCheck?: string | null
}): Promise<VerifyServiceSubscriptionPaymentResult> {
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

  const base: VerifyServiceSubscriptionPaymentResult = {
    status: v.status,
    gateway_response: v.gateway_response,
    amount: v.amount ?? null,
    error: v.error,
  }

  if (v.status !== "success") {
    return base
  }

  if (!ref.startsWith("FNZ-SUB-")) {
    console.info("[subscription verify][paystack fallback]", {
      reference: ref,
      verifiedStatus: v.status,
      metadataPurpose: "(skipped)",
      activationOutcome: "not_fnz_sub_reference",
    })
    return base
  }

  const sessionBusinessId = params.businessIdAccessCheck?.trim()
  if (!sessionBusinessId) {
    return {
      ...base,
      activation_applied: false,
      activation_error: "business_id is required for subscription activation",
    }
  }

  const metadata = v.metadata
  const purposeLogged = metadata ? metaString(metadata, FINZA_PAYSTACK_METADATA_PURPOSE_KEY) : ""

  if (!metadata || !isPaystackServiceSubscriptionMetadata(metadata)) {
    console.info("[subscription verify][paystack fallback]", {
      reference: ref,
      verifiedStatus: v.status,
      metadataPurpose: purposeLogged || "(missing)",
      activationOutcome: "invalid_or_missing_subscription_metadata",
    })
    return {
      ...base,
      activation_applied: false,
      activation_error: "missing_or_invalid_subscription_metadata",
      activation_message:
        "Payment succeeded but subscription metadata was missing or invalid. Contact support if your plan does not update.",
    }
  }

  const metaBusinessId = metaString(metadata, "business_id")
  if (!metaBusinessId || metaBusinessId !== sessionBusinessId) {
    console.info("[subscription verify][paystack fallback]", {
      reference: ref,
      verifiedStatus: v.status,
      metadataPurpose: purposeLogged,
      activationOutcome: "metadata_business_mismatch",
    })
    return {
      ...base,
      activation_applied: false,
      activation_error: "metadata_business_mismatch",
      activation_message: "Payment metadata does not match the selected business.",
    }
  }

  if (!parseDeclaredSubscriptionTier(metaString(metadata, "target_tier"))) {
    console.info("[subscription verify][paystack fallback]", {
      reference: ref,
      verifiedStatus: v.status,
      metadataPurpose: purposeLogged,
      activationOutcome: "invalid_target_tier",
    })
    return {
      ...base,
      activation_applied: false,
      activation_error: "invalid_target_tier",
      activation_message: "Payment succeeded but target tier in metadata was invalid.",
    }
  }

  if (!tryParseBillingCycle(metaString(metadata, "billing_cycle"))) {
    console.info("[subscription verify][paystack fallback]", {
      reference: ref,
      verifiedStatus: v.status,
      metadataPurpose: purposeLogged,
      activationOutcome: "invalid_billing_cycle",
    })
    return {
      ...base,
      activation_applied: false,
      activation_error: "invalid_billing_cycle",
      activation_message: "Payment succeeded but billing cycle in metadata was invalid.",
    }
  }

  if (v.amount == null || Number.isNaN(Number(v.amount))) {
    console.info("[subscription verify][paystack fallback]", {
      reference: ref,
      verifiedStatus: v.status,
      metadataPurpose: purposeLogged,
      activationOutcome: "missing_amount",
    })
    return {
      ...base,
      activation_applied: false,
      activation_error: "missing_amount",
      activation_message: "Payment succeeded but amount could not be verified for activation.",
    }
  }

  const sub = await applyPaystackSubscriptionWebhook({
    reference: ref,
    status: "success",
    amountGhs: v.amount,
    transactionId: v.transactionId,
    metadata,
  })

  const dup =
    typeof sub.message === "string" &&
    (/duplicate success/i.test(sub.message) ||
      /idempotent/i.test(sub.message) ||
      /already succeeded/i.test(sub.message))

  const activationOutcome =
    sub.applied === true ? "activated" : dup ? "duplicate_idempotent" : sub.message || "not_applied"

  console.info("[subscription verify][paystack fallback]", {
    reference: ref,
    verifiedStatus: v.status,
    metadataPurpose: purposeLogged,
    activationOutcome,
  })

  if (!sub.handled) {
    return {
      ...base,
      activation_applied: false,
      activation_error: "subscription_webhook_handler_not_applied",
      activation_message: "Payment succeeded but subscription handler did not process this charge.",
    }
  }

  if (sub.applied === true) {
    return {
      ...base,
      activation_applied: true,
      activation_message: sub.message ?? "subscription activated",
    }
  }

  if (dup) {
    return {
      ...base,
      activation_applied: false,
      activation_message: sub.message ?? "duplicate success (idempotent)",
    }
  }

  return {
    ...base,
    activation_applied: false,
    activation_error: sub.message ?? "activation_failed",
    activation_message: sub.message,
  }
}
