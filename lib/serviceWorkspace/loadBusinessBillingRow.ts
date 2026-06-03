import type { SupabaseClient } from "@supabase/supabase-js"
import type { RawBusinessSubscriptionRow } from "@/lib/serviceWorkspace/resolveServiceEntitlement"

export const BUSINESS_SUBSCRIPTION_COLUMNS =
  "service_subscription_tier, service_subscription_status, subscription_grace_until, trial_started_at, trial_ends_at, current_period_ends_at, billing_cycle, subscription_started_at, billing_exempt, billing_exempt_reason"

export async function loadBusinessSubscriptionRow(
  supabase: SupabaseClient,
  businessId: string
): Promise<RawBusinessSubscriptionRow> {
  const { data } = await supabase
    .from("businesses")
    .select(BUSINESS_SUBSCRIPTION_COLUMNS)
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (!data) return {}

  return data as RawBusinessSubscriptionRow
}

export async function isBusinessBillingExempt(
  supabase: SupabaseClient,
  businessId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("businesses")
    .select("billing_exempt")
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  return data?.billing_exempt === true
}
