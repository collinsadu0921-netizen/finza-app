"use client"

import { useEffect } from "react"
import { useRouter, useParams, useSearchParams } from "next/navigation"
import { buildAccountingRoute } from "@/lib/accounting/routes"

export default function AccountEditRedirect() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const accountId = params.id as string
  const businessId = searchParams.get("business_id")?.trim() ?? null

  useEffect(() => {
    // Redirect to canonical chart of accounts (or accounting home if no business context)
    if (accountId) {
      const target = businessId
        ? buildAccountingRoute("/accounting/chart-of-accounts", businessId)
        : "/accounting"
      router.replace(target)
    }
  }, [router, accountId, businessId])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}


