import type { SupabaseClient } from "@supabase/supabase-js"
import { getCurrentBusiness } from "@/lib/business"
import { checkAccountingAuthority, type AccountingAuthorityResult } from "@/lib/accounting/auth"

/**
 * Retail workspace gate for ledger-backed reports under `/api/retail/reports/*`.
 *
 * - Resolves business from session (`getCurrentBusiness`), not URL `business_id`.
 * - Restricts to `industry === "retail"`.
 * - Reuses {@link checkAccountingAuthority} as domain-neutral business RBAC (owner/admin/manager with reports.view, etc.).
 */
export type RetailLedgerReportGate =
  | {
      ok: true
      businessId: string
      authoritySource: NonNullable<AccountingAuthorityResult["authority_source"]>
    }
  | { ok: false; status: number; error: string }

export async function gateRetailLedgerReportAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<RetailLedgerReportGate> {
  const business = await getCurrentBusiness(supabase, userId)
  if (!business) {
    return { ok: false, status: 404, error: "No business found for your account." }
  }

  const industry = String(business.industry ?? "").toLowerCase()
  if (industry !== "retail") {
    return {
      ok: false,
      status: 403,
      error: "This retail report is only available when your active business is a retail business.",
    }
  }

  const auth = await checkAccountingAuthority(supabase, userId, business.id, "read")
  if (!auth.authorized) {
    return {
      ok: false,
      status: 403,
      error: "You don’t have permission to view financial reports for this business.",
    }
  }

  if (!auth.authority_source) {
    return {
      ok: false,
      status: 500,
      error: "Could not determine access for this report. Try again or contact support.",
    }
  }

  return { ok: true, businessId: business.id, authoritySource: auth.authority_source }
}
