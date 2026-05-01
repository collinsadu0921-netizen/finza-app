import {
  DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  parseServiceSubscriptionTier,
  tryParseServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"

const TRIAL_MS = 14 * 24 * 60 * 60 * 1000

export type ServiceBusinessSubscriptionInsert = {
  service_subscription_tier: string
  service_subscription_status: string
  trial_started_at: string | null
  trial_ends_at: string | null
}

/**
 * Derives `businesses` subscription columns from Supabase Auth `user_metadata`
 * only (never from request body). Used by the service business provision API.
 *
 * Rules:
 * - **Trial:** `trial_intent === true`, `trial_workspace === "service"`, and `trial_plan`
 *   parses via `tryParseServiceSubscriptionTier` → `trialing` + tier from `trial_plan`, with
 *   trial window dates set.
 * - **Non-trial:** tier from `signup_service_plan` only (via `tryParseServiceSubscriptionTier`);
 *   `trial_plan` is **not** used for tier outside the trial branch (spoof protection).
 * - **Fallback:** `starter` / `active` when no valid `signup_service_plan`.
 * - Unknown `trial_workspace` values do not enable the trial branch.
 */
export function resolveServiceBusinessSubscriptionFromUserMetadata(
  meta: Record<string, unknown> | null | undefined
): ServiceBusinessSubscriptionInsert {
  const m = meta ?? {}
  const trialIntent = m.trial_intent === true
  const trialWorkspace = typeof m.trial_workspace === "string" ? m.trial_workspace : null
  const trialPlanRaw = typeof m.trial_plan === "string" ? m.trial_plan : null
  const signupPlanRaw = typeof m.signup_service_plan === "string" ? m.signup_service_plan : null

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
  }
}
