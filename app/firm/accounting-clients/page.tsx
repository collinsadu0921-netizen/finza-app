"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { getActiveFirmId } from "@/lib/firmSession"
import { EngagementStatusBadge } from "@/components/EngagementStatusBadge"
import BooksOnlyBadge from "@/components/BooksOnlyBadge"

type Client = {
  id: string
  business_id: string
  business_name: string
  business_industry?: string | null
  access_level: "read" | "write" | "approve"
  engagement_status?: "pending" | "active" | "suspended" | "terminated"
  effective_from?: string
  effective_to?: string | null
  period_status: string
  period_start: string | null
  period_end: string | null
}

/**
 * Accounting Clients List Page
 * Step 9.2 Batch B
 * 
 * Shows all clients with active engagement for the firm.
 * Primary action: "Enter Accounting" button that switches context and redirects.
 */
export default function AccountingClientsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const returnTo = searchParams.get("return_to") ?? ""
  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState<Client[]>([])
  const [error, setError] = useState("")
  const [firmId, setFirmId] = useState<string | null>(null)

  useEffect(() => {
    loadClients()
  }, [])

  const loadClients = async () => {
    try {
      setLoading(true)
      setError("")

      const activeFirmId = getActiveFirmId()
      if (!activeFirmId) {
        setError("No firm selected. Please select a firm first.")
        setLoading(false)
        return
      }

      setFirmId(activeFirmId)

      const response = await fetch(`/api/accounting/firm/clients`)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load clients")
      }

      const data = await response.json()
      // Show effective engagements (accepted or active per migration 279)
      const effectiveClients = (data.clients || []).filter(
        (c: any) =>
          c.engagement_status === "active" || c.engagement_status === "accepted"
      )
      setClients(effectiveClients)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load clients")
      setLoading(false)
    }
  }

  const handleEnterAccounting = (client: Client) => {
    router.push(`/accounting/control-tower/${client.business_id}`)
  }

  const getPeriodStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; color: string }> = {
      open: { label: "Open", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
      soft_closed: { label: "Soft Closed", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
      locked: { label: "Locked", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
      none: { label: "No Period", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
    }
    const statusInfo = statusMap[status] || { label: status, color: "bg-gray-100 text-gray-800" }
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusInfo.color}`}>
        {statusInfo.label}
      </span>
    )
  }

  const getAccessLevelBadge = (level: string) => {
    const levelMap: Record<string, { label: string; color: string }> = {
      read: { label: "Read", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
      write: { label: "Write", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
      approve: { label: "Approve", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
    }
    const levelInfo = levelMap[level] || { label: level, color: "bg-gray-100 text-gray-800" }
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${levelInfo.color}`}>
        {levelInfo.label}
      </span>
    )
  }

  const formatPeriod = (periodStart: string | null) => {
    if (!periodStart) return "—"
    const date = new Date(periodStart)
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short" })
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8 flex justify-between items-start">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Accounting Clients
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Select a client to enter the Accounting Workspace
              </p>
              <div className="mt-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 inline-block">
                <p className="text-xs text-blue-800 dark:text-blue-200">
                  <strong>💡 Two ways to add clients:</strong>{" "}
                  <strong>External (Books-Only)</strong> — creates a new client business (no Finza account needed).{" "}
                  <strong>Existing Finza Users</strong> — add an engagement via Firm Dashboard → Quick Actions (coming soon).
                </p>
              </div>
            </div>
            <Link
              href="/firm/accounting-clients/add"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Add External Client (Books-Only)
            </Link>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading clients...</p>
            </div>
          )}

          {!loading && !error && (
            <>
              {clients.length === 0 ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
                  <p className="text-gray-600 dark:text-gray-400 mb-4">No active clients found</p>
                  <Link
                    href="/firm/accounting-clients/add"
                    className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Add External Client (Books-Only)
                  </Link>
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Client Name
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Engagement Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Access Level
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Period Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Period
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                        {clients.map((client) => (
                          <tr key={client.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-medium text-gray-900 dark:text-white">
                                  {client.business_name}
                                </div>
                                {client.business_industry === null && <BooksOnlyBadge />}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {client.engagement_status && (
                                <EngagementStatusBadge status={client.engagement_status as any} />
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {getAccessLevelBadge(client.access_level)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {getPeriodStatusBadge(client.period_status)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {formatPeriod(client.period_start)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <button
                                onClick={() => handleEnterAccounting(client)}
                                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors font-medium"
                              >
                                Enter Accounting
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
