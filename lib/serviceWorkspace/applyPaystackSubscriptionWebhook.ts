/**
 * Paystack webhooks for service workspace subscription (metadata.finza_purpose = service_subscription).
 * Uses service-role Supabase — call only from trusted server routes (e.g. verified webhooks).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { TIER_PRICING, type BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { activateServiceSubscription } from "@/lib/serviceWorkspace/activateServiceSubscription"
import { sendSubscriptionLifecycleNotification } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"

export const FINZA_PAYSTACK_METADATA_PURPOSE_KEY = "finza_purpose"
export const FINZA_PAYSTACK_SUBSCRIPTION_PURPOSE = "service_subscription"

const GRACE_MS = 3 * 24 * 60 * 60 * 1000

const BILLING_CYCLES: BillingCycle[] = ["monthly", "quarterly", "annual"]

function parseBillingCycle(raw: string | undefined): BillingCycle | null {
  if (!raw || typeof raw !== "string") return null
  const n = raw.trim().toLowerCase()
  return BILLING_CYCLES.includes(n as BillingCycle) ? (n as BillingCycle) : null
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const v = meta[key]
  if (v == null) return ""
  return String(v).trim()
}

/** Tier the customer paid for — invalid / missing returns null (do not default). */
export function parseDeclaredSubscriptionTier(raw: string | undefined): ServiceSubscriptionTier | null {
  if (!raw || typeof raw !== "string") return null
  const n = raw.trim().toLowerCase()
  if (n === "starter" || n === "essentials") return "starter"
  if (n === "professional" || n === "growth" || n === "pro") return "professional"
  if (n === "business" || n === "scale" || n === "enterprise") return "business"
  return null
}

export function isPaystackServiceSubscriptionMetadata(
  meta: Record<string, unknown> | null | undefined
): boolean {
  if (!meta || typeof meta !== "object") return false
  return metaString(meta as Record<string, unknown>, FINZA_PAYSTACK_METADATA_PURPOSE_KEY) === FINZA_PAYSTACK_SUBSCRIPTION_PURPOSE
}

function expectedAmountGhs(cycle: BillingCycle, tier: ServiceSubscriptionTier): number {
  return TIER_PRICING[cycle][tier]
}

function amountsMatch(expected: number, paid: number | undefined): boolean {
  if (paid == null || Number.isNaN(paid)) return false
  return Math.abs(expected - paid) < 0.02
}

type WebhookStatus = "success" | "failed" | "pending"

export type PaystackSubscriptionWebhookInput = {
  reference: string
  status: WebhookStatus
  amountGhs?: number
  transactionId?: string
  metadata: Record<string, unknown>
}

/**
 * @returns handled true when metadata identifies a subscription charge (even if ignored as duplicate/pending).
 */
export async function applyPaystackSubscriptionWebhook(
  input: PaystackSubscriptionWebhookInput
): Promise<{ handled: boolean; applied?: boolean; message?: string }> {
  const { reference, status, amountGhs, transactionId, metadata } = input

  if (!isPaystackServiceSubscriptionMetadata(metadata)) {
    return { handled: false }
  }

  const businessId = metaString(metadata, "business_id")
  if (!businessId) {
    return { handled: true, message: "missing business_id in metadata" }
  }

  const cycle = parseBillingCycle(metaString(metadata, "billing_cycle"))
  if (!cycle) {
    return { handled: true, message: "invalid billing_cycle in metadata" }
  }

  const tier = parseDeclaredSubscriptionTier(metaString(metadata, "target_tier"))
  if (!tier) {
    return { handled: true, message: "invalid or missing target_tier in metadata" }
  }

  const expected = expectedAmountGhs(cycle, tier)

  if (status === "pending") {
    return { handled: true, message: "subscription charge pending — no DB update" }
  }

  if (status === "success" && !amountsMatch(expected, amountGhs)) {
    console.warn("[paystack subscription] amount mismatch", {
      reference,
      expected,
      amountGhs,
      tier,
      cycle,
    })
    return {
      handled: true,
      message: "amount mismatch — refusing to activate subscription",
    }
  }

  const supabase = createSupabaseAdminClient() as SupabaseClient

  const { data: existing } = await supabase
    .from("paystack_subscription_webhook_events")
    .select("outcome")
    .eq("reference", reference)
    .maybeSingle()

  const existingRow = existing as { outcome?: string } | null

  if (existingRow?.outcome === "success" && status === "failed") {
    return { handled: true, applied: false, message: "already succeeded — ignoring failure" }
  }

  if (existingRow?.outcome === "success" && status === "success") {
    return { handled: true, applied: false, message: "duplicate success (idempotent)" }
  }

  if (existingRow?.outcome === "failed" && status === "failed") {
    return { handled: true, applied: false, message: "duplicate failure (idempotent)" }
  }

  if (status === "success") {
    const nowIso = new Date().toISOString()
    const activated = await activateServiceSubscription(supabase, {
      businessId,
      tier,
      cycle,
      paidAt: nowIso,
      subscriptionNotificationLifecycleKey: reference,
    })
    if (!activated.ok) {
      console.error("[paystack subscription] business update error:", activated.error)
      return { handled: true, message: activated.error }
    }

    await supabase.from("paystack_subscription_webhook_events").upsert(
      {
        reference,
        business_id: businessId,
        outcome: "success",
        paystack_transaction_id: transactionId ?? null,
        target_tier: tier,
        billing_cycle: cycle,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "reference" }
    )

    return { handled: true, applied: true, message: "subscription activated" }
  }

  const graceEnd = new Date(Date.now() + GRACE_MS).toISOString()
  const { error: failErr } = await supabase
    .from("businesses")
    .update({
      service_subscription_status: "past_due",  // payment failed; grace window open
      subscription_grace_until:    graceEnd,
      updated_at:                  new Date().toISOString(),
    })
    .eq("id", businessId)
    .is("archived_at", null)

  if (failErr) {
    console.error("[paystack subscription] grace update error:", failErr)
    return { handled: true, message: failErr.message }
  }

  await supabase.from("paystack_subscription_webhook_events").upsert(
    {
      reference,
      business_id: businessId,
      outcome: "failed",
      paystack_transaction_id: transactionId ?? null,
      target_tier: tier,
      billing_cycle: cycle,
      processed_at: new Date().toISOString(),
    },
    { onConflict: "reference" }
  )

  void sendSubscriptionLifecycleNotification({
    businessId,
    eventType: "payment_failed_grace_started",
    lifecycleKey: `${graceEnd}|${reference}`,
    metadata: { reference },
  }).catch((err) => {
    console.error("[paystack subscription] payment_failed_grace_started email:", err)
  })

  return { handled: true, applied: true, message: "subscription payment failed — grace period set" }
}
