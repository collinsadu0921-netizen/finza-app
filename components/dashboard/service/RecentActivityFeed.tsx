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
  /** Fallback currency when an item carries no currencyCode (business home currency) */
  currencyCode?: string
  emptyMessage?: string
  maxItems?: number
}

const TYPE_DOT: Record<string, string> = {
  invoice: "bg-blue-500",
  payment: "bg-emerald-500",
  expense: "bg-amber-500",
  customer: "bg-purple-500",
}

export default function RecentActivityFeed({
  items = [],
  currencyCode = "GHS",
  emptyMessage = "No recent activity",
  maxItems = 10,
}: RecentActivityFeedProps) {
  const list = (items ?? []).slice(0, maxItems)

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h3 className="border-b border-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Recent activity
      </h3>
      <div className="min-h-[120px]">
        {list.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            {emptyMessage}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((item) => {
              const dot = TYPE_DOT[item.type] ?? "bg-slate-400"
              const displayCurrency = item.currencyCode ?? currencyCode
              const row = (
                <div className="flex items-center gap-3 px-4 py-3 text-sm">
                  {/* type dot */}
                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  {/* description */}
                  <span className="min-w-0 flex-1 truncate text-slate-700">
                    {item.description}
                  </span>
                  {/* amount */}
                  {item.amount != null && (
                    <span className="shrink-0 tabular-nums font-medium text-slate-900">
                      {formatMoney(item.amount, displayCurrency)}
                    </span>
                  )}
                  {/* relative time */}
                  <span className="shrink-0 text-xs text-slate-400">
                    {formatRelativeTime(item.timestamp)}
                  </span>
                </div>
              )

              return (
                <li key={item.id}>
                  {item.href ? (
                    <a href={item.href} className="block hover:bg-slate-50 transition-colors">
                      {row}
                    </a>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
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
    const diffMins  = Math.floor(diffMs / 60_000)
    const diffHours = Math.floor(diffMs / 3_600_000)
    const diffDays  = Math.floor(diffMs / 86_400_000)
    if (diffMins  < 1)  return "Just now"
    if (diffMins  < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays  < 7)  return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })
  } catch {
    return iso
  }
}
