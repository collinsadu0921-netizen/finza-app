"use client"

import DashboardHelpLink from "@/components/support/DashboardHelpLink"

type DashboardTopActionsProps = {
  onRefresh: () => void
  refreshing?: boolean
}

/** Compact glass toolbar for dashboard header actions. */
export default function DashboardTopActions({
  onRefresh,
  refreshing = false,
}: DashboardTopActionsProps) {
  return (
    <div
      className="inline-flex w-full items-center rounded-xl border border-slate-200/70 bg-white/75 p-1 shadow-[0_1px_3px_rgba(15,23,42,0.06)] backdrop-blur-md sm:w-auto dark:border-slate-700/70 dark:bg-slate-900/55"
      role="toolbar"
      aria-label="Dashboard actions"
    >
      <DashboardHelpLink variant="toolbar" className="flex-1 justify-center sm:flex-none sm:justify-start" />
      <div
        className="mx-0.5 hidden h-5 w-px shrink-0 bg-slate-200/90 sm:block dark:bg-slate-700/90"
        aria-hidden
      />
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        title="Refresh dashboard"
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium tracking-tight text-slate-600 transition-all duration-200 hover:bg-slate-100/80 hover:text-slate-900 disabled:opacity-50 sm:flex-none dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white"
      >
        <svg
          className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refresh
      </button>
    </div>
  )
}
