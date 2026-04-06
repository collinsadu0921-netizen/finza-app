import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { getDefaultBusinessPaymentProvider } from "./resolveProvider"

export type PublicInvoicePaymentFlow = "manual_wallet" | "mtn_momo_direct" | "paystack_momo"

/**
 * Which integrated path the public invoice pay UI should use (default enabled provider, live).
 */
export async function resolvePublicInvoicePaymentFlow(
  supabase: SupabaseClient,
  businessId: string
): Promise<PublicInvoicePaymentFlow> {
  const row = await getDefaultBusinessPaymentProvider(supabase, businessId, "live")
  if (row?.is_enabled && row.provider_type === "manual_wallet") {
    return "manual_wallet"
  }
  if (row?.is_enabled && row.provider_type === "mtn_momo_direct") {
    return "mtn_momo_direct"
  }
  return "paystack_momo"
}
