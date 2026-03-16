"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import {
  useAccountingBusiness,
  CLIENT_NOT_SELECTED_DESCRIPTION,
} from "@/lib/accounting/useAccountingBusiness"

type AccountingPeriod = {
  id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type Account = {
  id: string
  code: string
  name: string
  type: string
  is_system: boolean
}

type JournalLine = {
  id: string
  account_id: string | null
  debit: number
  credit: number
  memo?: string
}

export default function NewDraftPage() {
  const router = useRouter()
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("")
  const [entryDate, setEntryDate] = useState<string>("")
  const [description, setDescription] = useState("")
  const [lines, setLines] = useState<JournalLine[]>([
    { id: "1", account_id: null, debit: 0, credit: 0 },
    { id: "2", account_id: null, debit: 0, credit: 0 },
  ])
  const [error, setError] = useState("")

  useEffect(() => {
    if (!clientBusinessId) return
    setLoading(true)
    Promise.all([loadPeriods(), loadAccounts()]).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientBusinessId])

  useEffect(() => {
    if (selectedPeriodId && periods.length > 0) {
      const period = periods.find((p) => p.id === selectedPeriodId)
      if (period) {
        if (!entryDate || entryDate < period.period_start || entryDate > period.period_end) {
          setEntryDate(period.period_start)
        }
      }
    }
  }, [selectedPeriodId, periods])

  const loadPeriods = async () => {
    if (!clientBusinessId) return
    try {
      const response = await fetch(`/api/accounting/periods?business_id=${clientBusinessId}`)
      if (response.ok) {
        const data = await response.json()
        // Filter to only open periods
        const openPeriods = (data.periods || []).filter(
          (p: AccountingPeriod) => p.status === "open"
        )
        setPeriods(openPeriods)
      }
    } catch (err) {
      console.error("Error loading periods:", err)
    }
  }

  const loadAccounts = async () => {
    if (!clientBusinessId) return
    try {
      const response = await fetch(`/api/accounting/coa?business_id=${clientBusinessId}`)
      if (response.ok) {
        const data = await response.json()
        setAccounts(data.accounts || [])
      }
    } catch (err) {
      console.error("Error loading accounts:", err)
    }
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const getAccountLabel = (accountId: string | null): string => {
    if (!accountId) return "Select account..."
    const account = accounts.find((a) => a.id === accountId)
    if (!account) return "Account not found"
    return `${account.code} - ${account.name}${account.is_system ? " (System)" : ""}`
  }

  const addLine = () => {
    setLines([...lines, { id: Date.now().toString(), account_id: null, debit: 0, credit: 0 }])
  }

  const removeLine = (id: string) => {
    if (lines.length <= 2) {
      setError("Journal entry must have at least 2 lines")
      return
    }
    setLines(lines.filter((line) => line.id !== id))
    setError("")
  }

  const updateLine = (id: string, field: keyof JournalLine, value: any) => {
    setLines(
      lines.map((line) => {
        if (line.id === id) {
          const updated = { ...line, [field]: value }
          // Ensure exactly one of debit/credit per line
          if (field === "debit" && value > 0) {
            updated.credit = 0
          } else if (field === "credit" && value > 0) {
            updated.debit = 0
          }
          return updated
        }
        return line
      })
    )
    setError("")
  }

  const getTotalDebit = (): number => {
    return lines.reduce((sum, line) => sum + (line.debit || 0), 0)
  }

  const getTotalCredit = (): number => {
    return lines.reduce((sum, line) => sum + (line.credit || 0), 0)
  }

  const isBalanced = (): boolean => {
    const debit = getTotalDebit()
    const credit = getTotalCredit()
    return Math.abs(debit - credit) < 0.01
  }

  const canSave = (): boolean => {
    if (!selectedPeriodId || !entryDate || !description.trim()) return false
    if (lines.length < 2) return false
    
    // Validate all lines have account_id and at least one amount > 0
    for (const line of lines) {
      if (!line.account_id) return false
      if (line.debit <= 0 && line.credit <= 0) return false
    }

    // Validate entry_date is within period
    const period = periods.find((p) => p.id === selectedPeriodId)
    if (!period) return false
    if (entryDate < period.period_start || entryDate > period.period_end) return false

    return true
  }

  const canSubmit = (): boolean => {
    return canSave() && isBalanced()
  }

  const handleSave = async () => {
    if (!canSave()) {
      setError("Please complete all required fields")
      return
    }

    setSaving(true)
    setError("")

    try {
      const response = await fetch("/api/accounting/journals/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_business_id: clientBusinessId,
          period_id: selectedPeriodId,
          entry_date: entryDate,
          description: description.trim(),
          lines: lines.map((line) => ({
            account_id: line.account_id,
            debit: line.debit || 0,
            credit: line.credit || 0,
            memo: line.memo || null,
          })),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to save draft")
      }

      const data = await response.json()
      router.push(clientBusinessId ? `/accounting/journals/drafts/${data.draft.id}?business_id=${clientBusinessId}` : `/accounting/journals/drafts/${data.draft.id}`)
    } catch (err: any) {
      setError(err.message || "Failed to save draft")
      setSaving(false)
    }
  }

  const handleSubmit = async () => {
    if (!canSubmit()) {
      setError("Please complete all required fields and ensure entry is balanced")
      return
    }

    setSubmitting(true)
    setError("")

    try {
      // First save the draft
      const saveResponse = await fetch("/api/accounting/journals/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_business_id: clientBusinessId,
          period_id: selectedPeriodId,
          entry_date: entryDate,
          description: description.trim(),
          lines: lines.map((line) => ({
            account_id: line.account_id,
            debit: line.debit || 0,
            credit: line.credit || 0,
            memo: line.memo || null,
          })),
        }),
      })

      if (!saveResponse.ok) {
        const errorData = await saveResponse.json()
        throw new Error(errorData.message || "Failed to save draft")
      }

      const saveData = await saveResponse.json()
      const draftId = saveData.draft.id

      // Then submit it
      const submitUrl =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}/submit?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}/submit`
      const submitResponse = await fetch(submitUrl, {
        method: "POST",
      })

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json()
        throw new Error(errorData.message || "Failed to submit draft")
      }

      router.push(clientBusinessId ? `/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}` : `/accounting/journals/drafts/${draftId}`)
    } catch (err: any) {
      setError(err.message || "Failed to submit draft")
      setSubmitting(false)
    }
  }

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId)
  const totalDebit = getTotalDebit()
  const totalCredit = getTotalCredit()
  const imbalance = Math.abs(totalDebit - totalCredit)

  if (contextLoading || loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (contextError) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <EmptyState title="Client not selected" description={CLIENT_NOT_SELECTED_DESCRIPTION} />
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
                onClick={() => router.push(clientBusinessId ? `/accounting/journals?business_id=${clientBusinessId}` : "/accounting/journals")}
                className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
              >
                ← Back to Journals
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                New Manual Journal Draft
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Create a new manual journal entry draft
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Header Info */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex items-center gap-4 mb-4">
              <span className="px-3 py-1 bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 rounded-full text-sm font-medium">
                Draft
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Period (Open Only) *
                </label>
                <select
                  value={selectedPeriodId}
                  onChange={(e) => {
                    setSelectedPeriodId(e.target.value)
                    setError("")
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">-- Select Period --</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {formatPeriod(period.period_start)} ({period.status})
                    </option>
                  ))}
                </select>
                {periods.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    No open periods available. Create an open period first.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Entry Date *
                </label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => {
                    setEntryDate(e.target.value)
                    setError("")
                  }}
                  min={selectedPeriod?.period_start}
                  max={selectedPeriod?.period_end}
                  disabled={!selectedPeriodId}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Must fall within selected period: {selectedPeriod ? `${selectedPeriod.period_start} to ${selectedPeriod.period_end}` : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Description *
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setError("")
              }}
              placeholder="Enter journal entry description"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          {/* Journal Lines Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Journal Lines *</h2>
              <button
                onClick={addLine}
                className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                + Add Line
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Account</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Debit</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Credit</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Memo</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {lines.map((line, index) => (
                    <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3">
                        <select
                          value={line.account_id || ""}
                          onChange={(e) => updateLine(line.id, "account_id", e.target.value || null)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="">Select account...</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} - {account.name} ({account.type}){account.is_system ? " [System]" : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.debit || ""}
                          onChange={(e) => updateLine(line.id, "debit", parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.credit || ""}
                          onChange={(e) => updateLine(line.id, "credit", parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                          className="w-full px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={line.memo || ""}
                          onChange={(e) => updateLine(line.id, "memo", e.target.value)}
                          placeholder="Optional line memo"
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {lines.length > 2 && (
                          <button
                            onClick={() => removeLine(line.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 dark:bg-gray-700 font-semibold">
                  <tr>
                    <td className="px-4 py-3 text-right" colSpan={1}>Totals:</td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                      {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                      {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3" colSpan={2}>
                      {isBalanced() ? (
                        <span className="text-green-600 dark:text-green-400">✓ Balanced</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400">
                          Imbalance: {imbalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-4 mb-6">
            <button
              onClick={() => router.push(clientBusinessId ? `/accounting/journals?business_id=${clientBusinessId}` : "/accounting/journals")}
              disabled={saving || submitting}
              className="px-6 py-3 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave() || saving || submitting}
              className="px-6 py-3 bg-gray-600 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Draft"}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit() || saving || submitting}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting..." : "Submit for Review"}
            </button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
