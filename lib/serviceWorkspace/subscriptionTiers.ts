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
 */

export const SERVICE_SUBSCRIPTION_TIERS = ["starter", "professional", "business"] as const

export type ServiceSubscriptionTier = (typeof SERVICE_SUBSCRIPTION_TIERS)[number]

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

/** Default when column missing / invalid — preserves full access for existing tenants. */
export const DEFAULT_SERVICE_SUBSCRIPTION_TIER: ServiceSubscriptionTier = "business"

export function parseServiceSubscriptionTier(raw: string | null | undefined): ServiceSubscriptionTier {
  if (!raw || typeof raw !== "string") return DEFAULT_SERVICE_SUBSCRIPTION_TIER
  const n = raw.trim().toLowerCase()
  if (n === "starter" || n === "essentials") return "starter"
  if (n === "professional" || n === "growth" || n === "pro") return "professional"
  if (n === "business" || n === "scale" || n === "enterprise") return "business"
  return DEFAULT_SERVICE_SUBSCRIPTION_TIER
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
