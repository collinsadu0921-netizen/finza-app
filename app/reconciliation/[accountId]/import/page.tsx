import { redirect } from "next/navigation"
import { buildAccountingRoute } from "@/lib/accounting/routes"

/**
 * Legacy route: redirect to canonical Accounting Reconciliation.
 */
export default async function ReconciliationImportRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ business_id?: string }>
}) {
  const p = await searchParams
  const businessId = typeof p.business_id === "string" ? p.business_id.trim() : undefined
  redirect(businessId ? buildAccountingRoute("/accounting/reconciliation", businessId) : "/accounting")
}
