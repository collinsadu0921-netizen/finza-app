"use client"

import { ServiceDashboardFinancialOverviewSkeleton } from "./FinancialOverviewStrip"
import { ServiceDashboardCollectionsFollowUpSkeleton } from "./CollectionsFollowUpSection"

export { ServiceDashboardFinancialOverviewSkeleton }
export { ServiceDashboardCollectionsFollowUpSkeleton }

/** Trends / profit performance panel — matches TrendsSection layout. */
export function ServiceDashboardTrendsPanelSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white dark:border-slate-700 dark:bg-slate-900/40"
      aria-hidden
    >
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5 dark:border-slate-800">
        <div className="h-4 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="border-b border-slate-100 px-4 py-4 sm:px-5 dark:border-slate-800">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-3 flex gap-3">
          <div className="h-10 flex-1 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-10 flex-1 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px]">
        <div className="border-b border-slate-100 px-4 py-4 lg:border-b-0 lg:border-r dark:border-slate-800">
          <div className="h-[156px] animate-pulse rounded-lg bg-slate-100/90 dark:bg-slate-800/50" />
          <div className="mt-3 h-[120px] animate-pulse rounded-lg bg-slate-50 dark:bg-slate-800/40" />
        </div>
        <div className="bg-slate-50/40 px-4 py-4 dark:bg-slate-800/20">
          <div className="h-32 animate-pulse rounded-lg border border-slate-200/70 bg-white dark:border-slate-700 dark:bg-slate-900/40" />
        </div>
      </div>
    </div>
  )
}

/** Compact recent activity — matches capped RecentActivityFeed layout. */
export function ServiceDashboardActivityPanelSkeleton() {
  return (
    <div className="max-w-3xl min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/80 dark:bg-slate-900/40">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <div className="h-4 w-28 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-1.5 h-3 w-44 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-2.5">
            <div className="mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-600" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3.5 w-full max-w-[220px] animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-2.5 w-16 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            </div>
            <div className="h-4 w-16 shrink-0 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ServiceDashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
      {/* Header skeleton */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
        <div className="h-8 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-600" />
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Quick actions */}
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-8 w-28 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        ))}
      </div>

      <ServiceDashboardFinancialOverviewSkeleton />
      </div>
      <ServiceDashboardTrendsPanelSkeleton />
      <ServiceDashboardCollectionsFollowUpSkeleton />
      <ServiceDashboardActivityPanelSkeleton />
    </div>
  )
}
