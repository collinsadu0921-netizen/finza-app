/**
 * Resolve CoA UUID for service materials inventory (account code 1450).
 * bill_items.account_id references chart_of_accounts(id); posting maps CoA → accounts.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type MaterialInventoryAccountResult =
  | { ok: true; chartOfAccountsId: string; accountsId: string }
  | { ok: false; error: string; code: "material_inventory_account_missing" }

/**
 * Fail closed: both ledger accounts.code 1450 and an active CoA 1450 row must exist.
 */
export async function resolveMaterialInventoryAccount(
  supabase: SupabaseClient,
  businessId: string
): Promise<MaterialInventoryAccountResult> {
  const { data: ledgerAccount, error: ledgerError } = await supabase
    .from("accounts")
    .select("id")
    .eq("business_id", businessId)
    .eq("code", "1450")
    .is("deleted_at", null)
    .maybeSingle()

  if (ledgerError) {
    return {
      ok: false,
      code: "material_inventory_account_missing",
      error:
        ledgerError.message ||
        "Failed to resolve materials inventory account 1450.",
    }
  }

  const { data: coa, error: coaError } = await supabase
    .from("chart_of_accounts")
    .select("id")
    .eq("business_id", businessId)
    .eq("account_code", "1450")
    .eq("is_active", true)
    .maybeSingle()

  if (coaError) {
    return {
      ok: false,
      code: "material_inventory_account_missing",
      error:
        coaError.message ||
        "Failed to resolve materials inventory chart of accounts 1450.",
    }
  }

  if (!ledgerAccount?.id || !coa?.id) {
    return {
      ok: false,
      code: "material_inventory_account_missing",
      error:
        "Materials inventory account 1450 is not configured for this business. Activate service material accounts before posting material supplier bills.",
    }
  }

  return {
    ok: true,
    chartOfAccountsId: String(coa.id),
    accountsId: String(ledgerAccount.id),
  }
}
