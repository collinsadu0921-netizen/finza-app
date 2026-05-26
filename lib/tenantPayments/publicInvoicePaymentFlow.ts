import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { getDefaultBusinessPaymentProvider } from "./resolveProvider"
import { isHubtelInvoiceCheckoutConfigured } from "./hubtelInvoiceDirectService"

/**
 * Service invoice customer-facing online collection.
 * MTN direct and Paystack MoMo are not offered on public invoice pay (routes may remain for legacy/admin).
 */
export type PublicInvoicePaymentFlow = "manual_wallet" | "hubtel_checkout"

/**
 * Pure resolver for tests — Hubtel when configured; otherwise manual instructions only.
 */
export function resolvePublicInvoicePaymentFlowDecision(input: {
  defaultProviderType: string | null
  defaultProviderEnabled: boolean
  hubtelConfigured: boolean
}): PublicInvoicePaymentFlow {
  if (input.hubtelConfigured) {
    return "hubtel_checkout"
  }
  return "manual_wallet"
}

/**
 * Which path the public invoice pay UI should use (live environment).
 * Gated by `FINZA_TENANT_INVOICE_ONLINE_PAYMENTS_ENABLED` in API routes and `/pay` UI.
 */
export async function resolvePublicInvoicePaymentFlow(
  supabase: SupabaseClient,
  businessId: string
): Promise<PublicInvoicePaymentFlow> {
  const row = await getDefaultBusinessPaymentProvider(supabase, businessId, "live")
  const hubtelConfigured = await isHubtelInvoiceCheckoutConfigured(supabase, businessId)
  return resolvePublicInvoicePaymentFlowDecision({
    defaultProviderType: row?.provider_type ?? null,
    defaultProviderEnabled: Boolean(row?.is_enabled),
    hubtelConfigured,
  })
}
