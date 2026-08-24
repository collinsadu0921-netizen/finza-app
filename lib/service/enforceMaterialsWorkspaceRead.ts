import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { entitlementIncludesTier } from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { subscriptionEntitlementFromBusinessRow } from "@/lib/serviceWorkspace/subscriptionEntitlementFromBusinessRow"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

/**
 * Same gates as enforceServiceIndustryMinTier for this route, but reuse the
 * business row already resolved by getCurrentBusiness:
 * - industry is already on the row
 * - membership/owner access is already established
 * - subscription columns are already on select("*")
 *
 * Still queries accounting_firm_users so firm members skip the Service tier gate.
 */
export async function enforceMaterialsWorkspaceRead(
  supabase: SupabaseClient,
  userId: string,
  business: Record<string, unknown>,
  minTier: ServiceSubscriptionTier = "professional"
): Promise<NextResponse | null> {
  const { data: firmRow } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  if (firmRow) return null

  const industry = String(business.industry ?? "").toLowerCase()
  if (industry !== "service" && industry !== "professional") return null

  const entitlement = subscriptionEntitlementFromBusinessRow(business)
  if (!entitlementIncludesTier(entitlement, minTier)) {
    return NextResponse.json(
      {
        error: `Forbidden: requires ${minTier} plan or higher`,
        code: "TIER_REQUIRED",
        effectiveTier: entitlement.effectiveTier,
      },
      { status: 403 }
    )
  }

  return null
}
