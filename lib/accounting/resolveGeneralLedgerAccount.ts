import type { SupabaseClient } from "@supabase/supabase-js"

export type GeneralLedgerAccountRow = {
  id: string
  code: string
  name: string
  type: string
}

/**
 * Resolve account for General Ledger APIs: prefer account_id, else unique account_code for business.
 */
export async function resolveGeneralLedgerAccount(
  supabase: SupabaseClient,
  businessId: string,
  accountId: string | null,
  accountCode: string | null
): Promise<{ account: GeneralLedgerAccountRow | null; error?: string }> {
  if (accountId?.trim()) {
    const { data, error } = await supabase
      .from("accounts")
      .select("id, code, name, type")
      .eq("id", accountId.trim())
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle()
    if (error) return { account: null, error: error.message }
    if (!data) return { account: null, error: "Account not found or does not belong to business" }
    return { account: data as GeneralLedgerAccountRow }
  }

  const code = accountCode?.trim()
  if (code) {
    const { data: rows, error } = await supabase
      .from("accounts")
      .select("id, code, name, type")
      .eq("business_id", businessId)
      .eq("code", code)
      .is("deleted_at", null)
      .limit(2)
    if (error) return { account: null, error: error.message }
    if (!rows?.length) return { account: null, error: "Account not found for the given account code" }
    if (rows.length > 1) return { account: null, error: "Multiple accounts match this code; use account_id" }
    return { account: rows[0] as GeneralLedgerAccountRow }
  }

  return { account: null, error: "Missing required parameter: account_id or account_code" }
}
