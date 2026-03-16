"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function InvoiceCreateRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/service/invoices/new")
  }, [router])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}


