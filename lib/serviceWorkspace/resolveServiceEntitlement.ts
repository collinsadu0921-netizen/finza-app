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
  current_period_ends_at?:      string | null
  billing_cycle?:               string | null
  subscription_started_at?:     string | null
}

export type ServiceEntitlement = {
  /** Tier the user actually has access to (may differ from rawTier after trial expiry). */
  effectiveTier: ServiceSubscriptionTier
  /** Raw tier stored in DB — the plan they subscribed/trialled for. */
  rawTier: ServiceSubscriptionTier
  /** Parsed status column value. */
  status: ServiceSubscriptionStatus

  /** Billing cycle stored in DB: 'monthly' | 'quarterly' | 'annual'. Null if not set. */
  billingCycle: string | null
  /** When the current paid period ends. Null for trial users or when not set. */
  currentPeriodEndsAt: Date | null

  /** True when status=trialing AND trial_ends_at is in the future. */
  isTrialing: boolean
  /**
   * True when status=trialing AND trial_ends_at has passed.
   * effectiveTier will be 'starter' in this case.
   */
  trialExpired: boolean
  /** ISO date of trial end, or null if not on a trial. */
  trialEndsAt: Date | null
  /** When the trial started, if known. */
  trialStartedAt: Date | null
  /** When the first paid subscription period started, if known. */
  subscriptionStartedAt: Date | null
  /**
   * Whole days remaining in the trial (0 on the last day).
   * Null when not on an active trial.
   */
  trialDaysLeft: number | null

  /**
   * True when status=active AND current_period_ends_at has passed.
   * The user is in a grace state — they still have access but must renew.
   */
  periodExpired: boolean
  /**
   * Whole days remaining until current_period_ends_at (0 on the last day).
   * Null when period has already expired or for non-active subscriptions.
   */
  daysUntilRenewal: number | null

  /**
   * True when NOT locked AND either:
   *   a) periodExpired — paid period ended, renewal needed (warning shown)
   *   b) subscription_grace_until is set and in the future (MoMo payment failed)
   * Access is still allowed; a warning banner is shown.
   */
  inGracePeriod: boolean
  /**
   * The Date when the grace window closes (subscription_grace_until).
   * Null if no explicit grace deadline has been set.
   */
  graceEndsAt: Date | null
  /**
   * True when subscription_grace_until is set and has expired, or status=locked.
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
const DAY_MS = 1000 * 60 * 60 * 24

export function resolveServiceEntitlement(
  row: RawBusinessSubscriptionRow,
  now: Date = new Date()
): ServiceEntitlement {
  const rawTier      = parseServiceSubscriptionTier(row.service_subscription_tier)
  const status       = parseServiceSubscriptionStatus(row.service_subscription_status)
  const trialEndsAt  = row.trial_ends_at          ? new Date(row.trial_ends_at)          : null
  const trialStartedAt = row.trial_started_at    ? new Date(row.trial_started_at)       : null
  const graceUntil   = row.subscription_grace_until ? new Date(row.subscription_grace_until) : null
  const periodEndsAt = row.current_period_ends_at  ? new Date(row.current_period_ends_at) : null
  const billingCycle = row.billing_cycle ?? null
  const subscriptionStartedAt = row.subscription_started_at
    ? new Date(row.subscription_started_at)
    : null

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
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS) - 1)
      : null

  // --- Period expiry (active paid subscriptions only) ---
  // Trialing users are governed by trial_ends_at, not current_period_ends_at.
  const periodExpired =
    status === "active" && periodEndsAt !== null && now >= periodEndsAt

  // --- Days until renewal ---
  // Only meaningful when the period is still in the future.
  const daysUntilRenewal =
    status === "active" && periodEndsAt !== null && now < periodEndsAt
      ? Math.max(0, Math.ceil((periodEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null

  // --- Lock state ---
  // isSubscriptionLocked is true when EITHER:
  //   a) subscription_grace_until is set and has expired (payment grace deadline missed), OR
  //   b) status is explicitly 'locked' (admin/background-job set it directly).
  // Both paths must block access — checking only the date would miss an explicit
  // admin lock; checking only the status column would miss an expired grace window
  // that hasn't been flushed to the status column yet.
  const isSubscriptionLocked =
    status === "locked" || (graceUntil !== null && now >= graceUntil)

  // --- Grace period ---
  // In grace when NOT locked AND either:
  //   a) periodExpired — paid period ended, user must renew (warning shown, access preserved)
  //   b) subscription_grace_until is set and in the future — MoMo payment failed, 3-day window
  const inGracePeriod =
    !isSubscriptionLocked &&
    (periodExpired || (graceUntil !== null && now < graceUntil))

  return {
    effectiveTier,
    rawTier,
    status,
    billingCycle,
    currentPeriodEndsAt: periodEndsAt,
    isTrialing,
    trialExpired,
    trialEndsAt,
    trialStartedAt,
    subscriptionStartedAt,
    trialDaysLeft,
    periodExpired,
    daysUntilRenewal,
    inGracePeriod,
    graceEndsAt: graceUntil,
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
