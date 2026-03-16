"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

type ReadinessBannerProps = {
  ready: boolean | null
  authoritySource: "owner" | "employee" | "accountant" | null
  businessId: string | null
  onInitSuccess?: () => void
}

/**
 * Owner/employee: when !ready shows WARNING + [Initialize Accounting].
 * Accountant: when !ready shows INFO only (no button).
 */
export default function ReadinessBanner({
  ready,
  authoritySource,
  businessId,
  onInitSuccess,
}: ReadinessBannerProps) {
  const router = useRouter()
  const [initializing, setInitializing] = useState(false)

  if (ready !== false || !businessId) return null

  const isOwnerOrEmployee = authoritySource === "owner" || authoritySource === "employee"

  const handleInitialize = async () => {
    if (!businessId || initializing) return
    setInitializing(true)
    try {
      const res = await fetch(`/api/accounting/initialize?business_id=${encodeURIComponent(businessId)}`, {
        method: "POST",
      })
      if (res.ok) {
        onInitSuccess?.()
        router.refresh()
      }
    } finally {
      setInitializing(false)
    }
  }

  if (isOwnerOrEmployee) {
    return (
      <div className="mb-6 rounded-lg border-2 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-amber-800 dark:text-amber-200 font-medium text-sm">
          Accounting is not initialized.
        </span>
        <button
          onClick={handleInitialize}
          disabled={initializing}
          className="shrink-0 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium"
        >
          {initializing ? "Initializing…" : "Initialize Accounting"}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-4 py-3 text-blue-800 dark:text-blue-200 text-sm">
      Accounting has not been initialized by the business owner.
    </div>
  )
}
