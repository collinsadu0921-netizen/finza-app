"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useToast } from "@/components/ui/ToastProvider"

type Exception = {
  id: string
  rule_code: string
  rule_description: string
  severity: "error" | "warning" | "info"
  status: "open" | "acknowledged" | "resolved"
  period_start: string | null
  metadata: any
  created_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  resolved_notes: string | null
}

export default function ExceptionsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [exceptions, setExceptions] = useState<Exception[]>([])
  const [error, setError] = useState("")
  const [selectedException, setSelectedException] = useState<Exception | null>(null)
  
  // Filters
  const [filterPeriod, setFilterPeriod] = useState<string>("")
  const [filterSeverity, setFilterSeverity] = useState<string>("")
  const [filterRuleCode, setFilterRuleCode] = useState<string>("")
  const [filterStatus, setFilterStatus] = useState<string>("")

  useEffect(() => {
    loadContext()
  }, [])

  useEffect(() => {
    if (businessId) {
      loadExceptions()
    }
  }, [businessId, filterPeriod, filterSeverity, filterRuleCode, filterStatus])

  const loadContext = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }
      const ctx = await resolveAccountingContext({ supabase, userId: user.id, searchParams, source: "workspace" })
      if ("error" in ctx) {
        setNoContext(true)
        setLoading(false)
        return
      }
      setBusinessId(ctx.businessId)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load context")
      setLoading(false)
    }
  }

  const loadExceptions = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      // TODO: Replace with actual API endpoint when exception system is implemented
      // const response = await fetch(`/api/accounting/exceptions?business_id=${businessId}&period_start=${filterPeriod}&severity=${filterSeverity}&rule_code=${filterRuleCode}&status=${filterStatus}`)
      // For now, return empty array as placeholder
      setExceptions([])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load exceptions")
      setLoading(false)
    }
  }

  const handleAcknowledge = async (exceptionId: string) => {
    try {
      // TODO: Replace with actual API endpoint
      // await fetch(`/api/accounting/exceptions/${exceptionId}/acknowledge`, { method: "POST" })
      await loadExceptions()
    } catch (err: any) {
      setError(err.message || "Failed to acknowledge exception")
    }
  }

  const handleResolve = async (exceptionId: string, notes: string) => {
    try {
      // TODO: Replace with actual API endpoint
      // await fetch(`/api/accounting/exceptions/${exceptionId}/resolve`, { method: "POST", body: JSON.stringify({ notes }) })
      await loadExceptions()
      setSelectedException(null)
    } catch (err: any) {
      setError(err.message || "Failed to resolve exception")
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (noContext) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p className="text-gray-600 dark:text-gray-400">Select a client or ensure you have an active business.</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-8">
            <div>
              <button
                onClick={() => router.push("/accounting")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Accounting Workspace
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Exception Review
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Review and resolve accounting exceptions (Silent Auditor)
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Info Banner */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-700 dark:text-blue-400 px-4 py-3 rounded mb-6">
            <p className="text-sm font-medium">
              Note: Exception system is not yet implemented. This page will display exceptions when the system is available.
            </p>
          </div>

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Period / Date Range
                </label>
                <input
                  type="date"
                  value={filterPeriod}
                  onChange={(e) => setFilterPeriod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Severity
                </label>
                <select
                  value={filterSeverity}
                  onChange={(e) => setFilterSeverity(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="">All</option>
                  <option value="error">Error</option>
                  <option value="warning">Warning</option>
                  <option value="info">Info</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Rule Code
                </label>
                <input
                  type="text"
                  value={filterRuleCode}
                  onChange={(e) => setFilterRuleCode(e.target.value)}
                  placeholder="Filter by rule code..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Status
                </label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  <option value="">All</option>
                  <option value="open">Open</option>
                  <option value="acknowledged">Acknowledged</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
            </div>
          </div>

          {/* Exceptions List */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Exceptions ({exceptions.length})
              </h2>
              
              {exceptions.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400">No exceptions found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {exceptions.map((exception) => (
                    <div
                      key={exception.id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                      onClick={() => setSelectedException(exception)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                exception.severity === "error"
                                  ? "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-400"
                                  : exception.severity === "warning"
                                  ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400"
                                  : "bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400"
                              }`}
                            >
                              {exception.severity.toUpperCase()}
                            </span>
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {exception.rule_code}
                            </span>
                            <span
                              className={`px-2 py-1 rounded text-xs ${
                                exception.status === "open"
                                  ? "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                                  : exception.status === "acknowledged"
                                  ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400"
                                  : "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400"
                              }`}
                            >
                              {exception.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {exception.rule_description}
                          </p>
                          {exception.period_start && (
                            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                              Period: {exception.period_start}
                            </p>
                          )}
                        </div>
                        {exception.status === "open" && (
                          <div className="flex gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleAcknowledge(exception.id)
                              }}
                              className="px-3 py-1 text-sm bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400 rounded hover:bg-yellow-200 dark:hover:bg-yellow-900/30"
                            >
                              Acknowledge
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedException(exception)
                              }}
                              className="px-3 py-1 text-sm bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/30"
                            >
                              Resolve
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Exception Detail Drawer */}
      {selectedException && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Exception Details
                </h2>
                <button
                  onClick={() => setSelectedException(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Rule Code
                  </label>
                  <p className="text-gray-900 dark:text-white">{selectedException.rule_code}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Rule Description
                  </label>
                  <p className="text-gray-900 dark:text-white">{selectedException.rule_description}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Severity
                  </label>
                  <span
                    className={`inline-block px-2 py-1 rounded text-sm ${
                      selectedException.severity === "error"
                        ? "bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-400"
                        : selectedException.severity === "warning"
                        ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400"
                        : "bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-400"
                    }`}
                  >
                    {selectedException.severity.toUpperCase()}
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <span
                    className={`inline-block px-2 py-1 rounded text-sm ${
                      selectedException.status === "open"
                        ? "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300"
                        : selectedException.status === "acknowledged"
                        ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400"
                        : "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400"
                    }`}
                  >
                    {selectedException.status}
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Metadata
                  </label>
                  <pre className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto">
                    {JSON.stringify(selectedException.metadata, null, 2)}
                  </pre>
                </div>

                {selectedException.status === "open" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Resolution Notes (Required)
                    </label>
                    <textarea
                      id="resolve-notes"
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      placeholder="Enter resolution notes..."
                    />
                  </div>
                )}

                {selectedException.status === "resolved" && selectedException.resolved_notes && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Resolution Notes
                    </label>
                    <p className="text-gray-900 dark:text-white">{selectedException.resolved_notes}</p>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setSelectedException(null)}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Close
                  </button>
                  {selectedException.status === "open" && (
                    <button
                      onClick={async () => {
                        const notesElement = document.getElementById("resolve-notes") as HTMLTextAreaElement
                        const notes = notesElement?.value || ""
                        if (!notes.trim()) {
                          toast.showToast("Resolution notes are required", "warning")
                          return
                        }
                        await handleResolve(selectedException.id, notes)
                      }}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </ProtectedLayout>
  )
}
