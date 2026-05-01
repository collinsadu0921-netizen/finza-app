import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { defaultSubscriptionProvider, resolveSubscriptionProvider } from "./providerRegistry"
import type { SubscriptionProviderId } from "./providers/types"
import type { BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"
import { activateServiceSubscription } from "@/lib/serviceWorkspace/activateServiceSubscription"

type CreateSubscriptionCheckoutInput = {
  businessId: string
  planTier: ServiceSubscriptionTier
  billingCycle: BillingCycle
  amount: number
  currency?: string
  provider?: SubscriptionProviderId
  metadata?: Record<string, unknown>
}

type SimulateMockOutcomeInput = {
  checkoutSessionId: string
  outcome: "success" | "failure"
  reason?: string
}

type VerifyCheckoutInput = {
  checkoutSessionId: string
  metadata?: Record<string, unknown>
}

async function activateSubscriptionIfNeeded(
  supabase: SupabaseClient,
  params: {
    businessId: string
    planTier: ServiceSubscriptionTier
    billingCycle: BillingCycle
    paidAt: string
    subscriptionNotificationLifecycleKey?: string
  }
): Promise<void> {
  const out = await activateServiceSubscription(supabase, {
    businessId: params.businessId,
    tier: params.planTier,
    cycle: params.billingCycle,
    paidAt: params.paidAt,
    subscriptionNotificationLifecycleKey: params.subscriptionNotificationLifecycleKey,
  })
  if (!out.ok) {
    throw new Error(out.error)
  }
}

export async function createSubscriptionCheckoutSession(
  supabase: SupabaseClient,
  input: CreateSubscriptionCheckoutInput
): Promise<
  | {
      ok: true
      checkoutSessionId: string
      paymentAttemptId: string
      provider: SubscriptionProviderId
      checkoutUrl: string | null
      status: "pending"
    }
  | { ok: false; error: string }
> {
  const providerId = input.provider ?? defaultSubscriptionProvider()
  const provider = resolveSubscriptionProvider(providerId)
  const currency = input.currency ?? "GHS"

  const create = await provider.createSubscriptionCheckout({
    businessId: input.businessId,
    planTier: input.planTier,
    billingCycle: input.billingCycle,
    amount: input.amount,
    currency,
    metadata: input.metadata,
  })

  if (!create.ok) return { ok: false, error: create.error }

  const { data: session, error: sessionErr } = await supabase
    .from("subscription_checkout_sessions")
    .insert({
      business_id: input.businessId,
      plan_tier: input.planTier,
      billing_cycle: input.billingCycle,
      amount: input.amount,
      currency,
      provider: providerId,
      provider_checkout_id: create.data.providerCheckoutId,
      provider_transaction_id: create.data.providerTransactionId ?? null,
      status: "pending",
      raw_provider_response: (create.data.rawProviderResponse as object) ?? {},
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single()

  if (sessionErr || !session) {
    return { ok: false, error: sessionErr?.message || "Failed to create subscription checkout session" }
  }

  const { data: attempt, error: attemptErr } = await supabase
    .from("subscription_payment_attempts")
    .insert({
      checkout_session_id: session.id,
      business_id: input.businessId,
      plan_tier: input.planTier,
      billing_cycle: input.billingCycle,
      amount: input.amount,
      currency,
      provider: providerId,
      provider_checkout_id: create.data.providerCheckoutId,
      provider_transaction_id: create.data.providerTransactionId ?? null,
      status: "pending",
      raw_provider_response: (create.data.rawProviderResponse as object) ?? {},
      metadata: input.metadata ?? {},
    })
    .select("id")
    .single()

  if (attemptErr || !attempt) {
    return { ok: false, error: attemptErr?.message || "Failed to create subscription payment attempt" }
  }

  return {
    ok: true,
    checkoutSessionId: session.id as string,
    paymentAttemptId: attempt.id as string,
    provider: providerId,
    checkoutUrl: create.data.checkoutUrl ?? null,
    status: "pending",
  }
}

export async function simulateMockSubscriptionOutcome(
  supabase: SupabaseClient,
  input: SimulateMockOutcomeInput
): Promise<
  | { ok: true; status: "paid" | "failed"; duplicatePrevented: boolean }
  | { ok: false; error: string }
> {
  const { data: session, error: sessionErr } = await supabase
    .from("subscription_checkout_sessions")
    .select("id, business_id, plan_tier, billing_cycle, status, provider, provider_checkout_id")
    .eq("id", input.checkoutSessionId)
    .maybeSingle()

  if (sessionErr || !session) return { ok: false, error: sessionErr?.message || "Checkout session not found" }
  if (session.provider !== "mock") return { ok: false, error: "Only mock sessions can be simulated" }

  if (session.status !== "pending") {
    return {
      ok: true,
      status: session.status === "paid" ? "paid" : "failed",
      duplicatePrevented: true,
    }
  }

  const now = new Date().toISOString()
  const nextStatus = input.outcome === "success" ? "paid" : "failed"

  await supabase
    .from("subscription_checkout_sessions")
    .update({
      status: nextStatus,
      paid_at: nextStatus === "paid" ? now : null,
      failed_at: nextStatus === "failed" ? now : null,
      updated_at: now,
    })
    .eq("id", session.id)
    .eq("status", "pending")

  await supabase
    .from("subscription_payment_attempts")
    .update({
      status: nextStatus,
      paid_at: nextStatus === "paid" ? now : null,
      failed_at: nextStatus === "failed" ? now : null,
      updated_at: now,
      metadata: { simulated_outcome: input.outcome, reason: input.reason ?? null },
    })
    .eq("checkout_session_id", session.id)
    .eq("status", "pending")

  await supabase.from("subscription_provider_events").insert({
    business_id: session.business_id,
    checkout_session_id: session.id,
    provider: "mock",
    provider_event_id: `mock_evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    provider_reference: session.provider_checkout_id,
    event_type: nextStatus === "paid" ? "mock.subscription.paid" : "mock.subscription.failed",
    processing_status: "processed",
    headers: {},
    payload: { simulated: true, outcome: input.outcome, reason: input.reason ?? null },
    metadata: {},
    received_at: now,
    processed_at: now,
  })

  if (nextStatus === "paid") {
    await activateSubscriptionIfNeeded(supabase, {
      businessId: session.business_id as string,
      planTier: session.plan_tier as ServiceSubscriptionTier,
      billingCycle: session.billing_cycle as BillingCycle,
      paidAt: now,
      subscriptionNotificationLifecycleKey: `checkout:${session.id}`,
    })
  }

  return { ok: true, status: nextStatus, duplicatePrevented: false }
}

export async function verifySubscriptionCheckout(
  supabase: SupabaseClient,
  input: VerifyCheckoutInput
): Promise<
  | { ok: true; status: "pending" | "paid" | "failed" | "cancelled" | "expired"; duplicatePrevented: boolean }
  | { ok: false; error: string }
> {
  const { data: session, error: sessionErr } = await supabase
    .from("subscription_checkout_sessions")
    .select("id, business_id, plan_tier, billing_cycle, status, provider, provider_checkout_id, provider_transaction_id")
    .eq("id", input.checkoutSessionId)
    .maybeSingle()

  if (sessionErr || !session) return { ok: false, error: sessionErr?.message || "Checkout session not found" }

  if (session.status !== "pending") {
    return { ok: true, status: session.status, duplicatePrevented: true }
  }

  const provider = resolveSubscriptionProvider(session.provider as SubscriptionProviderId)
  const verify = await provider.verifySubscriptionPayment({
    providerCheckoutId: session.provider_checkout_id,
    providerTransactionId: session.provider_transaction_id,
    providerReference: session.provider_checkout_id,
    metadata: input.metadata,
  })

  if (!verify.ok) return { ok: false, error: verify.error }

  const now = new Date().toISOString()
  const status = verify.data.status
  await supabase
    .from("subscription_checkout_sessions")
    .update({
      status,
      provider_transaction_id: verify.data.providerTransactionId ?? session.provider_transaction_id,
      paid_at: status === "paid" ? verify.data.paidAt ?? now : null,
      failed_at: status === "failed" ? now : null,
      raw_provider_response: (verify.data.rawProviderResponse as object) ?? {},
      updated_at: now,
    })
    .eq("id", session.id)
    .eq("status", "pending")

  await supabase
    .from("subscription_payment_attempts")
    .update({
      status,
      provider_transaction_id: verify.data.providerTransactionId ?? session.provider_transaction_id,
      paid_at: status === "paid" ? verify.data.paidAt ?? now : null,
      failed_at: status === "failed" ? now : null,
      raw_provider_response: (verify.data.rawProviderResponse as object) ?? {},
      updated_at: now,
    })
    .eq("checkout_session_id", session.id)
    .eq("status", "pending")

  if (status === "paid") {
    await activateSubscriptionIfNeeded(supabase, {
      businessId: session.business_id as string,
      planTier: session.plan_tier as ServiceSubscriptionTier,
      billingCycle: session.billing_cycle as BillingCycle,
      paidAt: verify.data.paidAt ?? now,
      subscriptionNotificationLifecycleKey: `checkout:${session.id}`,
    })
  }

  return { ok: true, status, duplicatePrevented: false }
}

