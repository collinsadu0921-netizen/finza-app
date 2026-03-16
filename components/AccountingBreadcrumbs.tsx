"use client"

import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { getActiveFirmId, getActiveFirmName } from "@/lib/firmSession"

/**
 * Accounting Breadcrumbs Component
 * Shows Firm → Client navigation context
 * Displays "Firm → No client selected" when applicable
 */
export default function AccountingBreadcrumbs() {
  const pathname = usePathname()
  const [firmName, setFirmName] = useState<string | null>(null)
  const [clientName, setClientName] = useState<string | null>(null)

  const searchParams = useSearchParams()
  const urlBusinessId = searchParams.get("business_id")?.trim() ?? null

  useEffect(() => {
    const firm = getActiveFirmName()
    setFirmName(firm)
    setClientName(urlBusinessId ? `Client ${urlBusinessId.slice(0, 8)}…` : null)
  }, [pathname, urlBusinessId])

  // Only show in accounting workspace
  if (!pathname?.startsWith('/accounting')) {
    return null
  }

  // Don't show on firm dashboard (context is clear)
  if (pathname === '/accounting/firm') {
    return null
  }

  return (
    <nav className="text-sm text-gray-600 dark:text-gray-400 mb-4">
      <ol className="flex items-center space-x-2">
        <li>
          <span className="font-medium text-gray-900 dark:text-white">
            {firmName || "Firm"}
          </span>
        </li>
        <li>
          <span className="mx-2">→</span>
        </li>
        <li>
          <span className={clientName ? "font-medium text-gray-900 dark:text-white" : "text-gray-500 dark:text-gray-500"}>
            {clientName || "No client selected"}
          </span>
        </li>
      </ol>
    </nav>
  )
}
