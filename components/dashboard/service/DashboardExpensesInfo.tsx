"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import { formatMoney } from "@/lib/money"

type BreakdownLine = {
  key: string
  label: string
  hint: string
  amount: number
}

type BreakdownPayload = {
  period_start: string
  period_end: string
  total: number
  lines: BreakdownLine[]
}

export type DashboardExpensesInfoProps = {
  businessId?: string
  periodStart?: string
  periodEnd?: string
  /** Displayed expenses figure beside this icon (for context only). */
  displayTotal: number
  currencyCode?: string
  /** Optional class for the trigger button. */
  className?: string
  /** Popover horizontal anchor relative to the icon. */
  popoverAlign?: "left" | "right"
}

function formatPeriodRange(start: string, end: string): string {
  const s = new Date(start + "T12:00:00")
  const e = new Date(end + "T12:00:00")
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return s.toLocaleDateString(undefined, { month: "short", year: "numeric" })
  }
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className={className}
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.25" />
      <path
        d="M8 7.1V11"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="8" cy="5.15" r="0.75" fill="currentColor" />
    </svg>
  )
}

export default function DashboardExpensesInfo({
  businessId,
  periodStart,
  periodEnd,
  displayTotal,
  currencyCode = DEFAULT_PLATFORM_CURRENCY_CODE,
  className = "",
  popoverAlign = "left",
}: DashboardExpensesInfoProps) {
  const popoverId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<BreakdownPayload | null>(null)

  const canFetch =
    !!businessId &&
    !!periodStart &&
    !!periodEnd &&
    /^\d{4}-\d{2}-\d{2}$/.test(periodStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)

  const fetchBreakdown = useCallback(async () => {
    if (!canFetch) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        business_id: businessId!,
        start_date: periodStart!,
        end_date: periodEnd!,
      })
      const res = await fetch(`/api/dashboard/expense-breakdown?${params.toString()}`, {
        credentials: "include",
      })
      const body = (await res.json().catch(() => null)) as BreakdownPayload & { error?: string }
      if (!res.ok) {
        throw new Error(body?.error ?? "Could not load expense breakdown")
      }
      setPayload(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load expense breakdown")
      setPayload(null)
    } finally {
      setLoading(false)
    }
  }, [businessId, canFetch, periodEnd, periodStart])

  useEffect(() => {
    if (!open || !canFetch) return
    void fetchBreakdown()
  }, [open, canFetch, fetchBreakdown])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  if (!canFetch) return null

  const periodLabel = formatPeriodRange(periodStart!, periodEnd!)
  const breakdownTotal = payload?.total ?? displayTotal
  const visibleLines = payload?.lines.filter((line) => line.amount !== 0) ?? []

  return (
    <span ref={rootRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        aria-label="How this expenses total is calculated"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40"
      >
        <InfoIcon className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Expenses breakdown"
          className={`absolute top-[calc(100%+6px)] z-50 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-slate-200/90 bg-white p-3 shadow-lg ring-1 ring-black/[0.04] ${
            popoverAlign === "right" ? "right-0" : "left-0"
          }`}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Expenses breakdown
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Ledger P&amp;L for {periodLabel}. Input VAT is posted to liabilities and is not
            included here.
          </p>

          {loading ? (
            <div className="mt-3 space-y-2" aria-busy="true">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-4 animate-pulse rounded bg-slate-100"
                  aria-hidden
                />
              ))}
            </div>
          ) : error ? (
            <p className="mt-3 text-xs text-red-600">{error}</p>
          ) : (
            <div className="mt-3 space-y-0">
              {(visibleLines.length > 0 ? visibleLines : (payload?.lines ?? [])).map((line) => (
                <div
                  key={line.key}
                  className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0"
                >
                  <span className="min-w-0 text-xs text-slate-600" title={line.hint}>
                    {line.label}
                  </span>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-slate-800">
                    {formatMoney(line.amount, currencyCode)}
                  </span>
                </div>
              ))}
              <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2">
                <span className="text-xs font-semibold text-slate-700">Total</span>
                <span className="text-xs font-semibold tabular-nums text-slate-900">
                  {formatMoney(breakdownTotal, currencyCode)}
                </span>
              </div>
            </div>
          )}

          <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
            Supplier bills count in the month they are issued (Open). Paying a bill later does
            not add expense again.
          </p>
        </div>
      ) : null}
    </span>
  )
}
