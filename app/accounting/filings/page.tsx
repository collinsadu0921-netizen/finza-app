"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

type FilingStatus = "pending" | "in_progress" | "filed" | "accepted" | "rejected" | "cancelled"

type FirmFilingRow = {
  id: string
  client_business_id: string
  client_name: string | null
  filing_type: string
  status: FilingStatus
  period_id: string | null
  filed_at: string | null
  created_at: string
}

const STATUS_OPTIONS: FilingStatus[] = [
  "pending",
  "in_progress",
  "filed",
  "accepted",
  "rejected",
  "cancelled",
]

const STATUS_STYLES: Record<FilingStatus, string> = {
  pending: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  filed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  accepted: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  cancelled: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "-"
  try {
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })
      .format(new Date(iso))
  } catch {
    return iso
  }
}

function shortId(value: string | null): string {
  if (!value) return "-"
  return `${value.slice(0, 8)}...`
}

export default function FirmFilingsPage() {
  const [allFilings, setAllFilings] = useState<FirmFilingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [statusFilter, setStatusFilter] = useState("")
  const [filingTypeFilter, setFilingTypeFilter] = useState("")
  const [clientFilter, setClientFilter] = useState("")
  const [periodFilter, setPeriodFilter] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/filings?limit=500")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load (${res.status})`)
        setAllFilings([])
        return
      }
      setAllFilings(data.filings ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load filings")
      setAllFilings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const clients = useMemo(() => {
    const seen = new Map<string, string>()
    for (const filing of allFilings) {
      if (!seen.has(filing.client_business_id)) {
        seen.set(
          filing.client_business_id,
          filing.client_name ?? shortId(filing.client_business_id)
        )
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allFilings])

  const filingTypes = useMemo(() => {
    return Array.from(new Set(allFilings.map((f) => f.filing_type).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
  }, [allFilings])

  const periods = useMemo(() => {
    return Array.from(new Set(allFilings.map((f) => f.period_id).filter((v): v is string => Boolean(v))))
      .sort((a, b) => a.localeCompare(b))
  }, [allFilings])

  const filtered = useMemo(() => {
    return allFilings.filter((filing) => {
      if (statusFilter && filing.status !== statusFilter) return false
      if (filingTypeFilter && filing.filing_type !== filingTypeFilter) return false
      if (clientFilter && filing.client_business_id !== clientFilter) return false
      if (periodFilter && filing.period_id !== periodFilter) return false
      return true
    })
  }, [allFilings, statusFilter, filingTypeFilter, clientFilter, periodFilter])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Filings</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Filing records across all firm clients. Open a client filing page to manage individual filings.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="h-7 w-7 rounded-full border-b-2 border-blue-600 animate-spin" />
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Filing type</label>
                <select
                  value={filingTypeFilter}
                  onChange={(e) => setFilingTypeFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All filing types</option>
                  {filingTypes.map((filingType) => (
                    <option key={filingType} value={filingType}>
                      {filingType}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Client</label>
                <select
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All clients</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Period</label>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All periods</option>
                  {periods.map((periodId) => (
                    <option key={periodId} value={periodId}>
                      {shortId(periodId)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {filtered.length} filing{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== allFilings.length ? ` (filtered from ${allFilings.length})` : ""}
            </p>
            {(statusFilter || filingTypeFilter || clientFilter || periodFilter) && (
              <button
                onClick={() => {
                  setStatusFilter("")
                  setFilingTypeFilter("")
                  setClientFilter("")
                  setPeriodFilter("")
                }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800/60">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Client name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Filing type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Period
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Filed date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Created date
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                      No filings match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((filing) => {
                    const clientHref = `/accounting/clients/${encodeURIComponent(filing.client_business_id)}/filings`
                    return (
                      <tr key={filing.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-3 text-sm">
                          <Link
                            href={clientHref}
                            className="font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                          >
                            {filing.client_name ?? shortId(filing.client_business_id)}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{filing.filing_type}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[filing.status]}`}>
                            {filing.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                          {shortId(filing.period_id)}
                        </td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                          {fmtDate(filing.filed_at)}
                        </td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                          {fmtDate(filing.created_at)}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
