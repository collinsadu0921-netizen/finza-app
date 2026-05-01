/**
 * GHS pricing for the service workspace subscription tiers.
 *
 * Monthly rates (base):
 *   Essentials GHS 149 / Professional GHS 449 / Business GHS 949
 *
 * Quarterly: ~5% discount applied to 3-month total.
 * Annual:    "12 months for the price of 10" (2 months free).
 */

import type { ServiceSubscriptionTier } from "./subscriptionTiers"

export type BillingCycle = "monthly" | "quarterly" | "annual"

export const BILLING_CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly:   "Monthly",
  quarterly: "Quarterly",
  annual:    "Annual",
}

/** Total amount charged per billing cycle (GHS). */
export const TIER_PRICING: Record<BillingCycle, Record<ServiceSubscriptionTier, number>> = {
  monthly: {
    starter:      149,
    professional: 449,
    business:     949,
  },
  quarterly: {
    // monthly × 3 × 0.95, rounded to nearest whole number
    starter:      425,   // 149 × 3 × 0.95 = 424.65
    professional: 1280,  // 449 × 3 × 0.95 = 1279.65
    business:     2708,  // 949 × 3 × 0.95 = 2707.35
  },
  annual: {
    // monthly × 10  (12 months for the price of 10 — 2 months free)
    starter:      1490,  // 149 × 10
    professional: 4490,  // 449 × 10
    business:     9490,  // 949 × 10
  },
}

/** Per-month equivalent price for a given cycle (for display purposes). */
export function monthlyEquivalent(cycle: BillingCycle, tier: ServiceSubscriptionTier): number {
  if (cycle === "monthly") return TIER_PRICING.monthly[tier]
  if (cycle === "quarterly") return Math.round(TIER_PRICING.quarterly[tier] / 3)
  return Math.round(TIER_PRICING.annual[tier] / 12)
}

/**
 * Whole-number % saving vs paying monthly for the full cycle period.
 * Returns 0 for monthly (no saving).
 */
export function billingCycleSavings(cycle: BillingCycle, tier: ServiceSubscriptionTier): number {
  if (cycle === "monthly") return 0
  const months = cycle === "quarterly" ? 3 : 12
  const fullPrice = TIER_PRICING.monthly[tier] * months
  const discountedPrice = TIER_PRICING[cycle][tier]
  return Math.round(((fullPrice - discountedPrice) / fullPrice) * 100)
}

const BILLING_CYCLES = new Set<BillingCycle>(["monthly", "quarterly", "annual"])

/** Parses marketing/signup `billing_cycle` query values only when recognized. */
export function tryParseBillingCycle(raw: string | null | undefined): BillingCycle | null {
  if (!raw || typeof raw !== "string") return null
  const n = raw.trim().toLowerCase() as BillingCycle
  return BILLING_CYCLES.has(n) ? n : null
}
