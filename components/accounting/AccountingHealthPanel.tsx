"use client"

/**
 * Accounting health for the current client: readiness, last closed period, mismatches, unposted count.
 * Uses data from existing APIs (readiness, client-summary); no new endpoints.
 */

export interface AccountingHealthPanelProps {
  ready: boolean | null
  lastClosedPeriodId?: string | null
  openMismatchesCount?: number
  unpostedJournalsCount?: number
  loading?: boolean
}

export default function AccountingHealthPanel({
  ready,
  lastClosedPeriodId,
  openMismatchesCount = 0,
  unpostedJournalsCount = 0,
  loading = false,
}: AccountingHealthPanelProps) {
  return (
    <section className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 p-4">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Accounting health
      </h2>
      {loading ? (
        <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      ) : (
        <ul className="space-y-1.5 text-sm text-gray-700 dark:text-gray-300">
          <li>
            Readiness:{" "}
            <span
              className={
                ready === true
                  ? "text-green-600 dark:text-green-400 font-medium"
                  : "text-amber-600 dark:text-amber-400 font-medium"
              }
            >
              {ready === true ? "Ready" : "Not initialized"}
            </span>
          </li>
          <li>
            Last closed period:{" "}
            {lastClosedPeriodId ? "Yes" : "—"}
          </li>
          <li>Open mismatches: {openMismatchesCount}</li>
          <li>Unposted journals: {unpostedJournalsCount}</li>
        </ul>
      )}
    </section>
  )
}
