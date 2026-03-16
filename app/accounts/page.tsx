import { redirect } from "next/navigation"

/**
 * Wave 12: Legacy route — redirect only. No UI, no fetch.
 * Canonical entry: /accounting/chart-of-accounts
 */
export default async function AccountsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ business_id?: string }>
}) {
  const p = await searchParams
  const businessId = typeof p.business_id === "string" ? p.business_id.trim() : undefined
  redirect(
    businessId
      ? `/accounting/chart-of-accounts?business_id=${encodeURIComponent(businessId)}`
      : "/accounting"
  )
}
