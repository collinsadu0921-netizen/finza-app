/**
 * resolveServiceEntitlement
 * =============================================================================
 * Single source of truth for service workspace access decisions.
 *
 * Used by:
 *   - ServiceSubscriptionContext  (client — React context)
 *   - enforceServiceWorkspaceAccess (server — API route guard)
 *
 * Rule table:
 * ┌─────────────────────────────────────────────┬──────────────────────────┐
 * │ Condition                                   │ effectiveTier            │
 * ├─────────────────────────────────────────────┼──────────────────────────┤
 * │ status=trialing AND now < trial_ends_at     │ stored tier (full trial) │
 * │ status=trialing AND now ≥ trial_ends_at     │ starter (silent downgrade│
 * │ status=active                               │ stored tier              │
 * │ status=past_due  (grace window still open)  │ stored tier              │
 * │ status=locked    (grace window expired)     │ stored tier (blocked by  │
 * │                                             │ isSubscriptionLocked)    │
 * └─────────────────────────────────────────────┴──────────────────────────┘
 *
 * Trial expiry NEVER sets locked. After the trial ends the user keeps
 * Essentials (starter) access permanently. They see an upgrade CTA on any
 * page that requires a higher tier.
 *
 * MoMo payment grace (subscription_grace_until) is completely separate from
 * trial state — it is only set when a renewal payment fails on an active/paid
 * subscription.
 * =============================================================================
 */

import {
  type ServiceSubscriptionTier,
  type ServiceSubscriptionStatus,
  parseServiceSubscriptionTier,
  parseServiceSubscriptionStatus,
  tierIncludes,
} from "@/lib/serviceWorkspace/subscriptionTiers"

/** Raw columns fetched from public.businesses */
export type RawBusinessSubscriptionRow = {
  service_subscription_tier?:   string | null
  service_subscription_status?: string | null
  trial_started_at?:            string | null
  trial_ends_at?:               string | null
  subscription_grace_until?:    string | null
}

export type ServiceEntitlement = {
  /** Tier the user actually has access to (may differ from rawTier after trial expiry). */
  effectiveTier: ServiceSubscriptionTier
  /** Raw tier stored in DB — the plan they subscribed/trialled for. */
  rawTier: ServiceSubscriptionTier
  /** Parsed status column value. */
  status: ServiceSubscriptionStatus
  /** True when status=trialing AND trial_ends_at is in the future. */
  isTrialing: boolean
  /**
   * True when status=trialing AND trial_ends_at has passed.
   * effectiveTier will be 'starter' in this case.
   */
  trialExpired: boolean
  /** ISO date of trial end, or null if not on a trial. */
  trialEndsAt: Date | null
  /**
   * Whole days remaining in the trial (0 on the last day).
   * Null when not on an active trial.
   */
  trialDaysLeft: number | null
  /**
   * True when subscription_grace_until is set and in the future.
   * Means a renewal payment failed; the user still has access but sees a warning.
   */
  inGracePeriod: boolean
  /**
   * True when subscription_grace_until is set and has expired.
   * All paid-tier feature access is blocked until payment is resolved.
   */
  isSubscriptionLocked: boolean
}

/**
 * Compute the full entitlement state from raw DB columns.
 *
 * @param row   Raw columns from public.businesses
 * @param now   Current timestamp (injectable for testing; defaults to new Date())
 */
export function resolveServiceEntitlement(
  row: RawBusinessSubscriptionRow,
  now: Date = new Date()
): ServiceEntitlement {
  const rawTier    = parseServiceSubscriptionTier(row.service_subscription_tier)
  const status     = parseServiceSubscriptionStatus(row.service_subscription_status)
  const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null
  const graceUntil  = row.subscription_grace_until ? new Date(row.subscription_grace_until) : null

  // --- Trial state ---
  const isTrialing   = status === "trialing" && trialEndsAt !== null && now < trialEndsAt
  const trialExpired = status === "trialing" && trialEndsAt !== null && now >= trialEndsAt

  // --- Effective tier ---
  // During an active trial: full access up to rawTier.
  // After trial expiry without payment: silently downgrade to starter.
  //   (TierGate shows the normal upgrade wall if they hit a pro/business feature.)
  // Any other state: honour rawTier.
  const effectiveTier: ServiceSubscriptionTier = trialExpired ? "starter" : rawTier

  // --- Trial countdown ---
  const trialDaysLeft =
    isTrialing && trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) - 1)
      : null

  // --- MoMo payment grace (completely separate from trial) ---
  const inGracePeriod      = graceUntil !== null && now < graceUntil
  const isSubscriptionLocked = graceUntil !== null && now >= graceUntil

  return {
    effectiveTier,
    rawTier,
    status,
    isTrialing,
    trialExpired,
    trialEndsAt,
    trialDaysLeft,
    inGracePeriod,
    isSubscriptionLocked,
  }
}

/**
 * Convenience: returns true when `effectiveTier` satisfies `required`.
 * Drop-in replacement for calls that previously compared rawTier directly.
 */
export function entitlementIncludesTier(
  entitlement: ServiceEntitlement,
  required: ServiceSubscriptionTier
): boolean {
  return tierIncludes(entitlement.effectiveTier, required)
}
