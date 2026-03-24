/**
 * Service workspace subscription tiers (three levels).
 *
 * Tier order: starter < professional < business.
 * Each sidebar / feature declares the minimum tier required (`minTier`).
 * `businesses.service_subscription_tier` stores the active tier (see migration).
 *
 * Product mapping (summary):
 * - Essentials (starter): core CRM + quoting, service catalog, billing documents, basic P&L/BS, VAT report, core settings.
 * - Professional: projects, materials, AP (bills), extended reports, tax returns (VAT/WHT), payroll, team.
 * - Business: full general ledger, reconciliation, periods, loans, CIT, system audit.
 *
 * Subscription status (service_subscription_status):
 * - trialing  — 14-day free trial; check trial_ends_at to determine if still active.
 *               When trial_ends_at passes, effective tier silently downgrades to
 *               'starter' — no hard lock; user keeps Essentials and sees upgrade CTA.
 * - active    — paid subscription current
 * - past_due  — renewal payment failed; MoMo grace window (3 days) still open
 * - locked    — renewal payment grace period expired; access blocked until payment.
 *               NOTE: trial expiry does NOT set locked — only failed payment grace does.
 */

export const SERVICE_SUBSCRIPTION_TIERS = ["starter", "professional", "business"] as const

export type ServiceSubscriptionTier = (typeof SERVICE_SUBSCRIPTION_TIERS)[number]

export const SERVICE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "locked"] as const

export type ServiceSubscriptionStatus = (typeof SERVICE_SUBSCRIPTION_STATUSES)[number]

export function parseServiceSubscriptionStatus(raw: string | null | undefined): ServiceSubscriptionStatus {
  if (!raw || typeof raw !== "string") return "active"
  const n = raw.trim().toLowerCase()
  if (SERVICE_SUBSCRIPTION_STATUSES.includes(n as ServiceSubscriptionStatus)) {
    return n as ServiceSubscriptionStatus
  }
  return "active"
}

export const SERVICE_TIER_RANK: Record<ServiceSubscriptionTier, number> = {
  starter: 0,
  professional: 1,
  business: 2,
}

export const SERVICE_TIER_LABEL: Record<ServiceSubscriptionTier, string> = {
  starter: "Essentials",
  professional: "Professional",
  business: "Business",
}

/**
 * Safe fallback tier for missing/invalid values.
 *
 * CHANGED from 'business' to 'starter': returning 'business' on a bad/missing
 * value silently grants full top-tier access to any row where the column is
 * absent or corrupt. 'starter' fails safe — the user sees an upgrade wall if
 * they need a higher tier, rather than getting unearned access.
 *
 * Existing rows already have an explicit value stored in the DB, so this
 * constant only matters for rows where the column is NULL or an unknown string.
 */
export const DEFAULT_SERVICE_SUBSCRIPTION_TIER: ServiceSubscriptionTier = "starter"

/**
 * Parses tier only when `raw` is a recognized alias. Returns null if missing or unknown.
 * Use for URL gates (e.g. strict signup) where invalid input must not be coerced to starter.
 */
export function tryParseServiceSubscriptionTier(raw: string | null | undefined): ServiceSubscriptionTier | null {
  if (!raw || typeof raw !== "string") return null
  const n = raw.trim().toLowerCase()
  if (n === "starter" || n === "essentials") return "starter"
  if (n === "professional" || n === "growth" || n === "pro") return "professional"
  if (n === "business" || n === "scale" || n === "enterprise") return "business"
  return null
}

export function parseServiceSubscriptionTier(raw: string | null | undefined): ServiceSubscriptionTier {
  return tryParseServiceSubscriptionTier(raw) ?? DEFAULT_SERVICE_SUBSCRIPTION_TIER
}

/** True if `userTier` is at or above `requiredTier`. */
export function tierIncludes(userTier: ServiceSubscriptionTier, requiredTier: ServiceSubscriptionTier): boolean {
  return SERVICE_TIER_RANK[userTier] >= SERVICE_TIER_RANK[requiredTier]
}

/** Next tier to recommend for upgrade copy, or null if already on highest. */
export function nextTier(from: ServiceSubscriptionTier): ServiceSubscriptionTier | null {
  if (from === "starter") return "professional"
  if (from === "professional") return "business"
  return null
}

export function upgradeLabel(requiredTier: ServiceSubscriptionTier): string {
  return `Requires ${SERVICE_TIER_LABEL[requiredTier]} plan`
}
