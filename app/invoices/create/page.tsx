"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { replaceIfChanged } from "@/lib/navigation/safeReplace"

export default function InvoiceCreateRedirect() {
  const router = useRouter()
  const pathname = usePathname() ?? "/service/invoices/create"

  useEffect(() => {
    replaceIfChanged(router, pathname, "", "/service/invoices/new")
  }, [router, pathname])

  return (
    <div className="p-6">
      <p>Redirecting...</p>
    </div>
  )
}


