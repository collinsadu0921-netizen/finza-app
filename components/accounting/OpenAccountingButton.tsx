"use client"

import Link from "next/link"

type Props = {
  businessId: string
  children?: React.ReactNode
  className?: string
}

/**
 * Client accounting shortcut: links directly to client overview.
 * Use wherever client pages have "open accounting" entry points.
 */
export default function OpenAccountingButton({ businessId, children, className }: Props) {
  const href = `/accounting/clients/${encodeURIComponent(businessId)}/overview`
  return (
    <Link
      href={href}
      className={
        className ??
        "inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
      }
    >
      {children ?? "Open Accounting"}
    </Link>
  )
}
