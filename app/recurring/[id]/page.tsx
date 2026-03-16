"use client"

import { useEffect } from "react"
import { useRouter, useParams } from "next/navigation"

export default function RecurringInvoiceViewRedirect() {
  const router = useRouter()
  const params = useParams()
  const recurringId = params.id as string

  useEffect(() => {
    if (recurringId) {
      router.replace(`/recurring/${recurringId}/view`)
    }
  }, [router, recurringId])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}


