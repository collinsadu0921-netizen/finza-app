"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"

interface Alert {
  id: string
  alert_type: string
  title: string
  message: string | null
  is_read: boolean
  created_at: string
  metadata: any
  invoices: {
    id: string
    invoice_number: string
    total: number
    customers: {
      id: string
      name: string
    } | null
  } | null
  payments: {
    id: string
    amount: number
    method: string
    date: string
  } | null
}

interface AlertsPanelProps {
  maxAlerts?: number
  showAllButton?: boolean
}

export default function AlertsPanel({ maxAlerts = 10, showAllButton = true }: AlertsPanelProps) {
  const router = useRouter()
  const toast = useToast()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [markingRead, setMarkingRead] = useState<string | null>(null)

  useEffect(() => {
    loadAlerts()
  }, [])

  const loadAlerts = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/alerts?unread_only=true&limit=${maxAlerts}`)
      
      // Even if response is not ok, try to parse JSON to get error details
      const data = await response.json()
      
      if (!response.ok) {
        // If it's a table not found error or similar, just return empty array
        if (data.error && (
          data.error.includes("does not exist") || 
          data.error.includes("relation") ||
          response.status === 500
        )) {
          console.warn("Alerts table may not exist, showing empty alerts")
          setAlerts([])
          return
        }
        throw new Error(data.error || "Failed to load alerts")
      }

      setAlerts(data.alerts || [])
    } catch (error: any) {
      console.error("Error loading alerts:", error)
      // Don't show error toast for missing table - just show empty state
      if (!error.message?.includes("does not exist") && !error.message?.includes("relation")) {
        toast.showToast("Failed to load alerts", "error")
      }
      setAlerts([])
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (alertId: string) => {
    try {
      setMarkingRead(alertId)
      const response = await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alert_id: alertId }),
      })

      if (!response.ok) {
        throw new Error("Failed to mark alert as read")
      }

      // Remove from list or update status
      setAlerts((prev) => prev.filter((alert) => alert.id !== alertId))
    } catch (error: any) {
      console.error("Error marking alert as read:", error)
      toast.showToast("Failed to mark alert as read", "error")
    } finally {
      setMarkingRead(null)
    }
  }

  const markAllAsRead = async () => {
    try {
      const response = await fetch("/api/alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all_read: true }),
      })

      if (!response.ok) {
        throw new Error("Failed to mark all alerts as read")
      }

      setAlerts([])
      toast.showToast("All alerts marked as read", "success")
    } catch (error: any) {
      console.error("Error marking all alerts as read:", error)
      toast.showToast("Failed to mark all alerts as read", "error")
    }
  }

  const formatCurrency = (amount: number) => {
    return `₵${Number(amount).toFixed(2)}`
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        </div>
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <div className="text-center py-8">
          <svg
            className="w-12 h-12 text-gray-400 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-gray-600 dark:text-gray-400 font-medium">No new alerts</p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">You're all caught up!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          Alerts ({alerts.length})
        </h3>
        <div className="flex gap-2">
          {alerts.length > 0 && (
            <button
              onClick={markAllAsRead}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
            >
              Mark all read
            </button>
          )}
          {showAllButton && (
            <button
              onClick={() => router.push("/alerts")}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
            >
              View all
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className="px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {alert.alert_type === "partial_payment" && (
                    <svg
                      className="w-5 h-5 text-yellow-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  )}
                  <h4 className="font-semibold text-gray-900 dark:text-white">{alert.title}</h4>
                </div>

                {alert.message && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{alert.message}</p>
                )}

                {alert.alert_type === "partial_payment" && alert.invoices && alert.payments && (
                  <div className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Invoice:</span>
                      <button
                        onClick={() => router.push(`/invoices/${alert.invoices!.id}/view`)}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {alert.invoices.invoice_number}
                      </button>
                      {alert.invoices.customers && (
                        <span className="text-gray-500">• {alert.invoices.customers.name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span>
                        Payment: <span className="font-medium">{formatCurrency(alert.payments.amount)}</span> ({alert.payments.method})
                      </span>
                      {alert.metadata?.outstanding_amount && (
                        <span>
                          Outstanding: <span className="font-medium text-orange-600 dark:text-orange-400">
                            {formatCurrency(alert.metadata.outstanding_amount)}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                  {formatDate(alert.created_at)}
                </p>
              </div>

              <button
                onClick={() => markAsRead(alert.id)}
                disabled={markingRead === alert.id}
                className="ml-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                title="Mark as read"
              >
                {markingRead === alert.id ? (
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

