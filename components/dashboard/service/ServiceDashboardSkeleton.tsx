"use client"

export default function ServiceDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
        <div className="h-8 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 w-28 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>

      {/* Primary KPI grid */}
      <div>
        <div className="mb-2 h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50" />
          ))}
        </div>
      </div>

      {/* Secondary KPI grid */}
      <div>
        <div className="mb-2 h-4 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50" />
          ))}
        </div>
      </div>

      {/* Trends + Activity row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 h-80 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50" />
        <div className="h-80 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50" />
      </div>
    </div>
  )
}
