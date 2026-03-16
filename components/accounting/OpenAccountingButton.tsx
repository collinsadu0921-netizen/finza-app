"use client"

import Link from "next/link"

type Props = {
  businessId: string
  children?: React.ReactNode
  className?: string
}

/**
 * Client accounting shortcut: links to accounting hub with business_id so context is set.
 * Use wherever client pages previously had "advanced accounting" entry points.
 */
export default function OpenAccountingButton({ businessId, children, className }: Props) {
  const href = `/accounting?business_id=${encodeURIComponent(businessId)}`
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
