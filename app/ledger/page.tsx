import { redirect } from "next/navigation"
import { buildAccountingRoute } from "@/lib/accounting/routes"

/**
 * Wave 12: Legacy route — redirect only. No UI, no fetch.
 * Canonical: /accounting/ledger
 */
export default async function LedgerRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ business_id?: string }>
}) {
  const p = await searchParams
  const businessId = typeof p.business_id === "string" ? p.business_id.trim() : undefined
  redirect(businessId ? buildAccountingRoute("/accounting/ledger", businessId) : "/accounting")
}
