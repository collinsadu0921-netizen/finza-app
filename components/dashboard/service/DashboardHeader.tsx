"use client"

import { NativeSelect } from "@/components/ui/NativeSelect"

export type DashboardHeaderProps = {
  periodLabel: string
  currencyCode: string
  lastUpdatedLabel: string
  periodOptions?: { value: string; label: string }[]
  selectedPeriodStart?: string | null
  onPeriodChange?: (periodStart: string) => void
  showEmptyPeriodCta?: boolean
  onSwitchToLastActive?: () => void
  onRefresh?: () => void
}

export default function DashboardHeader({
  periodLabel,
  currencyCode,
  lastUpdatedLabel,
  periodOptions = [],
  selectedPeriodStart,
  onPeriodChange,
  showEmptyPeriodCta = false,
  onSwitchToLastActive,
  onRefresh,
}: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Period
          </span>
          {periodOptions.length > 0 && onPeriodChange ? (
            <NativeSelect
              size="sm"
              wrapperClassName="w-auto shrink-0"
              value={selectedPeriodStart ?? ""}
              onChange={(e) => onPeriodChange(e.target.value)}
              className="font-medium text-gray-900 dark:text-white"
            >
              {periodOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <span className="text-sm font-medium text-gray-900 dark:text-white">{periodLabel}</span>
          )}
        </div>
        <span className="text-gray-400 dark:text-gray-500">|</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Currency
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 dark:bg-gray-700 dark:text-gray-200">
            {currencyCode}
          </span>
        </div>
        <span className="text-gray-400 dark:text-gray-500">|</span>
        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {lastUpdatedLabel}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {showEmptyPeriodCta && onSwitchToLastActive && (
          <button
            type="button"
            onClick={onSwitchToLastActive}
            className="rounded border border-blue-600 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-500 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
          >
            Switch to last active period
          </button>
        )}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            title="Refresh dashboard"
            className="flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            Refresh
          </button>
        )}
      </div>
    </header>
  )
}
