"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

type ProformaInvoice = {
  id: string
  proforma_number: string | null
  customer_id: string | null
  issue_date: string
  validity_date: string | null
  total: number
  status: "draft" | "sent" | "accepted" | "converted" | "cancelled" | "rejected"
  created_at: string
  customers?: {
    id: string
    name: string
    email: string | null
    phone: string | null
  } | null
}

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "accepted", label: "Accepted" },
  { key: "converted", label: "Converted" },
  { key: "cancelled", label: "Cancelled" },
]

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  accepted: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  converted: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  rejected: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
}

export default function ProformaListPage() {
  const router = useRouter()
  const [proformas, setProformas] = useState<ProformaInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  useEffect(() => {
    loadProformas()
  }, [statusFilter])

  const loadProformas = async () => {
    try {
      setLoading(true)
      setError("")

      const url = new URL("/api/proforma/list", window.location.origin)
      if (statusFilter !== "all") {
        url.searchParams.set("status", statusFilter)
      }

      const response = await fetch(url.toString())
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || "Failed to load proforma invoices")
      }

      const data = await response.json()
      setProformas(data.proformas || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load proforma invoices")
      setLoading(false)
    }
  }

  const getStatusBadge = (status: string) => (
    <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold mb-1 text-slate-900 dark:text-white">Proforma Invoices</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Manage your proforma invoices</p>
        </div>
        <button
          onClick={() => router.push("/service/proforma/create")}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Proforma
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Status Filter Tabs */}
      <div className="mb-6 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              statusFilter === tab.key
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table / Empty State */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center text-gray-500">
          Loading...
        </div>
      ) : proformas.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {statusFilter === "all" ? "No proforma invoices yet" : `No ${statusFilter} proformas`}
          </p>
          {statusFilter === "all" && (
            <button
              onClick={() => router.push("/service/proforma/create")}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
            >
              Create Your First Proforma
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Proforma #
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Issue Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Validity Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {proformas.map((pf) => (
                <tr
                  key={pf.id}
                  onClick={() => router.push(`/service/proforma/${pf.id}/view`)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">
                      {pf.proforma_number ?? "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      {pf.customers?.name ?? "—"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(pf.issue_date)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(pf.validity_date)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">
                      {Number(pf.total).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(pf.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
