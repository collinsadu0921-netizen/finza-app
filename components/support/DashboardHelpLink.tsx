"use client"

import Link from "next/link"
import { LifeBuoy } from "lucide-react"

type DashboardHelpLinkProps = {
  /** When nested inside `DashboardTopActions`, skip outer chrome. */
  variant?: "default" | "toolbar"
  className?: string
}

/** Muted, modern dashboard entry to Help Center — visible but not dominant. */
export default function DashboardHelpLink({
  variant = "default",
  className = "",
}: DashboardHelpLinkProps) {
  const isToolbar = variant === "toolbar"

  return (
    <Link
      href="/help"
      aria-label="Help & Support"
      title="Help & Support"
      className={[
        "group inline-flex items-center gap-2 text-[13px] font-medium tracking-tight transition-all duration-200",
        isToolbar
          ? "rounded-lg px-2.5 py-1.5 text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-white"
          : "rounded-full border border-slate-200/60 bg-white/80 px-3.5 py-2 text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-md hover:border-sky-200/80 hover:bg-sky-50/90 hover:text-sky-700 hover:shadow-[0_4px_14px_rgba(14,165,233,0.1)] dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-sky-500/30 dark:hover:bg-sky-950/40 dark:hover:text-sky-300",
        className,
      ].join(" ")}
    >
      <span
        className={[
          "flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 text-sky-600 transition-transform duration-200 group-hover:scale-105 dark:from-sky-950/80 dark:to-indigo-950/80 dark:text-sky-400",
          isToolbar ? "h-6 w-6" : "h-6 w-6",
        ].join(" ")}
      >
        <LifeBuoy className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
      </span>
      <span>Help</span>
    </Link>
  )
}
