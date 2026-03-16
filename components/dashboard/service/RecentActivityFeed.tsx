"use client"

import { formatMoney } from "@/lib/money"

export type ActivityItem = {
  id: string
  type: "invoice" | "expense" | "payment" | "customer"
  description: string
  amount?: number | null
  currencyCode?: string
  timestamp: string
  href?: string
}

export type RecentActivityFeedProps = {
  items?: ActivityItem[] | null
  currencyCode?: string
  emptyMessage?: string
  maxItems?: number
}

export default function RecentActivityFeed({
  items = [],
  currencyCode = "USD",
  emptyMessage = "No recent activity",
  maxItems = 10,
}: RecentActivityFeedProps) {
  const list = (items ?? []).slice(0, maxItems)

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/80">
      <h3 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
        Recent activity
      </h3>
      <div className="min-h-[120px]">
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {emptyMessage}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700">
            {list.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <a
                    href={item.href}
                    className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <span className="truncate text-gray-700 dark:text-gray-300">{item.description}</span>
                    {item.amount != null && (
                      <span className="shrink-0 tabular-nums text-gray-900 dark:text-white">
                        {formatMoney(item.amount, item.currencyCode ?? currencyCode)}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </a>
                ) : (
                  <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="truncate text-gray-700 dark:text-gray-300">{item.description}</span>
                    {item.amount != null && (
                      <span className="shrink-0 tabular-nums text-gray-900 dark:text-white">
                        {formatMoney(item.amount, item.currencyCode ?? currencyCode)}
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })
  } catch {
    return iso
  }
}
