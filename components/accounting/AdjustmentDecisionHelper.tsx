"use client"

import { useRouter } from "next/navigation"

export type AdjustmentPath = "reversal" | "adjustment" | "manual_entry"

type AdjustmentDecisionHelperProps = {
  businessId: string | null
  onSelect: (path: AdjustmentPath) => void
}

export default function AdjustmentDecisionHelper({
  businessId,
  onSelect,
}: AdjustmentDecisionHelperProps) {
  const router = useRouter()

  const handleReversal = () => {
    if (businessId) {
      router.push(`/accounting/ledger?business_id=${businessId}`)
    }
    onSelect("reversal")
  }

  const handleAdjustment = () => {
    onSelect("adjustment")
  }

  const handleManualEntry = () => {
    if (businessId) {
      router.push(`/accounting/journals/drafts/new?business_id=${businessId}`)
    } else {
      router.push("/accounting/journals/drafts/new")
    }
    onSelect("manual_entry")
  }

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        What do you want to do?
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Choose how you want to correct or record an accounting event.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          type="button"
          onClick={handleReversal}
          className="rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-left hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-md transition-all"
        >
          <div className="text-2xl mb-2" aria-hidden>↩️</div>
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
            Reverse an entry
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Use when a posted journal entry must be fully undone.
          </p>
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Open in Ledger →
          </span>
        </button>

        <button
          type="button"
          onClick={handleAdjustment}
          className="rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-left hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-md transition-all"
        >
          <div className="text-2xl mb-2" aria-hidden>✏️</div>
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
            Adjustment / reclassification
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Use when correcting account mapping, amount allocation, or period classification.
          </p>
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Show adjustment form →
          </span>
        </button>

        <button
          type="button"
          onClick={handleManualEntry}
          className="rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 text-left hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-md transition-all"
        >
          <div className="text-2xl mb-2" aria-hidden>📝</div>
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">
            New manual entry
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Use when recording a new accounting event.
          </p>
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Create journal draft →
          </span>
        </button>
      </div>
    </div>
  )
}
