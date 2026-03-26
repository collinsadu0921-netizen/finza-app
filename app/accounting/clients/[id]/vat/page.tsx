"use client"

/**
 * Client VAT page — accountant-facing VAT summary for a specific client.
 *
 * Data sources (accounting-workspace-safe, no new backend logic):
 *   - /api/accounting/periods       → period selector
 *   - /api/accounting/exports/vat   → VAT opening/output/input/closing (CSV)
 *   - /api/accounting/exports/levies → NHIL/GETFund/COVID (CSV)
 *
 * The CSV responses are 2-row (header + data) and parsed inline.
 */

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"

type Period = {
  id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type VatData = {
  period: string
  opening_balance: number
  output_vat: number
  input_vat: number
  closing_balance: number
}

type LevyRow = {
  levy_code: string
  period: string
  debit_total: number
  credit_total: number
  closing_balance: number
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n")
  if (lines.length < 2) return []
  const headers = lines[0].split(",")
  return lines.slice(1).map((line) => {
    const values = line.split(",")
    return headers.reduce<Record<string, string>>((obj, h, i) => {
      obj[h.trim()] = (values[i] ?? "").trim()
      return obj
    }, {})
  })
}

function toNum(s: string | undefined): number {
  return parseFloat(s ?? "0") || 0
}

function fmt(n: number): string {
  return n.toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function periodToYM(periodStart: string): string {
  return periodStart.substring(0, 7) // "YYYY-MM-DD" → "YYYY-MM"
}

function StatusPill({ status }: { status: string }) {
  const classes: Record<string, string> = {
    open: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    soft_closed: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    locked: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  }
  const labels: Record<string, string> = { open: "Open", soft_closed: "Soft closed", locked: "Locked" }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${classes[status] ?? classes.locked}`}>
      {labels[status] ?? status}
    </span>
  )
}

function StatRow({ label, value, highlight }: { label: string; value: number; highlight?: "green" | "red" | "neutral" }) {
  const valueClass =
    highlight === "green"
      ? "text-green-700 dark:text-green-400"
      : highlight === "red"
        ? "text-red-700 dark:text-red-400"
        : "text-gray-900 dark:text-gray-100"
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${valueClass}`}>{fmt(value)}</span>
    </div>
  )
}

