"use client"

import Link from "next/link"
import { formatMoney } from "@/lib/money"

export type CollectionsFollowUpSectionProps = {
  cashCollected: number
  overdueCount: number | null
  currencyCode: string
  loadingOverdue?: boolean
  /** Optional link for cash collected (e.g. payments list). */
  cashReportHref?: string
  cashLinkLabel?: string
  /** Optional link for overdue invoices list. */
  overdueReportHref?: string
  overdueLinkLabel?: string
}

type FollowUpCardProps = {
  label: string
  value: string
  caption: string
  accent: string
  href?: string
  linkLabel?: string
  valueTone?: "default" | "negative"
}

function FollowUpCard({
  label,
  value,
  caption,
  accent,
  href,
  linkLabel,
  valueTone = "default",
}: FollowUpCardProps) {
  const inner = (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/80 dark:bg-slate-900/40">
      <span
        className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="pl-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {label}
        </div>
        <div
          className={`mt-0.5 text-base font-semibold tabular-nums tracking-tight ${
            valueTone === "negative" ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-white"
          }`}
        >
          {value}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{caption}</p>
        {href && linkLabel ? (
          <span className="mt-2 inline-flex text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
            {linkLabel}
            <span className="ml-0.5" aria-hidden>
              →
            </span>
          </span>
        ) : null}
      </div>
    </div>
  )

  if (href) {
    return (
      <Link
        href={href}
        aria-label={linkLabel ? `${linkLabel}: ${label}` : label}
        className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        {inner}
      </Link>
    )
  }

  return inner
}

export function ServiceDashboardCollectionsFollowUpSkeleton() {
  return (
    <div className="max-w-2xl space-y-2.5">
      <div className="h-4 w-36 animate-pulse rounded bg-slate-200 dark:bg-slate-700" aria-hidden />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-[88px] animate-pulse rounded-xl border border-slate-200/80 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/50"
            aria-hidden
          />
        ))}
      </div>
    </div>
  )
}

export default function CollectionsFollowUpSection({
  cashCollected,
  overdueCount,
  currencyCode,
  loadingOverdue = false,
  cashReportHref,
  cashLinkLabel = "View payments",
  overdueReportHref,
  overdueLinkLabel = "Review overdue invoices",
}: CollectionsFollowUpSectionProps) {
  const overdueValue =
    loadingOverdue || overdueCount == null ? "—" : String(Math.round(overdueCount))

  const overdueTone =
    !loadingOverdue && overdueCount != null && overdueCount > 0 ? "negative" : "default"

  return (
    <section aria-labelledby="collections-heading" className="max-w-2xl space-y-2.5">
      <div>
        <h2
          id="collections-heading"
          className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100"
        >
          Cash & collections
        </h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Money in and invoices that need your attention
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FollowUpCard
          label="Cash collected"
          value={formatMoney(cashCollected, currencyCode)}
          caption="Payments received in the selected period"
          accent="#6366f1"
          href={cashReportHref}
          linkLabel={cashReportHref ? cashLinkLabel : undefined}
        />
        <FollowUpCard
          label="Overdue invoices"
          value={overdueValue}
          caption={
            loadingOverdue
              ? "Checking overdue invoices…"
              : overdueCount != null && overdueCount > 0
                ? "Open invoices past their due date"
                : "No overdue invoices right now"
          }
          accent="#dc2626"
          href={overdueReportHref}
          linkLabel={overdueReportHref ? overdueLinkLabel : undefined}
          valueTone={overdueTone}
        />
      </div>
    </section>
  )
}
