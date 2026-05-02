/**
 * Guard shared accounting/ledger APIs that are used by both the accountant
 * workspace and the Service workspace.
 *
 * Apply Service subscription tier only when the caller is not an accounting
 * firm user and the target business is a Service-workspace industry.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

export async function enforceServiceIndustryBusinessTierForAccountingApi(
  supabase: SupabaseClient,
  userId: string,
  businessId: string,
  minTier: ServiceSubscriptionTier = "business"
): Promise<NextResponse | null> {
  const { data: firmRow } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle()

  if (firmRow) return null

  const { data: biz } = await supabase
    .from("businesses")
    .select("industry")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  const ind = (biz?.industry ?? "").toLowerCase()
  if (ind !== "service" && ind !== "professional") return null

  return enforceServiceWorkspaceAccess({ supabase, userId, businessId, minTier })
}
