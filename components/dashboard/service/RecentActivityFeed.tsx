"use client"

import Link from "next/link"
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import { formatMoney } from "@/lib/money"

export type ActivityItem = {
  id: string
  type: "invoice" | "expense" | "payment" | "customer" | "email"
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
  emptyHint?: string
  /** Max rows shown in the compact feed (default 5). */
  maxItems?: number
  /** When set, shown if more items exist than `maxItems`. */
  viewAllHref?: string
}

const TYPE_DOT: Record<string, string> = {
  invoice: "bg-blue-500",
  payment: "bg-emerald-500",
  expense: "bg-amber-500",
  customer: "bg-purple-500",
  email: "bg-sky-500",
}

const DEFAULT_MAX_ITEMS = 5

const INVOICE_NUMBER_RE = /\b(INV-[\w-]+)\b/i

/** Display-only copy; does not change API payloads. */
function formatActivityDescription(item: ActivityItem): string {
  const raw = item.description?.trim() || ""
  const invNum = raw.match(INVOICE_NUMBER_RE)?.[1]

  switch (item.type) {
    case "payment": {
      if (invNum) return `Payment received — Invoice ${invNum}`
      if (/^payment received/i.test(raw)) return raw
      if (/^payment/i.test(raw)) return raw.replace(/^payment/i, "Payment received")
      return raw ? `Payment received — ${raw}` : "Payment received"
    }
    case "invoice": {
      if (invNum) return `Invoice created — ${invNum}`
      if (/^invoice created/i.test(raw)) return raw
      return raw ? `Invoice created — ${raw}` : "Invoice activity"
    }
    case "expense": {
      if (/^expense/i.test(raw)) return raw.replace(/^expense/i, "Expense recorded")
      return raw ? `Expense recorded — ${raw}` : "Expense recorded"
    }
    case "customer": {
      if (/^new customer/i.test(raw)) return raw
      return raw ? `New customer — ${raw}` : "New customer added"
    }
    case "email":
      return raw || "Email update"
    default:
      return raw || "Activity"
  }
}

export default function RecentActivityFeed({
  items = [],
  currencyCode = DEFAULT_PLATFORM_CURRENCY_CODE,
  emptyMessage = "Nothing recent to show",
  emptyHint = "Create an invoice or record a payment to see activity here.",
  maxItems = DEFAULT_MAX_ITEMS,
  viewAllHref,
}: RecentActivityFeedProps) {
  const all = items ?? []
  const list = all.slice(0, maxItems)
  const showViewAll = Boolean(viewAllHref) && all.length > maxItems

  return (
    <div className="max-w-3xl min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/80 dark:bg-slate-900/40">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">
            Recent activity
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Latest invoices, payments, and updates
          </p>
        </div>
        {showViewAll ? (
          <Link
            href={viewAllHref!}
            className="shrink-0 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
          >
            View all
          </Link>
        ) : null}
      </div>
      <div>
        {list.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{emptyMessage}</p>
            {emptyHint ? (
              <p className="mt-1.5 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                {emptyHint}
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((item) => {
              const dot = TYPE_DOT[item.type] ?? "bg-slate-400"
              const displayCurrency = item.currencyCode ?? currencyCode
              const isFx = item.currencyCode && item.currencyCode !== currencyCode
              const label = formatActivityDescription(item)

              const row = (
                <div className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="leading-snug text-slate-700 dark:text-slate-200">{label}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                      {formatRelativeTime(item.timestamp)}
                    </p>
                  </div>
                  {item.amount != null && (
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      {isFx && (
                        <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {item.currencyCode}
                        </span>
                      )}
                      <span className="tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(item.amount, displayCurrency)}
                      </span>
                    </div>
                  )}
                </div>
              )

              return (
                <li key={item.id}>
                  {item.href ? (
                    <a
                      href={item.href}
                      className="block transition-colors hover:bg-slate-50/80 focus-visible:bg-slate-50/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500 dark:hover:bg-slate-800/40"
                    >
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
    const diffMins = Math.floor(diffMs / 60_000)
    const diffHours = Math.floor(diffMs / 3_600_000)
    const diffDays = Math.floor(diffMs / 86_400_000)
    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })
  } catch {
    return iso
  }
}
