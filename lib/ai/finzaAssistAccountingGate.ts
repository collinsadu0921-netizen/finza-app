import type { SupabaseClient } from "@supabase/supabase-js"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"

/**
 * Same access pattern as /api/accounting/reports/* — Finza Assist may read ledger reports only when allowed.
 */
export async function gateAccountingReportRead(
  supabase: SupabaseClient,
  userId: string,
  businessId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const auth = await checkAccountingAuthority(supabase, userId, businessId, "read")
  if (!auth.authorized) {
    return { ok: false, error: "You do not have accounting report access for this workspace." }
  }

  if (!canUserInitializeAccounting(auth.authority_source)) {
    const { ready } = await checkAccountingReadiness(supabase, businessId)
    if (!ready) {
      return {
        ok: false,
        error:
          "Accounting is not set up for this business yet. Complete accounting initialization to use ledger-based reports.",
      }
    }
  } else {
    await supabase.rpc("create_system_accounts", { p_business_id: businessId })
  }

  return { ok: true }
}
