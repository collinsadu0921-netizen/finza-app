"use client"

import { formatMoney } from "@/lib/money"

export type FinancialOverviewStripProps = {
  cashBalance: number
  accountsReceivable: number
  /** Ledger current liabilities total (same source as metrics.accountsPayable). */
  currentLiabilities: number
  /** Operational outstanding across unpaid invoices (not ledger AR). */
  unpaidInvoicesTotal: number
  unpaidInvoicesCount: number
  overdueInvoicesTotal?: number
  overdueInvoicesCount?: number
  currencyCode: string
  /** e.g. `As of Jun 1, 2026 · ` when position balances are as-of today. */
  positionAsOfPrefix?: string
  /** When false, ledger position cards show updating state (not fake zeros). */
  positionsReady?: boolean
}

type OverviewCardConfig = {
  key: string
  label: string
  value: number
  caption: string
  accent: string
  note?: string
}

function OverviewCard({
  label,
  value,
  caption,
  accent,
  note,
  currencyCode,
  valueTone = "default",
  preparing = false,
}: {
  label: string
  value: number
  caption: string
  accent: string
  note?: string
  currencyCode: string
  valueTone?: "default" | "negative"
  preparing?: boolean
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-700/80 dark:bg-slate-900/40">
      <span
        className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="pl-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {label}
        </div>
        {preparing ? (
          <div
            className="mt-1 h-5 w-24 animate-pulse rounded bg-slate-200/80 dark:bg-slate-700/80"
            aria-label={`${label} updating`}
            role="status"
          />
        ) : (
          <div
            className={`mt-0.5 text-base font-semibold tracking-tight tabular-nums ${
              valueTone === "negative"
                ? "text-red-600 dark:text-red-400"
                : "text-slate-900 dark:text-white"
            }`}
          >
            {formatMoney(value, currencyCode)}
          </div>
        )}
        <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {preparing ? "Updating…" : caption}
          </span>
          {!preparing && note ? (
            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-500">
              {note}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function ServiceDashboardFinancialOverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-[72px] animate-pulse rounded-xl border border-slate-200/80 bg-slate-100/80 dark:border-slate-700 dark:bg-slate-800/50"
          aria-hidden
        />
      ))}
    </div>
  )
}

export default function FinancialOverviewStrip({
  cashBalance,
  accountsReceivable,
  currentLiabilities,
  unpaidInvoicesTotal,
  unpaidInvoicesCount,
  overdueInvoicesTotal = 0,
  overdueInvoicesCount = 0,
  currencyCode,
  positionAsOfPrefix = "",
  positionsReady = true,
}: FinancialOverviewStripProps) {
  const asOf = positionAsOfPrefix

  const unpaidNoteParts: string[] = []
  if (unpaidInvoicesCount > 0) {
    unpaidNoteParts.push(
      unpaidInvoicesCount === 1 ? "1 unpaid invoice" : `${unpaidInvoicesCount} unpaid invoices`
    )
  }
  if (overdueInvoicesCount > 0) {
    unpaidNoteParts.push(
      overdueInvoicesCount === 1
        ? `${formatMoney(overdueInvoicesTotal, currencyCode)} overdue · 1 invoice`
        : `${formatMoney(overdueInvoicesTotal, currencyCode)} overdue · ${overdueInvoicesCount} invoices`
    )
  }

  const cashNegative = cashBalance < 0

  const cards: (OverviewCardConfig & {
    valueTone?: "default" | "negative"
  })[] = [
    {
      key: "cash",
      label: "Available cash",
      value: cashBalance,
      caption: `${asOf}Based on ledger records`,
      accent: cashNegative ? "#dc2626" : "#10b981",
      valueTone: cashNegative ? "negative" : "default",
    },
    {
      key: "unpaid",
      label: "Unpaid invoices",
      value: unpaidInvoicesTotal,
      caption: `${asOf}Operational outstanding`,
      accent: "#0ea5e9",
      note: unpaidNoteParts.length > 0 ? unpaidNoteParts.join(" · ") : undefined,
    },
    {
      key: "ar",
      label: "Customer balances",
      value: accountsReceivable,
      caption: `${asOf}Based on ledger records`,
      accent: "#4f46e5",
    },
    {
      key: "liabilities",
      label: "Bills and liabilities",
      value: currentLiabilities,
      caption: `${asOf}Based on ledger records`,
      accent: "#64748b",
    },
  ]

  return (
    <section aria-label="Financial overview">
      <h2 className="sr-only">Financial overview</h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <OverviewCard
            key={card.key}
            label={card.label}
            value={card.value}
            caption={card.caption}
            accent={card.accent}
            note={card.note}
            currencyCode={currencyCode}
            valueTone={card.valueTone}
            preparing={card.key !== "unpaid" && !positionsReady}
          />
        ))}
      </div>
    </section>
  )
}
