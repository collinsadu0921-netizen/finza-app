import Link from "next/link"

/** Muted dashboard entry to Help Center — visible but not dominant. */
export default function DashboardHelpLink() {
  return (
    <Link
      href="/help"
      className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 sm:w-auto dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
    >
      <svg
        className="h-3.5 w-3.5 shrink-0 opacity-80"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" strokeWidth={2} />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3m.08 4h.01"
        />
      </svg>
      Help & Support
    </Link>
  )
}
