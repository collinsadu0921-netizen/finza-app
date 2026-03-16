"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter } from "next/navigation"
import { getActiveFirmId } from "@/lib/firmSession"
import Link from "next/link"

type Metrics = {
  active_clients: number
  pending_engagements: number
  suspended_engagements: number
  clients_blocked_by_preflight: number
  periods_awaiting_close: number
}

type Alert = {
  type: string
  client_name: string
  client_id: string
  timestamp: string
  link: string
}

export default function FirmOpsPage() {
  const router = useRouter()
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [firmId, setFirmId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    const activeFirmId = getActiveFirmId()
    if (!activeFirmId) {
      router.push("/accounting/firm")
      return
    }

    setFirmId(activeFirmId)
    loadUserRole(activeFirmId)
    loadMetrics(activeFirmId)
    loadAlerts(activeFirmId)
  }, [router])

  const loadUserRole = async (firmId: string) => {
    try {
      // The GET endpoint for onboarding status returns user_role
      const response = await fetch(`/api/accounting/firm/onboarding/complete?firm_id=${firmId}`)
      if (response.ok) {
        const data = await response.json()
        setUserRole(data.user_role || null)
      }
    } catch (error) {
      console.error("Error loading user role:", error)
    }
  }

  const loadMetrics = async (firmId: string) => {
    try {
      const response = await fetch(`/api/accounting/firm/ops/metrics?firm_id=${firmId}`)
      if (response.ok) {
        const data = await response.json()
        setMetrics(data)
      }
    } catch (error) {
      console.error("Error loading metrics:", error)
    } finally {
      setLoading(false)
    }
  }

  const loadAlerts = async (firmId: string) => {
    try {
      const response = await fetch(`/api/accounting/firm/ops/alerts?firm_id=${firmId}`)
      if (response.ok) {
        const data = await response.json()
        setAlerts(data.alerts || [])
      }
    } catch (error) {
      console.error("Error loading alerts:", error)
    }
  }

  const getAlertTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      engagement_pending: "Engagement Pending Acceptance",
      engagement_suspended: "Engagement Suspended",
      preflight_failure: "Preflight Failure",
      period_awaiting_close: "Period Awaiting Close",
      afs_draft_awaiting_finalization: "AFS Draft Awaiting Finalization",
    }
    return labels[type] || type
  }

  const getAlertTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      engagement_pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
      engagement_suspended: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
      preflight_failure: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
      period_awaiting_close: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
      afs_draft_awaiting_finalization: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    }
    return colors[type] || "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
  }

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp)
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-600 dark:text-gray-400">Loading operational metrics...</div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Firm Operations</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Operational status overview • No accounting data shown
              </p>
            </div>
            <Link
              href="/accounting/firm"
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>

        {/* Metrics Cards */}
        {metrics && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                Active Clients
              </div>
              <div className="text-3xl font-bold text-gray-900 dark:text-white">
                {metrics.active_clients}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                Pending Engagements
              </div>
              <div className="text-3xl font-bold text-yellow-600 dark:text-yellow-400">
                {metrics.pending_engagements}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                Suspended Engagements
              </div>
              <div className="text-3xl font-bold text-orange-600 dark:text-orange-400">
                {metrics.suspended_engagements}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                Blocked by Preflight
              </div>
              <div className="text-3xl font-bold text-red-600 dark:text-red-400">
                {metrics.clients_blocked_by_preflight}
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
              <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-1">
                Periods Awaiting Close
              </div>
              <div className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                {metrics.periods_awaiting_close}
              </div>
            </div>
          </div>
        )}

        {/* Notifications Panel */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Operational Alerts
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Actionable items requiring attention
            </p>
          </div>

          <div className="p-6">
            {alerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>No alerts at this time</p>
                <p className="text-sm mt-1">All operations are running smoothly</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-center space-x-4 flex-1">
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${getAlertTypeColor(
                          alert.type
                        )}`}
                      >
                        {getAlertTypeLabel(alert.type)}
                      </span>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 dark:text-white">
                          {alert.client_name}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {formatTimestamp(alert.timestamp)}
                        </div>
                      </div>
                    </div>
                    <Link
                      href={alert.link}
                      className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                    >
                      View →
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Info Banner */}
        <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg
                className="h-5 w-5 text-blue-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Operational Status Only:</strong> This dashboard shows operational metrics
                and alerts only. No client financial data or ledger information is displayed here.
              </p>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
