"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"

type RequestStatus = "open" | "in_progress" | "completed" | "cancelled"

type FirmRequestRow = {
  id: string
  client_business_id: string
  client_name: string | null
  title: string
  status: RequestStatus
  due_at: string | null
  document_type: string | null
  created_at: string
}

const STATUS_OPTIONS: RequestStatus[] = ["open", "in_progress", "completed", "cancelled"]

const STATUS_STYLES: Record<RequestStatus, string> = {
  open: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
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

function isOverdue(request: FirmRequestRow): boolean {
  if (!request.due_at) return false
  if (request.status === "completed" || request.status === "cancelled") return false
  return new Date(request.due_at) < new Date()
}

export default function FirmRequestsPage() {
  const [allRequests, setAllRequests] = useState<FirmRequestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [statusFilter, setStatusFilter] = useState("")
  const [clientFilter, setClientFilter] = useState("")
  const [documentTypeFilter, setDocumentTypeFilter] = useState("")
  const [overdueOnly, setOverdueOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/requests?limit=500")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Failed to load (${res.status})`)
        setAllRequests([])
        return
      }
      setAllRequests(data.requests ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load requests")
      setAllRequests([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const clients = useMemo(() => {
    const seen = new Map<string, string>()
    for (const r of allRequests) {
      if (!seen.has(r.client_business_id)) {
        seen.set(r.client_business_id, r.client_name ?? `${r.client_business_id.slice(0, 8)}...`)
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allRequests])

  const documentTypes = useMemo(() => {
    return Array.from(
      new Set(
        allRequests
          .map((r) => r.document_type?.trim())
          .filter((v): v is string => Boolean(v))
      )
    ).sort((a, b) => a.localeCompare(b))
  }, [allRequests])

  const filtered = useMemo(() => {
    return allRequests.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (clientFilter && r.client_business_id !== clientFilter) return false
      if (documentTypeFilter && (r.document_type ?? "") !== documentTypeFilter) return false
      if (overdueOnly && !isOverdue(r)) return false
      return true
    })
  }, [allRequests, statusFilter, clientFilter, documentTypeFilter, overdueOnly])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Client requests</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Requests across all firm clients. Open a client request page to manage and update items.
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
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Document type</label>
                <select
                  value={documentTypeFilter}
                  onChange={(e) => setDocumentTypeFilter(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All document types</option>
                  {documentTypes.map((documentType) => (
                    <option key={documentType} value={documentType}>
                      {documentType}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end">
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={overdueOnly}
                    onChange={(e) => setOverdueOnly(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  Overdue only
                </label>
              </div>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {filtered.length} request{filtered.length !== 1 ? "s" : ""}
              {filtered.length !== allRequests.length ? ` (filtered from ${allRequests.length})` : ""}
            </p>
            {(statusFilter || clientFilter || documentTypeFilter || overdueOnly) && (
              <button
                onClick={() => {
                  setStatusFilter("")
                  setClientFilter("")
                  setDocumentTypeFilter("")
                  setOverdueOnly(false)
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
                    Title
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Document type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Due date
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
                      No requests match your filters.
                    </td>
                  </tr>
                ) : (
                  filtered.map((request) => {
                    const clientHref = `/accounting/clients/${encodeURIComponent(request.client_business_id)}/requests`
                    const overdue = isOverdue(request)
                    return (
                      <tr key={request.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-4 py-3 text-sm">
                          <Link
                            href={clientHref}
                            className="font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                          >
                            {request.client_name ?? `${request.client_business_id.slice(0, 8)}...`}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{request.title}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[request.status]}`}>
                            {request.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                          {request.document_type || "-"}
                        </td>
                        <td className={`px-4 py-3 text-sm whitespace-nowrap ${overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-gray-500 dark:text-gray-400"}`}>
                          {overdue ? "Overdue - " : ""}
                          {fmtDate(request.due_at)}
                        </td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap text-gray-500 dark:text-gray-400">
                          {fmtDate(request.created_at)}
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
