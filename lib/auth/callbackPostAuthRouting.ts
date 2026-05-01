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

/** Minimal row from `businesses` for post-auth redirect decisions. */
export type AuthCallbackOwnedBusiness = {
  id: string
  industry: string | null
}

/**
 * True when the callback URL carries a Finza **Service** marketing context
 * (`workspace=service` plus plan and/or trial). Used to prefer `/service/dashboard`
 * when the user owns multiple businesses.
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
 * Deterministic redirect for users who **already own** at least one business.
 * Never returns `/business-setup`.
 *
 * - Single business: by `industry` (retail → retail dashboard, service → service dashboard).
 * - Multiple: if URL indicates Service marketing and a service business exists → service dashboard;
 *   otherwise `/` so `app/page.tsx` can apply `getSelectedBusinessId` / multi-workspace rules.
 */
export function resolveBusinessDashboardRedirect(
  businesses: AuthCallbackOwnedBusiness[],
  urlPrefersService: boolean
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

  if (urlPrefersService) {
    const hasService = businesses.some((b) => (b.industry || "").toLowerCase() === "service")
    if (hasService) return "/service/dashboard"
  }

  return "/"
}
