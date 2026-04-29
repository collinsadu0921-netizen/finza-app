import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

type ActivateInput = {
  businessId: string
  tier: ServiceSubscriptionTier
  cycle: BillingCycle
  paidAt?: string
}

function addCycle(baseIso: string, cycle: BillingCycle): string {
  const base = new Date(baseIso)
  if (cycle === "monthly") {
    base.setMonth(base.getMonth() + 1)
  } else if (cycle === "quarterly") {
    base.setMonth(base.getMonth() + 3)
  } else {
    base.setFullYear(base.getFullYear() + 1)
  }
  return base.toISOString()
}

/**
 * Canonical activation/renewal write for service subscriptions.
 * Keeps paid subscription fields aligned regardless of payment provider.
 */
export async function activateServiceSubscription(
  supabase: SupabaseClient,
  input: ActivateInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const paidAt = input.paidAt ?? new Date().toISOString()
  const nowIso = new Date().toISOString()

  const { data: business, error: loadErr } = await supabase
    .from("businesses")
    .select("id, subscription_started_at, current_period_ends_at")
    .eq("id", input.businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (loadErr || !business) {
    return { ok: false, error: loadErr?.message || "Business not found" }
  }

  const existingStart = business.subscription_started_at
    ? String(business.subscription_started_at)
    : null
  const existingPeriodEnd = business.current_period_ends_at
    ? String(business.current_period_ends_at)
    : null

  const renewalAnchor =
    existingPeriodEnd && new Date(existingPeriodEnd).getTime() > new Date(nowIso).getTime()
      ? existingPeriodEnd
      : nowIso
  const nextPeriodEnd = addCycle(renewalAnchor, input.cycle)

  const { error } = await supabase
    .from("businesses")
    .update({
      service_subscription_tier: input.tier,
      service_subscription_status: "active",
      subscription_grace_until: null,
      billing_cycle: input.cycle,
      // Preserve original subscription start date across renewals.
      subscription_started_at: existingStart ?? paidAt,
      // Renewal extends from later of now/payment time vs existing active period end.
      current_period_ends_at: nextPeriodEnd,
      trial_started_at: null,
      trial_ends_at: null,
      updated_at: nowIso,
    })
    .eq("id", input.businessId)
    .is("archived_at", null)

  if (error) return { ok: false, error: error.message || "Failed to activate subscription" }
  return { ok: true }
}

