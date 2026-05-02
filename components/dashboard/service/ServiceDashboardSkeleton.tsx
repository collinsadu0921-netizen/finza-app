"use client"

/** Primary + secondary metric card grids (matches cockpit KPI layout). */
export function ServiceDashboardMetricsCardsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"
          />
        ))}
      </div>
    </>
  )
}

/** Trends / chart column (lg:col-span-2). */
export function ServiceDashboardTrendsPanelSkeleton() {
  return (
    <div className="lg:col-span-2">
      <div className="h-72 w-full animate-pulse rounded-xl border border-slate-200 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/50" />
    </div>
  )
}

/** Recent activity column — card chrome matches RecentActivityFeed. */
export function ServiceDashboardActivityPanelSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
      <div className="h-10 animate-pulse border-b border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/30" />
      <div className="space-y-0 divide-y divide-slate-100 px-4 py-2 dark:divide-slate-800">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-600" />
            <div className="h-4 flex-1 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-4 w-16 shrink-0 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        ))}
      </div>
    </div>
  )
}

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

      <ServiceDashboardMetricsCardsSkeleton />

      {/* Trends + Activity row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ServiceDashboardTrendsPanelSkeleton />
        <ServiceDashboardActivityPanelSkeleton />
      </div>
    </div>
  )
}
