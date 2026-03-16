"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

type Automation = {
  id: string
  name: string
  description: string | null
  trigger_type: "event" | "schedule"
  event_type: "invoice_overdue" | "invoice_due_soon" | "payment_received" | "vat_filing_deadline" | null
  schedule_type: "daily" | "monthly" | null
  enabled: boolean
  last_run_at: string | null
  created_at: string
}

export default function ServiceAutomationsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [automations, setAutomations] = useState<Automation[]>([])

  useEffect(() => {
    loadAutomations()
  }, [])

  const loadAutomations = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Fetch automations
      const response = await fetch(`/api/automations?business_id=${business.id}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        // Handle service unavailable (table doesn't exist)
        if (response.status === 503) {
          setError(errorData.error || "Automations feature is not available. Please run the database migration to enable this feature.")
          setAutomations([]) // Set empty array instead of failing
          setLoading(false)
          return
        }

        throw new Error(errorData.error || `Failed to load automations (${response.status})`)
      }

      const { automations: automationsData } = await response.json()
      setAutomations(automationsData || [])
      setLoading(false)
    } catch (err: any) {
      console.error("Error loading automations:", err)
      setError(err.message || "Failed to load automations")
      setLoading(false)
    }
  }

  const toggleAutomation = async (automationId: string, enabled: boolean) => {
    try {
      setSaving(automationId)
      setError("")
      setSuccess("")

      const response = await fetch(`/api/automations/${automationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to update automation")
      }

      // Update local state
      setAutomations(
        automations.map((auto) =>
          auto.id === automationId ? { ...auto, enabled } : auto
        )
      )

      setSuccess(`Automation ${enabled ? "enabled" : "disabled"} successfully`)
      setTimeout(() => setSuccess(""), 3000)
    } catch (err: any) {
      console.error("Error toggling automation:", err)
      setError(err.message || "Failed to update automation")
      setTimeout(() => setError(""), 5000)
    } finally {
      setSaving(null)
    }
  }

  const getTriggerLabel = (automation: Automation): string => {
    if (automation.trigger_type === "event") {
      const eventLabels: Record<string, string> = {
        invoice_overdue: "Invoice Overdue",
        invoice_due_soon: "Invoice Due Soon",
        payment_received: "Payment Received",
        vat_filing_deadline: "VAT Filing Deadline",
      }
      return eventLabels[automation.event_type || ""] || "Event"
    } else {
      const scheduleLabels: Record<string, string> = {
        daily: "Daily",
        monthly: "Monthly",
      }
      return scheduleLabels[automation.schedule_type || ""] || "Schedule"
    }
  }

  const formatLastRun = (lastRunAt: string | null): string => {
    if (!lastRunAt) return "Never"
    const date = new Date(lastRunAt)
    return date.toLocaleString()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="p-6">
            <p className="text-gray-600 dark:text-gray-400">Loading automations...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Automations
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            Configure automated notifications and emails. Automations do not modify financial data.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 text-green-700 dark:text-green-400 px-4 py-3 rounded mb-6">
            {success}
          </div>
        )}

        {automations.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-12 border border-gray-100 dark:border-gray-700 text-center">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <p className="text-gray-600 dark:text-gray-400 text-lg mb-2">No automations available</p>
            <p className="text-gray-500 dark:text-gray-500 text-sm">Automations will appear here once configured</p>
          </div>
        ) : (
          <div className="space-y-4">
            {automations.map((automation) => (
              <div
                key={automation.id}
                className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {automation.name}
                        </h3>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300">
                          {getTriggerLabel(automation)}
                        </span>
                      </div>
                      {automation.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          {automation.description}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500">
                        <span>Last run: {formatLastRun(automation.last_run_at)}</span>
                      </div>
                    </div>
                    <div className="ml-4 flex items-center">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={automation.enabled}
                          onChange={(e) => toggleAutomation(automation.id, e.target.checked)}
                          disabled={saving === automation.id}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            <strong>Note:</strong> Automations only send notifications and emails. They do not modify financial data or invoice/payment records.
          </p>
        </div>
      </div>
    </div>
  )
}
