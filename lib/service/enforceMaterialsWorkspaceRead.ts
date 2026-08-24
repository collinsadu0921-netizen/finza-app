import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { entitlementIncludesTier } from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { subscriptionEntitlementFromBusinessRow } from "@/lib/serviceWorkspace/subscriptionEntitlementFromBusinessRow"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

export type MaterialsFirmMembership = { firm_id: string }

/**
 * Read-only firm membership. Depends only on userId — not business.id.
 * Query errors are treated as "not a firm user", matching the previous helper.
 */
export async function lookupAccountingFirmUser(
  supabase: SupabaseClient,
  userId: string
): Promise<MaterialsFirmMembership | null> {
  const { data } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  return data ?? null
}

/**
 * In-memory decision after business + firm rows are already loaded.
 * Order: firm skip → industry skip → tier gate. Same codes as before.
 */
export function decideMaterialsWorkspaceRead(
  firmRow: MaterialsFirmMembership | null,
  business: Record<string, unknown>,
  minTier: ServiceSubscriptionTier = "professional"
): NextResponse | null {
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

/**
 * Same gates as enforceServiceIndustryMinTier for this route, but reuse the
 * business row already resolved by getCurrentBusiness.
 */
export async function enforceMaterialsWorkspaceRead(
  supabase: SupabaseClient,
  userId: string,
  business: Record<string, unknown>,
  minTier: ServiceSubscriptionTier = "professional"
): Promise<NextResponse | null> {
  const firmRow = await lookupAccountingFirmUser(supabase, userId)
  return decideMaterialsWorkspaceRead(firmRow, business, minTier)
}
