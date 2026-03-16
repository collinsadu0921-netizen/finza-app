"use client"

import { useEffect } from "react"
import { useRouter, useParams } from "next/navigation"

export default function InvoiceViewRedirect() {
  const router = useRouter()
  const params = useParams()
  const invoiceId = params.id as string

  useEffect(() => {
    if (invoiceId) {
      router.replace(`/service/invoices/${invoiceId}/view`)
    }
  }, [router, invoiceId])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}


