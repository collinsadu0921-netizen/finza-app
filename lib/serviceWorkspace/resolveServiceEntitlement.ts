/**
 * resolveServiceEntitlement
 * =============================================================================
 * Single source of truth for service workspace access decisions.
 *
 * Used by:
 *   - ServiceSubscriptionContext  (client — React context)
 *   - enforceServiceWorkspaceAccess / enforceServiceWorkspaceWriteAccess (server)
 *
 * Trial lifecycle (unpaid — subscription_started_at IS NULL):
 *   1. Active trial: status=trialing, trial_ends_at > now → full trial access (rawTier).
 *   2. Expired trial, grace active: past_due + subscription_grace_until > now → writes allowed, warning.
 *   3. Expired trial, grace ended OR status=locked → read-only (no financial writes).
 *   4. Stale trialing (trial ended, no grace row yet): read-only until lifecycle cron sets grace.
 *
 * Paid subscriptions use status=active / past_due (renewal) / locked as before.
 * MoMo renewal grace is separate but shares subscription_grace_until with unpaid trial grace.
 * =============================================================================
 */

import {
  type ServiceSubscriptionTier,
  type ServiceSubscriptionStatus,
  parseServiceSubscriptionTier,
  parseServiceSubscriptionStatus,
  tierIncludes,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  isBillingExemptFromRow,
  resolveBillingExemptReason,
} from "@/lib/serviceWorkspace/billingExempt"

/** Raw columns fetched from public.businesses */
export type RawBusinessSubscriptionRow = {
  service_subscription_tier?: string | null
  service_subscription_status?: string | null
  trial_started_at?: string | null
  trial_ends_at?: string | null
  subscription_grace_until?: string | null
  current_period_ends_at?: string | null
  billing_cycle?: string | null
  subscription_started_at?: string | null
  billing_exempt?: boolean | null
  billing_exempt_reason?: string | null
}

export type ServiceEntitlement = {
  /** Tier used for feature gates (raw tier — no silent downgrade after trial). */
  effectiveTier: ServiceSubscriptionTier
  rawTier: ServiceSubscriptionTier
  status: ServiceSubscriptionStatus

  billingCycle: string | null
  currentPeriodEndsAt: Date | null

  isTrialing: boolean
  /** Trial window ended (clock), regardless of payment. */
  trialExpired: boolean
  /** Trial ended and tenant has never activated a paid subscription. */
  trialExpiredWithoutPayment: boolean
  /** Unpaid trial ended + grace window still open. */
  trialGraceActive: boolean
  /** Unpaid trial ended + grace missing or expired. */
  trialGraceExpired: boolean
  trialEndsAt: Date | null
  trialStartedAt: Date | null
  subscriptionStartedAt: Date | null
  trialDaysLeft: number | null

  periodExpired: boolean
  daysUntilRenewal: number | null

  inGracePeriod: boolean
  graceEndsAt: Date | null
  /**
   * Read-only lock: user may view data but must not create/edit/post financial records.
   * True when grace expired, status=locked, or stale unpaid expired trial awaiting cron.
   */
  isReadOnlyLocked: boolean
  /** @deprecated Alias for isReadOnlyLocked — UI/API use this name historically. */
  isSubscriptionLocked: boolean
  /** False when isReadOnlyLocked (billing-exempt tenants always true). */
  canWriteFinancialRecords: boolean

  billingExempt: boolean
  billingExemptReason: string | null
  accessSource: "subscription" | "billing_exempt"
}

const DAY_MS = 1000 * 60 * 60 * 24

function hasUnpaidExpiredTrial(
  subscriptionStartedAt: Date | null,
  trialEndsAt: Date | null,
  now: Date
): boolean {
  return (
    subscriptionStartedAt === null &&
    trialEndsAt !== null &&
    now >= trialEndsAt
  )
}

