"use client"

import { useRouter, useSearchParams } from "next/navigation"

/**
 * Explicit access-denied screen for users who hit /accounting/* without firm access.
 * Replaces silent redirect to dashboard so behavior is deterministic and visible.
 */
export default function AccountingAccessDeniedPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get("return") || "control-tower"

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-6 text-center">
        <h1 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-2">
          Access denied
        </h1>
        <p className="text-sm text-red-700 dark:text-red-300 mb-4">
          The Accounting workspace is for accountant firm users only. Business owners use the Service or Retail dashboard for day-to-day operations.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() =>
              router.push(
                returnTo === "firm" ? "/accounting/firm" : "/accounting/control-tower"
              )
            }
            className="inline-block px-4 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
          >
            Return to Accounting
          </button>
        </div>
      </div>
    </div>
  )
}
