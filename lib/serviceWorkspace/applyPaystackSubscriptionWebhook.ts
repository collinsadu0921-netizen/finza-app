/**
 * Paystack webhooks for service workspace subscription (metadata.finza_purpose = service_subscription).
 * Uses service-role Supabase — call only from trusted server routes (e.g. verified webhooks).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { TIER_PRICING, type BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import {
  parseServiceSubscriptionStatus,
  type ServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import { activateServiceSubscription } from "@/lib/serviceWorkspace/activateServiceSubscription"
import {
  isBusinessBillingExempt,
  loadBusinessSubscriptionRow,
} from "@/lib/serviceWorkspace/loadBusinessBillingRow"
import { sendSubscriptionLifecycleNotification } from "@/lib/serviceWorkspace/sendSubscriptionLifecycleNotification"
import {
  deterministicPaidGraceEnd,
  lifecycleKeyPaidPeriod,
  resolvePaidPeriodClock,
} from "@/lib/serviceWorkspace/paidSubscriptionPeriod"

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

  if (await isBusinessBillingExempt(supabase, businessId)) {
    return { handled: true, applied: false, message: "billing_exempt — subscription webhook ignored" }
  }

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

  const row = await loadBusinessSubscriptionRow(supabase, businessId)
  const now = new Date()
  const subscriptionStartedAt = row.subscription_started_at
    ? new Date(row.subscription_started_at)
    : null
  const periodEndsAtRaw = row.current_period_ends_at
    ? String(row.current_period_ends_at)
    : null
  const periodEndsAt = periodEndsAtRaw ? new Date(periodEndsAtRaw) : null
  const rowStatus = parseServiceSubscriptionStatus(row.service_subscription_status)
  const paid = resolvePaidPeriodClock({
    now,
    subscriptionStartedAt,
    periodEndsAt,
    status: rowStatus,
  })

  const recordFailureEvent = async () => {
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
  }

  if (paid.isPaidWithKnownPeriod && periodEndsAt && periodEndsAtRaw) {
    const graceEnd = paid.deterministicPaidGraceEnd ?? deterministicPaidGraceEnd(periodEndsAt)
    const graceEndIso = graceEnd.toISOString()

    if (now.getTime() < periodEndsAt.getTime()) {
      await recordFailureEvent()
      return {
        handled: true,
        applied: true,
        message: "renewal failed — paid period still valid",
      }
    }

    const nextStatus = now.getTime() < graceEnd.getTime() ? "past_due" : "locked"
    const { data: failRows, error: failErr } = await supabase
      .from("businesses")
      .update({
        service_subscription_status: nextStatus,
        subscription_grace_until: graceEndIso,
        updated_at: now.toISOString(),
      })
      .eq("id", businessId)
      .eq("current_period_ends_at", periodEndsAtRaw)
      .eq("billing_exempt", false)
      .is("archived_at", null)
      .select("id")

    if (failErr) {
      console.error("[paystack subscription] paid failure update error:", failErr)
      return { handled: true, message: failErr.message }
    }

    await recordFailureEvent()

    if (Array.isArray(failRows) && failRows.length > 0) {
      if (nextStatus === "past_due") {
        void sendSubscriptionLifecycleNotification({
          businessId,
          eventType: "payment_failed_grace_started",
          lifecycleKey: lifecycleKeyPaidPeriod(periodEndsAtRaw, businessId),
          metadata: { reference },
        }).catch((err) => {
          console.error("[paystack subscription] payment_failed_grace_started email:", err)
        })
      } else {
        void sendSubscriptionLifecycleNotification({
          businessId,
          eventType: "subscription_locked",
          lifecycleKey: lifecycleKeyPaidPeriod(periodEndsAtRaw, businessId),
          metadata: { reference },
        }).catch((err) => {
          console.error("[paystack subscription] subscription_locked email:", err)
        })
      }
    }

    return {
      handled: true,
      applied: true,
      message:
        nextStatus === "past_due"
          ? "subscription payment failed — deterministic paid grace set"
          : "subscription payment failed — paid grace expired",
    }
  }

  const graceEnd = new Date(now.getTime() + GRACE_MS).toISOString()
  const { error: failErr } = await supabase
    .from("businesses")
    .update({
      service_subscription_status: "past_due",
      subscription_grace_until: graceEnd,
      updated_at: now.toISOString(),
    })
    .eq("id", businessId)
    .is("archived_at", null)

  if (failErr) {
    console.error("[paystack subscription] grace update error:", failErr)
    return { handled: true, message: failErr.message }
  }

  await recordFailureEvent()

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
