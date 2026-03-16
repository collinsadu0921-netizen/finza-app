import type { SupabaseClient } from "@supabase/supabase-js"

export type AccountingReadinessResult = { ready: boolean }

/**
 * Detect if accounting core exists for a business without triggering bootstrap.
 * Checks: COA (accounts) or accounting_periods. No RPC bootstrap allowed.
 */
export async function checkAccountingReadiness(
  supabase: SupabaseClient,
  businessId: string
): Promise<AccountingReadinessResult> {
  const { count: accountsCount, error: accountsError } = await supabase
    .from("accounts")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .is("deleted_at", null)

  if (!accountsError && typeof accountsCount === "number" && accountsCount > 0) {
    return { ready: true }
  }

  const { count: periodsCount, error: periodsError } = await supabase
    .from("accounting_periods")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)

  if (!periodsError && typeof periodsCount === "number" && periodsCount > 0) {
    return { ready: true }
  }

  return { ready: false }
}
