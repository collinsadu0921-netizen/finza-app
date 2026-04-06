import "server-only"

/**
 * Resolves default tenant payment provider for an invoice's business and returns
 * payer-facing manual wallet instructions when that default is an enabled `manual_wallet`.
 *
 * Does not create payment_provider_transactions, call gateways, or mutate invoices.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeBusinessPaymentProviderRow } from "./providerConfig"
import { getDefaultBusinessPaymentProvider } from "./resolveProvider"
import {
  type ManualWalletCustomerInstructions,
  serializeManualWalletForCustomer,
} from "./serializeManualWalletForCustomer"
import type { BusinessPaymentProviderRow, PaymentProviderEnvironment } from "./types"

/** Pure helper for tests: derive customer instructions from the default-provider row only. */
export function manualWalletInstructionsFromDefaultRow(
  row: BusinessPaymentProviderRow | null
): ManualWalletCustomerInstructions | null {
  if (!row || !row.is_enabled || row.provider_type !== "manual_wallet") {
    return null
  }
  const resolved = normalizeBusinessPaymentProviderRow(row)
  if (resolved.kind !== "manual_wallet") {
    return null
  }
  return serializeManualWalletForCustomer(resolved)
}

export async function getManualWalletInstructionsForInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  options: { environment?: PaymentProviderEnvironment } = {}
): Promise<ManualWalletCustomerInstructions | null> {
  const environment = options.environment ?? "live"

  const { data: inv, error: invErr } = await supabase
    .from("invoices")
    .select("id, business_id")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle()

  if (invErr || !inv?.business_id) {
    return null
  }

  const defaultRow = await getDefaultBusinessPaymentProvider(supabase, inv.business_id, environment)
  return manualWalletInstructionsFromDefaultRow(defaultRow)
}
