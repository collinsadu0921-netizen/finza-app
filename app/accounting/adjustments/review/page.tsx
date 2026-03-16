"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

type AdjustmentLine = {
  id: string
  account_id: string
  account_code: string
  account_name: string
  account_type: string
  debit: number
  credit: number
  description?: string
}

type Adjustment = {
  journal_entry_id: string
  entry_date: string
  description: string
  created_by: string | null
  created_at: string
  total_debit: number
  total_credit: number
  lines: AdjustmentLine[]
}

export default function AdjustmentsReviewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [selectedAdjustment, setSelectedAdjustment] = useState<Adjustment | null>(null)
  const [error, setError] = useState("")
  const [filterPeriod, setFilterPeriod] = useState<string>("")

  useEffect(() => {
    loadContext()
  }, [])

  useEffect(() => {
    if (businessId) {
      loadAdjustments()
    }
  }, [businessId, filterPeriod])

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

  const loadAdjustments = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      const params = new URLSearchParams({ business_id: businessId })
      if (filterPeriod) {
        params.append("period_start", filterPeriod)
      }

      const response = await fetch(`/api/accounting/adjustments?${params}`)
      if (!response.ok) {
        throw new Error("Failed to load adjustments")
      }

      const data = await response.json()
      setAdjustments(data.adjustments || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load adjustments")
      setLoading(false)
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
                Adjusting Journal Review
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Review and validate adjusting journal entries
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
              Note: Current system applies adjustments immediately. A pending_review workflow would require additional implementation.
              All adjustments shown here are already posted.
            </p>
          </div>

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Period
                </label>
                <input
                  type="date"
                  value={filterPeriod}
                  onChange={(e) => setFilterPeriod(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          </div>

          {/* Adjustments List */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                Adjustments ({adjustments.length})
              </h2>
              
              {adjustments.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400">No adjustments found</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {adjustments.map((adjustment) => (
                    <div
                      key={adjustment.journal_entry_id}
                      className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                      onClick={() => setSelectedAdjustment(adjustment)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-white">
                              {adjustment.description}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-500">
                              {new Date(adjustment.entry_date).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                            <span>Debit: {adjustment.total_debit.toFixed(2)}</span>
                            <span>Credit: {adjustment.total_credit.toFixed(2)}</span>
                            <span>Lines: {adjustment.lines.length}</span>
                          </div>
                        </div>
                        <span className="px-2 py-1 text-xs bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400 rounded">
                          Posted
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Adjustment Detail Modal */}
      {selectedAdjustment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Adjustment Details
                </h2>
                <button
                  onClick={() => setSelectedAdjustment(null)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Description
                  </label>
                  <p className="text-gray-900 dark:text-white">{selectedAdjustment.description}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Entry Date
                  </label>
                  <p className="text-gray-900 dark:text-white">
                    {new Date(selectedAdjustment.entry_date).toLocaleDateString()}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Status
                  </label>
                  <span className="inline-block px-2 py-1 rounded text-sm bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-400">
                    Posted
                  </span>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Journal Entry Lines
                  </label>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Account
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Description
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Debit
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            Credit
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {selectedAdjustment.lines.map((line) => (
                          <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="px-4 py-2">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">
                                {line.account_code}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {line.account_name}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">
                              {line.description || "-"}
                            </td>
                            <td className="px-4 py-2 text-right text-sm text-gray-900 dark:text-white">
                              {line.debit > 0 ? line.debit.toFixed(2) : "-"}
                            </td>
                            <td className="px-4 py-2 text-right text-sm text-gray-900 dark:text-white">
                              {line.credit > 0 ? line.credit.toFixed(2) : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <td colSpan={2} className="px-4 py-2 text-sm font-medium text-gray-900 dark:text-white">
                            Total
                          </td>
                          <td className="px-4 py-2 text-right text-sm font-medium text-gray-900 dark:text-white">
                            {selectedAdjustment.total_debit.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-right text-sm font-medium text-gray-900 dark:text-white">
                            {selectedAdjustment.total_credit.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setSelectedAdjustment(null)}
                    className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </ProtectedLayout>
  )
}