export default function ClientVatPage() {
  const params = useParams()
  const businessId = params.id as string

  const [periods, setPeriods] = useState<Period[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null)
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const [periodsError, setPeriodsError] = useState("")

  const [vatData, setVatData] = useState<VatData | null>(null)
  const [levies, setLevies] = useState<LevyRow[]>([])
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError, setDataError] = useState("")

  // Load available periods for selector
  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    async function load() {
      try {
        setPeriodsLoading(true)
        const res = await fetch(`/api/accounting/periods?business_id=${encodeURIComponent(businessId)}`)
        if (cancelled) return
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setPeriodsError(d.error || `Failed to load periods (${res.status})`)
          return
        }
        const data = await res.json()
        const list: Period[] = (data.periods ?? []).sort(
          (a: Period, b: Period) => b.period_start.localeCompare(a.period_start)
        )
        if (!cancelled) {
          setPeriods(list)
          if (list.length > 0) setSelectedPeriod(list[0])
        }
      } catch (e) {
        if (!cancelled) setPeriodsError(e instanceof Error ? e.message : "Failed to load periods")
      } finally {
        if (!cancelled) setPeriodsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [businessId])

  // Fetch VAT + levies whenever selected period changes
  const fetchVatData = useCallback(async (period: Period) => {
    const ym = periodToYM(period.period_start)
    setDataLoading(true)
    setDataError("")
    setVatData(null)
    setLevies([])
    try {
      const base = `/api/accounting/exports`
      const params = `business_id=${encodeURIComponent(businessId)}&period=${encodeURIComponent(ym)}`

      const [vatRes, leviesRes] = await Promise.all([
        fetch(`${base}/vat?${params}`),
        fetch(`${base}/levies?${params}`),
      ])

      if (!vatRes.ok) {
        const d = await vatRes.json().catch(() => ({}))
        throw new Error(d.error || `VAT data unavailable (${vatRes.status})`)
      }

      const vatCsv = await vatRes.text()
      const vatRows = parseCsv(vatCsv)
      if (vatRows.length > 0) {
        const r = vatRows[0]
        setVatData({
          period: r.period ?? ym,
          opening_balance: toNum(r.opening_balance),
          output_vat: toNum(r.output_vat),
          input_vat: toNum(r.input_vat),
          closing_balance: toNum(r.closing_balance),
        })
      }

      if (leviesRes.ok) {
        const levCsv = await leviesRes.text()
        const levRows = parseCsv(levCsv)
        setLevies(
          levRows.map((r) => ({
            levy_code: r.levy_code ?? "",
            period: r.period ?? ym,
            debit_total: toNum(r.debit_total),
            credit_total: toNum(r.credit_total),
            closing_balance: toNum(r.closing_balance),
          }))
        )
      }
    } catch (e) {
      setDataError(e instanceof Error ? e.message : "Failed to load VAT data")
    } finally {
      setDataLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    if (selectedPeriod) fetchVatData(selectedPeriod)
  }, [selectedPeriod, fetchVatData])

  // Build download URL helpers (triggers direct browser download of existing CSV endpoints)
  function vatDownloadUrl(): string {
    if (!selectedPeriod) return "#"
    const ym = periodToYM(selectedPeriod.period_start)
    return `/api/accounting/exports/vat?business_id=${encodeURIComponent(businessId)}&period=${encodeURIComponent(ym)}`
  }
  function leviesDownloadUrl(): string {
    if (!selectedPeriod) return "#"
    const ym = periodToYM(selectedPeriod.period_start)
    return `/api/accounting/exports/levies?business_id=${encodeURIComponent(businessId)}&period=${encodeURIComponent(ym)}`
  }

  const netVatPayable = vatData ? Math.max(vatData.output_vat - vatData.input_vat, 0) : 0
  const netVatRefund = vatData ? Math.max(vatData.input_vat - vatData.output_vat, 0) : 0

  const totalOutputLevies = levies.reduce((s, l) => s + l.credit_total, 0)
  const totalInputLevies = levies.reduce((s, l) => s + l.debit_total, 0)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">VAT Summary</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Ghana VAT, NHIL, and GETFund position by accounting period.
        </p>
      </div>

      {/* Period selector */}
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Accounting period
          </label>
          {periodsLoading ? (
            <div className="h-9 w-56 rounded-lg bg-gray-100 dark:bg-gray-700 animate-pulse" />
          ) : (
            <select
              value={selectedPeriod?.id ?? ""}
              onChange={(e) => {
                const p = periods.find((p) => p.id === e.target.value) ?? null
                setSelectedPeriod(p)
              }}
              className="w-56 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
            >
              {periods.length === 0 && <option value="">No periods available</option>}
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodToYM(p.period_start)} — {p.status}
                </option>
              ))}
            </select>
          )}
        </div>
        {selectedPeriod && (
          <div className="flex items-center gap-2">
            <StatusPill status={selectedPeriod.status} />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selectedPeriod.period_start} → {selectedPeriod.period_end}
            </span>
          </div>
        )}
        {selectedPeriod && (
          <div className="flex items-center gap-2 ml-auto">
            <a
              href={vatDownloadUrl()}
              download
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              ↓ VAT CSV
            </a>
            <a
              href={leviesDownloadUrl()}
              download
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              ↓ Levies CSV
            </a>
          </div>
        )}
      </div>

      {periodsError && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200">
          {periodsError}
        </div>
      )}

      {periods.length === 0 && !periodsLoading && !periodsError && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-12 text-center text-sm text-gray-500 dark:text-gray-400">
          No accounting periods found for this client.
        </div>
      )}

      {dataError && (
        <div className="mb-4 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-200">
          {dataError}
        </div>
      )}

      {dataLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      )}

      {!dataLoading && vatData && (
        <div className="space-y-6">
          {/* VAT */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">VAT (15%)</h2>
            </div>
            <div className="px-5 py-2">
              <StatRow label="Opening balance" value={vatData.opening_balance} />
              <StatRow label="Output VAT (credits — charged)" value={vatData.output_vat} highlight="red" />
              <StatRow label="Input VAT (debits — claimable)" value={vatData.input_vat} highlight="green" />
              <StatRow label="Closing balance" value={vatData.closing_balance} />
            </div>
          </div>

          {/* Levies */}
          {levies.length > 0 && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Levies — NHIL / GETFund {levies.some(l => l.levy_code === "COVID") ? "/ COVID" : ""}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      {["Levy", "Output (credits)", "Input (debits)", "Closing balance"].map((h) => (
                        <th key={h} className="px-5 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {levies.map((l) => (
                      <tr key={l.levy_code} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-5 py-3 text-sm font-medium text-gray-900 dark:text-white">{l.levy_code}</td>
                        <td className="px-5 py-3 text-sm tabular-nums text-red-700 dark:text-red-400">{fmt(l.credit_total)}</td>
                        <td className="px-5 py-3 text-sm tabular-nums text-green-700 dark:text-green-400">{fmt(l.debit_total)}</td>
                        <td className="px-5 py-3 text-sm tabular-nums text-gray-900 dark:text-gray-100">{fmt(l.closing_balance)}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 dark:bg-gray-900/50 font-semibold">
                      <td className="px-5 py-3 text-xs text-gray-500 dark:text-gray-400 uppercase">Total levies</td>
                      <td className="px-5 py-3 text-sm tabular-nums text-red-700 dark:text-red-400">{fmt(totalOutputLevies)}</td>
                      <td className="px-5 py-3 text-sm tabular-nums text-green-700 dark:text-green-400">{fmt(totalInputLevies)}</td>
                      <td className="px-5 py-3" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Net position */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Net position</h2>
            </div>
            <div className="px-5 py-2">
              <StatRow
                label="Net VAT payable (output − input)"
                value={netVatPayable}
                highlight={netVatPayable > 0 ? "red" : "neutral"}
              />
              {netVatRefund > 0 && (
                <StatRow label="VAT refund position" value={netVatRefund} highlight="green" />
              )}
              <StatRow label="Total output tax (VAT + levies)" value={vatData.output_vat + totalOutputLevies} highlight="red" />
              <StatRow label="Total input tax (VAT + levies)" value={vatData.input_vat + totalInputLevies} highlight="green" />
            </div>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            Source: accounting ledger via journal entry lines · period {periodToYM(selectedPeriod!.period_start)}
          </p>
        </div>
      )}
    </div>
  )
}