export function resolveServiceEntitlement(
  row: RawBusinessSubscriptionRow,
  now: Date = new Date()
): ServiceEntitlement {
  if (isBillingExemptFromRow(row)) {
    const billingCycle = row.billing_cycle ?? null
    const periodEndsAt = row.current_period_ends_at
      ? new Date(row.current_period_ends_at)
      : null
    const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null
    const trialStartedAt = row.trial_started_at ? new Date(row.trial_started_at) : null
    const subscriptionStartedAt = row.subscription_started_at
      ? new Date(row.subscription_started_at)
      : null

    return {
      effectiveTier: "business",
      rawTier: parseServiceSubscriptionTier(row.service_subscription_tier),
      status: "active",
      billingCycle,
      currentPeriodEndsAt: periodEndsAt,
      isTrialing: false,
      trialExpired: false,
      trialExpiredWithoutPayment: false,
      trialGraceActive: false,
      trialGraceExpired: false,
      trialEndsAt,
      trialStartedAt,
      subscriptionStartedAt,
      trialDaysLeft: null,
      periodExpired: false,
      daysUntilRenewal: null,
      inGracePeriod: false,
      graceEndsAt: null,
      isReadOnlyLocked: false,
      isSubscriptionLocked: false,
      canWriteFinancialRecords: true,
      billingExempt: true,
      billingExemptReason: resolveBillingExemptReason(row),
      accessSource: "billing_exempt",
    }
  }

  const rawTier = parseServiceSubscriptionTier(row.service_subscription_tier)
  const status = parseServiceSubscriptionStatus(row.service_subscription_status)
  const trialEndsAt = row.trial_ends_at ? new Date(row.trial_ends_at) : null
  const trialStartedAt = row.trial_started_at ? new Date(row.trial_started_at) : null
  const graceUntil = row.subscription_grace_until
    ? new Date(row.subscription_grace_until)
    : null
  const periodEndsAt = row.current_period_ends_at
    ? new Date(row.current_period_ends_at)
    : null
  const billingCycle = row.billing_cycle ?? null
  const subscriptionStartedAt = row.subscription_started_at
    ? new Date(row.subscription_started_at)
    : null

  const isTrialing =
    status === "trialing" && trialEndsAt !== null && now < trialEndsAt
  const trialExpired = hasUnpaidExpiredTrial(subscriptionStartedAt, trialEndsAt, now)
  const trialExpiredWithoutPayment = hasUnpaidExpiredTrial(
    subscriptionStartedAt,
    trialEndsAt,
    now
  )

  const trialGraceActive =
    trialExpiredWithoutPayment &&
    graceUntil !== null &&
    now < graceUntil &&
    (status === "past_due" || status === "trialing")

  const trialGraceExpired =
    trialExpiredWithoutPayment &&
    (graceUntil === null || now >= graceUntil)

  const effectiveTier: ServiceSubscriptionTier = rawTier

  const trialDaysLeft =
    isTrialing && trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS) - 1)
      : null

  const periodExpired =
    status === "active" && periodEndsAt !== null && now >= periodEndsAt

  const daysUntilRenewal =
    status === "active" && periodEndsAt !== null && now < periodEndsAt
      ? Math.max(0, Math.ceil((periodEndsAt.getTime() - now.getTime()) / DAY_MS))
      : null

  const paymentGraceExpired =
    graceUntil !== null && now >= graceUntil

  const staleUnpaidTrialingAwaitingCron =
    status === "trialing" && trialExpiredWithoutPayment && graceUntil === null

  const isReadOnlyLocked =
    status === "locked" ||
    paymentGraceExpired ||
    (trialGraceExpired && !trialGraceActive) ||
    staleUnpaidTrialingAwaitingCron

  const canWriteFinancialRecords = !isReadOnlyLocked

  const inGracePeriod =
    !isReadOnlyLocked &&
    (trialGraceActive ||
      periodExpired ||
      (graceUntil !== null &&
        now < graceUntil &&
        subscriptionStartedAt !== null &&
        status === "past_due"))

  return {
    effectiveTier,
    rawTier,
    status,
    billingCycle,
    currentPeriodEndsAt: periodEndsAt,
    isTrialing,
    trialExpired,
    trialExpiredWithoutPayment,
    trialGraceActive,
    trialGraceExpired,
    trialEndsAt,
    trialStartedAt,
    subscriptionStartedAt,
    trialDaysLeft,
    periodExpired,
    daysUntilRenewal,
    inGracePeriod,
    graceEndsAt: graceUntil,
    isReadOnlyLocked,
    isSubscriptionLocked: isReadOnlyLocked,
    canWriteFinancialRecords,
    billingExempt: false,
    billingExemptReason: null,
    accessSource: "subscription",
  }
}

export function entitlementIncludesTier(
  entitlement: ServiceEntitlement,
  required: ServiceSubscriptionTier
): boolean {
  return tierIncludes(entitlement.effectiveTier, required)
}
