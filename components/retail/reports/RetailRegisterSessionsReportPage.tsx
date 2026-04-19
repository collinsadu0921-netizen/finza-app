"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { retailPaths } from "@/lib/retail/routes"
import {
  RetailBackofficeAlert,
  RetailBackofficeBackLink,
  RetailBackofficeBadge,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeEmpty,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  RetailBackofficeSkeleton,
} from "@/components/retail/RetailBackofficeUi"

type RegisterVariance = {
  expected: number
  counted: number
  difference: number
} | null

type SessionRow = {
  id: string
  register_id: string
  register_name: string
  store_name: string | null
  cashier_name: string
  status: string
  started_at: string
  ended_at: string | null
  opening_cash: number
  closing_cash_counted: number | null
  total_cash_drops: number
  supervised_actions_count: number
  paid_sales_count: number
  paid_sales_total: number
  refunded_sales_count: number
  other_status_sales_count: number
  register_variance: RegisterVariance
}

type ApiResponse = {
  period: { start_date: string; end_date: string }
  store_id: string | null
  sessions: SessionRow[]
}

export default function RetailRegisterSessionsReportPage() {
  const router = useRouter()
  const { format } = useBusinessCurrency()
  const now = new Date()
  const today = now.toISOString().split("T")[0]
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [data, setData] = useState<ApiResponse | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError("")
      const qs = new URLSearchParams({ start_date: startDate, end_date: endDate })
      const res = await fetch(`/api/retail/reports/register-sessions?${qs.toString()}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error || "Failed to load register sessions")
        setData(null)
        return
      }
      setData(body as ApiResponse)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [startDate, endDate])

  const summary = useMemo(() => {
    const sessions = data?.sessions || []
    const open = sessions.filter((s) => s.status === "open").length
    const withVariance = sessions.filter((s) => s.register_variance && s.register_variance.difference !== 0).length
    const refunds = sessions.reduce((a, s) => a + s.refunded_sales_count, 0)
    const overrides = sessions.reduce((a, s) => a + (s.supervised_actions_count || 0), 0)
    return { open, withVariance, refunds, overrides, total: sessions.length }
  }, [data])

  const salesHistoryLink = (s: SessionRow) => {
    const from = data?.period.start_date || ""
    const to = data?.period.end_date || ""
    const q = new URLSearchParams()
    if (from) q.set("date_from", from)
    if (to) q.set("date_to", to)
    q.set("register_id", s.register_id)
    return `${retailPaths.salesHistory}?${q.toString()}`
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-6xl">
        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.dashboard)}>
          Back to dashboard
        </RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Sales & reports"
          title="Register sessions"
          description="Operational view of cashier sessions: opening float, counted close, cash drops, paid sales in session, refunds, and supervisor activity. Drill into sales history filtered by register and date."
        />

        <RetailBackofficeCard className="mb-6">
          <RetailBackofficeCardTitle className="mb-4">Date range</RetailBackofficeCardTitle>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/[0.08]"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-slate-600">End</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/[0.08]"
              />
            </div>
            <RetailBackofficeButton variant="primary" onClick={() => void load()} disabled={loading}>
              Refresh
            </RetailBackofficeButton>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Sessions are listed by <span className="font-medium">start time</span> within the range. Ledger cash proofing
            is not shown here — this report is for store control and investigation.
          </p>
        </RetailBackofficeCard>

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {loading ? (
          <RetailBackofficeSkeleton rows={8} />
        ) : !data?.sessions.length ? (
          <RetailBackofficeEmpty
            title="No sessions in this range"
            description="Try widening the dates or confirm registers were opened during the period."
          />
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <RetailBackofficeCard padding="p-4">
                <p className="text-xs text-slate-500">Sessions</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{summary.total}</p>
              </RetailBackofficeCard>
              <RetailBackofficeCard padding="p-4" className="border-amber-200/80 bg-amber-50/30">
                <p className="text-xs text-amber-950/80">Open</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-amber-950">{summary.open}</p>
              </RetailBackofficeCard>
              <RetailBackofficeCard padding="p-4" className="border-rose-200/80 bg-rose-50/30">
                <p className="text-xs text-rose-950/80">Close variance logged</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-rose-950">{summary.withVariance}</p>
              </RetailBackofficeCard>
              <RetailBackofficeCard padding="p-4">
                <p className="text-xs text-slate-500">Refunded tickets</p>
                <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{summary.refunds}</p>
              </RetailBackofficeCard>
            </div>

            <RetailBackofficeCard padding="p-0" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50/95 backdrop-blur-sm">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Started
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Register / store
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Cashier
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Paid sales
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Opening
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Counted close
                      </th>
                      <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Variance
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Supervisor events
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.sessions.map((s) => {
                      const v = s.register_variance
                      const hasV = v && Math.abs(v.difference) > 0.0001
                      return (
                        <tr key={s.id} className="hover:bg-slate-50/60">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-700">
                            {new Date(s.started_at).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="font-medium text-slate-900">{s.register_name}</div>
                            <div className="text-xs text-slate-500">{s.store_name || "—"}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">{s.cashier_name}</td>
                          <td className="px-4 py-3 text-center text-sm">
                            {s.status === "open" ? (
                              <RetailBackofficeBadge tone="warning">Open</RetailBackofficeBadge>
                            ) : (
                              <RetailBackofficeBadge tone="neutral">Closed</RetailBackofficeBadge>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums">
                            <div className="font-medium text-slate-900">{s.paid_sales_count}</div>
                            <div className="text-xs text-slate-500">{format(s.paid_sales_total)}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-slate-800">
                            {format(s.opening_cash)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-slate-800">
                            {s.closing_cash_counted != null ? format(s.closing_cash_counted) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums">
                            {!v ? (
                              <span className="text-slate-400">—</span>
                            ) : hasV ? (
                              <span className="font-semibold text-rose-800">{format(v.difference)}</span>
                            ) : (
                              <span className="text-emerald-800">0</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-center text-sm tabular-nums text-slate-700">
                            {s.supervised_actions_count || 0}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-center text-sm">
                            <RetailBackofficeButton
                              variant="ghost"
                              className="text-xs"
                              onClick={() => router.push(salesHistoryLink(s))}
                            >
                              Sales
                            </RetailBackofficeButton>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </RetailBackofficeCard>

            <RetailBackofficeCard className="mt-6" padding="p-4 sm:p-5">
              <RetailBackofficeCardTitle className="mb-2">How to read this</RetailBackofficeCardTitle>
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
                <li>
                  <span className="font-medium text-slate-800">Paid sales</span> counts tickets with payment status{" "}
                  <code className="rounded bg-slate-100 px-1">paid</code> linked to the session.
                </li>
                <li>
                  <span className="font-medium text-slate-800">Variance</span> comes from the close record when a
                  register variance was logged (expected vs counted).
                </li>
                <li>
                  <span className="font-medium text-slate-800">Supervisor actions</span> on the session (
                  {summary.overrides} total in view) indicate overrides during the shift — review those sales in history.
                </li>
              </ul>
            </RetailBackofficeCard>
          </>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}
