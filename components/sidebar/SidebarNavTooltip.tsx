"use client"

import type { ReactNode } from "react"

/** Tooltip shown only when the desktop sidebar is collapsed (icon rail). */
export default function SidebarNavTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="group/navtip relative flex w-full justify-center">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 hidden max-lg:!hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-800 opacity-0 shadow-md transition-opacity group-hover/navtip:opacity-100 group-focus-within/navtip:opacity-100 lg:block lg:group-hover/navtip:opacity-100 lg:group-focus-within/navtip:opacity-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      >
        {label}
      </span>
    </div>
  )
}
