/**
 * Apply service subscription write lock only for Service-workspace industries.
 * Retail and other industries using shared APIs are unaffected.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import {
  enforceServiceWorkspaceWriteAccess,
  type EnforceServiceAccessOptions,
} from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"
import type { ServiceSubscriptionTier } from "@/lib/serviceWorkspace/subscriptionTiers"

async function isServiceWorkspaceBusiness(
  supabase: SupabaseClient,
  businessId: string
): Promise<boolean> {
  const { data: biz } = await supabase
    .from("businesses")
    .select("industry")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  const ind = (biz?.industry ?? "").toLowerCase()
  return ind === "service" || ind === "professional"
}

/**
 * Blocks financial mutations for expired unpaid trials (read-only lock) and
 * subscription-locked tenants in the Service workspace.
 */
export async function enforceServiceIndustryFinancialWrite(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  businessId: string,
  minTier: ServiceSubscriptionTier = "starter"
): Promise<NextResponse | null> {
  const { data: firmRow } = await supabase
    .from("accounting_firm_users")
    .select("firm_id")
    .eq("user_id", userId ?? "")
    .limit(1)
    .maybeSingle()

  if (firmRow) return null

  if (!(await isServiceWorkspaceBusiness(supabase, businessId))) {
    return null
  }

  return enforceServiceWorkspaceWriteAccess({
    supabase,
    userId,
    businessId,
    minTier,
  })
}

export type { EnforceServiceAccessOptions }
