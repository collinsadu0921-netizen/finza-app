"use client"

export type DashboardErrorBannerProps = {
  message?: string
  onRetry?: () => void
}

export default function DashboardErrorBanner({
  message = "We could not load your dashboard summary. Please refresh and try again.",
  onRetry,
}: DashboardErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-800 dark:bg-red-900/20"
    >
      <p className="text-sm font-medium text-red-800 dark:text-red-200">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200 dark:hover:bg-red-900/60"
        >
          Retry
        </button>
      )}
    </div>
  )
}
