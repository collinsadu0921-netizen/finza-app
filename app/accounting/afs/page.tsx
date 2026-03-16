"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type AFSRun = {
  id: string
  business_id: string
  status: "draft" | "finalized"
  input_hash: string
  period_start: string | null
  period_end: string | null
  finalized_at: string | null
  finalized_by: string | null
  metadata: any
  created_at: string
  created_by: string | null
}

type AFSDocument = {
  id: string
  afs_run_id: string
  document_type: string
  document_data: any
  created_at: string
}

export default function AFSReviewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { openConfirm } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [afsRuns, setAfsRuns] = useState<AFSRun[]>([])
  const [selectedRun, setSelectedRun] = useState<AFSRun | null>(null)
  const [runDocuments, setRunDocuments] = useState<AFSDocument[]>([])
  const [error, setError] = useState("")
  const [filterStatus, setFilterStatus] = useState<string>("")
  const [finalizing, setFinalizing] = useState(false)

  useEffect(() => {
    loadContext()
  }, [])

  useEffect(() => {
    if (businessId) {
      loadAFSRuns()
    }
  }, [businessId, filterStatus])

  useEffect(() => {
    if (selectedRun && businessId) {
      loadRunDocuments(selectedRun.id)
    }
  }, [selectedRun, businessId])

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
      setError(err.message || "Failed to load business")
      setLoading(false)
    }
  }

  const loadAFSRuns = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      const params = new URLSearchParams({ business_id: businessId })
      if (filterStatus) {
        params.append("status", filterStatus)
      }

      const response = await fetch(`/api/accounting/afs/runs?${params}`)
      if (!response.ok) {
        throw new Error("Failed to load AFS runs")
      }

      const data = await response.json()
      setAfsRuns(data.runs || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load AFS runs")
      setLoading(false)
    }
  }

  const loadRunDocuments = async (runId: string) => {
    if (!businessId) return
    try {
      const response = await fetch(`/api/accounting/afs/documents/${runId}?business_id=${businessId}`)
      if (!response.ok) {
        throw new Error("Failed to load AFS documents")
      }

      const data = await response.json()
      setRunDocuments(data.documents || [])
    } catch (err: any) {
      console.error("Error loading documents:", err)
      setRunDocuments([])
    }
  }

  const handleFinalize = async (runId: string) => {
    if (!businessId) return
    openConfirm({
      title: "Finalize AFS run",
      description: "Are you sure you want to finalize this AFS run? This action cannot be undone.",
      onConfirm: () => runFinalize(runId),
    })
  }

  const runFinalize = async (runId: string) => {
    if (!businessId) return
    try {
      setFinalizing(true)
      const response = await fetch(`/api/accounting/afs/${runId}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to finalize AFS run")
      }

      await loadAFSRuns()
      if (selectedRun?.id === runId) {
        const updatedRun = afsRuns.find((r) => r.id === runId)
        if (updatedRun) setSelectedRun({ ...updatedRun, status: "finalized" })
      }
      setFinalizing(false)
    } catch (err: any) {
      setError(err.message || "Failed to finalize AFS run")
      setFinalizing(false)
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-6 text-amber-800 dark:text-amber-200">
              <p className="font-medium">Select a client or ensure you have an active business.</p>
              <p className="text-sm mt-1">No business context is available.</p>
            </div>
          </div>
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
                AFS Review & Finalization
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Review and finalize Accounting Financial Statements
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <option value="draft">Draft</option>
                  <option value="finalized">Finalized</option>
                </select>
              </div>
            </div>
          </div>

          {/* AFS Runs List */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                AFS Runs ({afsRuns.length})
              </h2>
              
              {afsRuns.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400">No AFS runs found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {afsRuns.map((run) => (
                    <div
                      key={run.id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                      onClick={() => setSelectedRun(run)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                run.status === "draft"
                                  ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400"
                                  : "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400"
                              }`}
                            >
                              {run.status.toUpperCase()}
                            </span>
                            {run.period_start && run.period_end && (
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                {new Date(run.period_start).toLocaleDateString()} - {new Date(run.period_end).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            Input Hash: {run.input_hash.substring(0, 16)}...
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            Created: {new Date(run.created_at).toLocaleString()}
                          </div>
                          {run.status === "finalized" && run.finalized_at && (
                            <div className="text-xs text-gray-500 dark:text-gray-500">
                              Finalized: {new Date(run.finalized_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                        {run.status === "draft" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleFinalize(run.id)
                            }}
                            disabled={finalizing}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Finalize
                          </button>
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

      {/* AFS Run Detail Modal */}
      {selectedRun && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  AFS Run Details
                </h2>
                <button
                  onClick={() => setSelectedRun(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <span
                    className={`inline-block px-2 py-1 rounded text-sm ${
                      selectedRun.status === "draft"
                        ? "bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-400"
                        : "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400"
                    }`}
                  >
                    {selectedRun.status.toUpperCase()}
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Period
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {selectedRun.period_start && selectedRun.period_end
                      ? `${new Date(selectedRun.period_start).toLocaleDateString()} - ${new Date(selectedRun.period_end).toLocaleDateString()}`
                      : "N/A"}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Input Hash
                  </label>
                  <p className="text-gray-900 dark:text-white font-mono text-xs break-all">
                    {selectedRun.input_hash}
                  </p>
                </div>

                {selectedRun.metadata && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Metadata
                    </label>
                    <pre className="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedRun.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Documents ({runDocuments.length})
                  </label>
                  {runDocuments.length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400 text-sm">No documents available</p>
                  ) : (
                    <div className="space-y-2">
                      {runDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          className="border border-gray-200 dark:border-gray-700 rounded p-3"
                        >
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-gray-900 dark:text-white capitalize">
                              {doc.document_type.replace("_", " ")}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              {new Date(doc.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedRun.status === "draft" && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
                    <p className="text-sm font-medium mb-1">Warning</p>
                    <p className="text-sm">
                      Before finalizing, ensure there are no new exceptions or ledger entries since this run was created.
                    </p>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setSelectedRun(null)}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Close
                  </button>
                  {selectedRun.status === "draft" && (
                    <button
                      onClick={() => handleFinalize(selectedRun.id)}
                      disabled={finalizing}
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {finalizing ? "Finalizing..." : "Finalize"}
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
