import type { SupabaseClient } from "@supabase/supabase-js"
import {
  type ServiceSubscriptionTier,
  parseServiceSubscriptionTier,
  tierIncludes,
} from "./subscriptionTiers"

/** Load tier for API / server guards (RLS must allow read on businesses). */
export async function getBusinessServiceTier(
  supabase: SupabaseClient,
  businessId: string
): Promise<ServiceSubscriptionTier> {
  const { data, error } = await supabase
    .from("businesses")
    .select("service_subscription_tier")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (error || !data) {
    return parseServiceSubscriptionTier(undefined)
  }
  return parseServiceSubscriptionTier(
    (data as { service_subscription_tier?: string }).service_subscription_tier
  )
}

export function businessMeetsServiceTier(
  tier: ServiceSubscriptionTier,
  minimum: ServiceSubscriptionTier
): boolean {
  return tierIncludes(tier, minimum)
}
