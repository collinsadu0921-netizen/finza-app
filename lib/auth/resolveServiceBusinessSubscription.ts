import {
  DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  parseServiceSubscriptionTier,
  tryParseServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import { tryParseBillingCycle, type BillingCycle } from "@/lib/serviceWorkspace/subscriptionPricing"

const TRIAL_MS = 14 * 24 * 60 * 60 * 1000

export type ServiceBusinessSubscriptionInsert = {
  service_subscription_tier: string
  service_subscription_status: string
  trial_started_at: string | null
  trial_ends_at: string | null
  /** Preferred billing cycle from marketing/signup; null until chosen or paid. */
  billing_cycle: string | null
  /**
   * Paid period end — only meaningful after Paystack activation.
   * Explicitly null for new trials so the row is not mistaken for an active paid period.
   */
  current_period_ends_at: string | null
  /** Paid subscription start — null until first successful payment. */
  subscription_started_at: string | null
}

function billingCycleFromUserMetadata(meta: Record<string, unknown>): BillingCycle | null {
  const raw =
    (typeof meta.signup_billing_cycle === "string" && meta.signup_billing_cycle) ||
    (typeof meta.trial_billing_cycle === "string" && meta.trial_billing_cycle) ||
    null
  return tryParseBillingCycle(raw)
}

/**
 * Derives `businesses` subscription columns from Supabase Auth `user_metadata`
 * only (never from request body). Used by the service business provision API.
 *
 * Rules:
 * - **Trial:** `trial_intent === true`, `trial_workspace === "service"`, and `trial_plan`
 *   parses via `tryParseServiceSubscriptionTier` → `trialing` + tier from `trial_plan`, with
 *   trial window dates set. `trial_plan` may be omitted in metadata only when other fields
 *   still satisfy the trial branch — callers should set `trial_plan` explicitly when known.
 * - **Non-trial:** tier from `signup_service_plan` only (via `tryParseServiceSubscriptionTier`);
 *   `trial_plan` is **not** used for tier outside the trial branch (spoof protection).
 * - **Fallback:** `starter` / `active` when no valid `signup_service_plan`.
 * - Unknown `trial_workspace` values do not enable the trial branch.
 * - **billing_cycle:** optional `signup_billing_cycle` / `trial_billing_cycle` in user_metadata
 *   (marketing query param) stored when valid; otherwise null.
 * - **current_period_ends_at:** not used for trial access (see `resolveServiceEntitlement`); kept
 *   null for new trials. Set when a paid subscription is activated via Paystack webhook.
 */
export function resolveServiceBusinessSubscriptionFromUserMetadata(
  meta: Record<string, unknown> | null | undefined
): ServiceBusinessSubscriptionInsert {
  const m = meta ?? {}
  const trialIntent = m.trial_intent === true
  const trialWorkspace = typeof m.trial_workspace === "string" ? m.trial_workspace : null
  const trialPlanRaw = typeof m.trial_plan === "string" ? m.trial_plan : null
  const signupPlanRaw = typeof m.signup_service_plan === "string" ? m.signup_service_plan : null
  const billingCycle = billingCycleFromUserMetadata(m)

  const now = new Date()
  const trialEnd = new Date(now.getTime() + TRIAL_MS)

  const isServiceTrial =
    trialIntent && trialWorkspace === "service" && tryParseServiceSubscriptionTier(trialPlanRaw) !== null

  if (isServiceTrial) {
    return {
      service_subscription_tier: parseServiceSubscriptionTier(trialPlanRaw),
      service_subscription_status: "trialing",
      trial_started_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      billing_cycle: billingCycle,
      current_period_ends_at: null,
      subscription_started_at: null,
    }
  }

  // Never use trial_plan for tier unless the full service trial branch matched above
  // (avoids granting a paid tier from manipulated trial_* metadata).
  const tierFromMeta = tryParseServiceSubscriptionTier(signupPlanRaw)

  return {
    service_subscription_tier: tierFromMeta ?? DEFAULT_SERVICE_SUBSCRIPTION_TIER,
    service_subscription_status: "active",
    trial_started_at: null,
    trial_ends_at: null,
    billing_cycle: billingCycle,
    current_period_ends_at: null,
    subscription_started_at: null,
  }
}
