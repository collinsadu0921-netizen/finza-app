"use client"

import { useAccountingBusiness } from "@/lib/accounting/useAccountingBusiness"
import { useAccountingAuthority } from "@/lib/accounting/useAccountingAuthority"

export default function ServiceOwnerAccountingBanner() {
  const { businessId } = useAccountingBusiness()
  const { authority_source, loading } = useAccountingAuthority(businessId)

  if (loading || !businessId) return null
  if (authority_source !== "owner" && authority_source !== "employee") return null

  return (
    <div className="mb-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-2.5 text-sm text-blue-800 dark:text-blue-200">
      You&apos;re viewing your business accounting. External accountants access client books through Control Tower.
    </div>
  )
}
