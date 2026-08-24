import type { SupabaseClient } from "@supabase/supabase-js"
import { BUSINESS_SUBSCRIPTION_COLUMNS } from "@/lib/serviceWorkspace/loadBusinessBillingRow"

const BILLS_ENTITLEMENT_COLUMNS = `industry, ${BUSINESS_SUBSCRIPTION_COLUMNS}`

/**
 * One businesses read for Bills list entitlement after scope is already proven.
 * Does not re-check membership/owner access.
 */
export async function loadBillsListEntitlementRow(
  supabase: SupabaseClient,
  businessId: string
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from("businesses")
    .select(BILLS_ENTITLEMENT_COLUMNS)
    .eq("id", businessId)
    .is("archived_at", null)
    .maybeSingle()

  return (data as Record<string, unknown> | null) ?? null
}
