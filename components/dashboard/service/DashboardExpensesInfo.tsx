"use client"

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { DEFAULT_PLATFORM_CURRENCY_CODE } from "@/lib/currency"
import {
  computeExpenseBreakdownPopoverPosition,
  EXPENSE_BREAKDOWN_POPOVER_WIDTH,
  isExpenseBreakdownMobileViewport,
} from "@/lib/dashboard/expenseBreakdownPopoverPosition"
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
  /** Optional class for the trigger wrapper. */
  className?: string
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
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
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

function ExpenseBreakdownContent({
  periodLabel,
  loading,
  error,
  payload,
  breakdownTotal,
  currencyCode,
}: {
  periodLabel: string
  loading: boolean
  error: string | null
  payload: BreakdownPayload | null
  breakdownTotal: number
  currencyCode: string
}) {
  const visibleLines = payload?.lines.filter((line) => line.amount !== 0) ?? []
  const linesToShow = visibleLines.length > 0 ? visibleLines : (payload?.lines ?? [])

  return (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Expenses breakdown
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Ledger P&amp;L for {periodLabel}. Input VAT is posted to liabilities and is not included
        here.
      </p>

      {loading ? (
        <div className="mt-4 space-y-2" aria-busy="true">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-slate-100" aria-hidden />
          ))}
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      ) : (
        <div className="mt-4 space-y-0">
          {linesToShow.map((line) => (
            <div
              key={line.key}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0 border-b border-slate-100 py-2.5 last:border-b-0"
            >
              <span
                className="min-w-0 text-sm leading-snug text-slate-600 [overflow-wrap:normal] [word-break:normal]"
                title={line.hint}
              >
                {line.label}
              </span>
              <span className="whitespace-nowrap text-right text-sm font-medium tabular-nums text-slate-800">
                {formatMoney(line.amount, currencyCode)}
              </span>
            </div>
          ))}
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-t border-slate-200 pt-2.5">
            <span className="text-sm font-semibold text-slate-700">Total</span>
            <span className="whitespace-nowrap text-right text-sm font-semibold tabular-nums text-slate-900">
              {formatMoney(breakdownTotal, currencyCode)}
            </span>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        Supplier bills count in the month they are issued (Open). Paying a bill later does not add
        expense again.
      </p>
    </>
  )
}

function MobileExpenseBreakdownSheet({
  open,
  onClose,
  titleId,
  children,
}: {
  open: boolean
  onClose: () => void
  titleId: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-end">
      <button
        type="button"
        aria-label="Close expenses breakdown"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative z-[1] w-full px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="mx-auto max-h-[min(85vh,640px)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xl ring-1 ring-black/[0.04]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" aria-hidden />
          <div className="sr-only" id={titleId}>
            Expenses breakdown
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

function DesktopExpenseBreakdownPopover({
  open,
  popoverId,
  titleId,
  coords,
  panelRef,
  onClose,
  children,
}: {
  open: boolean
  popoverId: string
  titleId: string
  coords: { top: number; left: number; width: number } | null
  panelRef: React.Ref<HTMLDivElement>
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open || !coords) return null

  return createPortal(
    <div
      id={popoverId}
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      className="fixed z-[55] rounded-xl border border-slate-200/90 bg-white p-4 shadow-xl ring-1 ring-black/[0.04]"
      style={{
        top: coords.top,
        left: coords.left,
        width: coords.width,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 32px - 96px)",
        overflowY: "auto",
      }}
    >
      <div className="sr-only" id={titleId}>
        Expenses breakdown
      </div>
      {children}
    </div>,
    document.body
  )
}

export default function DashboardExpensesInfo({
  businessId,
  periodStart,
  periodEnd,
  displayTotal,
  currencyCode = DEFAULT_PLATFORM_CURRENCY_CODE,
  className = "",
}: DashboardExpensesInfoProps) {
  const popoverId = useId()
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [useMobileSheet, setUseMobileSheet] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
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

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  const repositionPopover = useCallback(() => {
    if (useMobileSheet || !open || !triggerRef.current) return
    const triggerRect = triggerRef.current.getBoundingClientRect()
    const panelHeight = panelRef.current?.offsetHeight ?? 320
    setCoords(
      computeExpenseBreakdownPopoverPosition(
        triggerRect,
        panelHeight,
        EXPENSE_BREAKDOWN_POPOVER_WIDTH
      )
    )
  }, [open, useMobileSheet])

  useEffect(() => {
    if (!open || !canFetch) return
    void fetchBreakdown()
  }, [open, canFetch, fetchBreakdown])

  useEffect(() => {
    if (!open) return
    setUseMobileSheet(isExpenseBreakdownMobileViewport())
    const onResize = () => {
      const mobile = isExpenseBreakdownMobileViewport()
      setUseMobileSheet(mobile)
      if (!mobile) repositionPopover()
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open, repositionPopover])

  useLayoutEffect(() => {
    if (!open || useMobileSheet) {
      setCoords(null)
      return
    }
    repositionPopover()
  }, [open, useMobileSheet, repositionPopover, loading, error, payload])

  useEffect(() => {
    if (!open || useMobileSheet) return
    const onScroll = () => repositionPopover()
    window.addEventListener("scroll", onScroll, true)
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll, true)
      window.removeEventListener("resize", onScroll)
    }
  }, [open, useMobileSheet, repositionPopover])

  useEffect(() => {
    if (!open || useMobileSheet) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      close()
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [open, useMobileSheet, close])

  useEffect(() => {
    if (!open || !useMobileSheet) return
    panelRef.current?.focus()
  }, [open, useMobileSheet, loading])

  if (!canFetch) return null

  const periodLabel = formatPeriodRange(periodStart!, periodEnd!)
  const breakdownTotal = payload?.total ?? displayTotal

  const content = (
    <ExpenseBreakdownContent
      periodLabel={periodLabel}
      loading={loading}
      error={error}
      payload={payload}
      breakdownTotal={breakdownTotal}
      currencyCode={currencyCode}
    />
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="How this expenses total is calculated"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 ${className}`}
      >
        <InfoIcon className="h-3.5 w-3.5" />
      </button>

      {useMobileSheet ? (
        <MobileExpenseBreakdownSheet
          open={open}
          onClose={close}
          titleId={titleId}
        >
          <div ref={panelRef as React.RefObject<HTMLDivElement>} tabIndex={-1} className="outline-none">
            {content}
          </div>
        </MobileExpenseBreakdownSheet>
      ) : (
        <DesktopExpenseBreakdownPopover
          open={open}
          popoverId={popoverId}
          titleId={titleId}
          coords={coords}
          panelRef={panelRef}
          onClose={close}
        >
          {content}
        </DesktopExpenseBreakdownPopover>
      )}
    </>
  )
}
