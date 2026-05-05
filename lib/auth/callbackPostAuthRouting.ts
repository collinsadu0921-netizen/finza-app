import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

/**
 * Service marketing query params (`plan`, `trial` + `workspace=service`) must not
 * mutate Auth metadata for accounting-firm users.
 */
export function shouldApplyServiceMarketingMetadataFromUrl(
  parsedPlan: ServiceSubscriptionTier | null,
  existingSignupIntent: string | undefined
): boolean {
  if (parsedPlan === null) return false
  if (existingSignupIntent === "accounting_firm") return false
  return true
}

/** Minimal business row for post-auth redirect decisions. */
export type AuthCallbackAccessibleBusiness = {
  id: string
  industry: string | null
}

type AuthCallbackMembershipBusiness = AuthCallbackAccessibleBusiness & {
  archived_at?: string | null
}

/** Minimal row from `business_users` with joined `businesses`. */
export type AuthCallbackMembershipRow = {
  business_id: string | null
  businesses: AuthCallbackMembershipBusiness | AuthCallbackMembershipBusiness[] | null
}

/** High guardrail limit for callback membership lookups. */
export const AUTH_CALLBACK_MEMBERSHIP_QUERY_LIMIT = 1000

/**
 * Membership query failures can undercount accessible workspaces.
 * Use workspace selection as the safe fallback to prevent silent bypass.
 */
export function resolveMembershipQueryFailureRedirect(
  _ownedBusinessCount: number
): "/select-workspace" {
  return "/select-workspace"
}

/** True when callback membership query may be truncated. */
export function isMembershipResultPotentiallyTruncated(
  rowCount: number,
  limit: number = AUTH_CALLBACK_MEMBERSHIP_QUERY_LIMIT
): boolean {
  return rowCount >= limit
}

/**
 * Combines owned and membership businesses, deduplicated by id.
 * Membership rows ignore archived businesses to match `getAllUserBusinesses`.
 */
export function mergeAccessibleBusinesses(
  ownedBusinesses: AuthCallbackAccessibleBusiness[],
  membershipRows: AuthCallbackMembershipRow[]
): AuthCallbackAccessibleBusiness[] {
  const merged: AuthCallbackAccessibleBusiness[] = []
  const seen = new Set<string>()

  for (const b of ownedBusinesses) {
    if (!b?.id || seen.has(b.id)) continue
    seen.add(b.id)
    merged.push({ id: b.id, industry: b.industry ?? null })
  }

  for (const row of membershipRows) {
    const business = Array.isArray(row.businesses) ? row.businesses[0] : row.businesses
    if (!business?.id || business.archived_at != null || seen.has(business.id)) continue
    seen.add(business.id)
    merged.push({ id: business.id, industry: business.industry ?? null })
  }

  return merged
}

/**
 * True when the callback URL carries a Finza **Service** marketing context
 * (`workspace=service` plus plan and/or trial). Used to prefer `/service/dashboard`
 * when the user has only one accessible business.
 */
export function urlIndicatesServiceMarketingContext(
  workspaceParam: string,
  trialParam: string | null,
  parsedPlan: ServiceSubscriptionTier | null
): boolean {
  if (workspaceParam !== "service") return false
  return trialParam === "1" || parsedPlan !== null
}

/**
 * Deterministic redirect for users who already have at least one accessible business.
 * Never returns `/business-setup`.
 *
 * - Single business: by `industry` (retail → retail dashboard, service → service dashboard).
 * - Multiple: always `/select-workspace` to avoid callback-level workspace bypass.
 */
export function resolveBusinessDashboardRedirect(
  businesses: AuthCallbackAccessibleBusiness[],
  _urlPrefersService: boolean
): string {
  if (businesses.length === 0) {
    throw new Error("resolveBusinessDashboardRedirect: expected at least one business")
  }

  if (businesses.length === 1) {
    const ind = (businesses[0].industry || "").toLowerCase()
    if (ind === "retail") return "/retail/dashboard"
    if (ind === "service") return "/service/dashboard"
    return "/"
  }

  return "/select-workspace"
}
