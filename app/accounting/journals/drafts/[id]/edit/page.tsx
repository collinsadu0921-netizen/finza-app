"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { useToast } from "@/components/ui/ToastProvider"
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

type DraftLine = {
  account_id: string
  debit: number
  credit: number
  memo?: string
  account?: {
    id: string
    code: string
    name: string
    type: string
  } | null
}

type ManualJournalDraft = {
  id: string
  period_id: string
  entry_date: string
  description: string
  status: "draft" | "submitted" | "approved" | "rejected"
  lines: DraftLine[]
  created_by: string
}

export default function EditDraftPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const router = useRouter()
  const toast = useToast()
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()
  const [draftId, setDraftId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<ManualJournalDraft | null>(null)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("")
  const [entryDate, setEntryDate] = useState<string>("")
  const [description, setDescription] = useState("")
  const [lines, setLines] = useState<JournalLine[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [blockedReason, setBlockedReason] = useState("")

  useEffect(() => {
    const loadParams = async () => {
      const resolvedParams = await params
      setDraftId(resolvedParams.id)
    }
    loadParams()
  }, [params])

  useEffect(() => {
    if (draftId && clientBusinessId) {
      initializePage()
    } else if (draftId && !contextLoading && !clientBusinessId) {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, clientBusinessId])

  useEffect(() => {
    if (selectedPeriodId && periods.length > 0) {
      const period = periods.find((p) => p.id === selectedPeriodId)
      if (period && entryDate) {
        // Validate entry_date is within period
        if (entryDate < period.period_start || entryDate > period.period_end) {
          // Auto-adjust if out of range
          if (entryDate < period.period_start) {
            setEntryDate(period.period_start)
          } else if (entryDate > period.period_end) {
            setEntryDate(period.period_end)
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId, periods])

  const initializePage = async () => {
    if (!draftId || !clientBusinessId) return

    try {
      setLoading(true)
      setError("")
      setBlocked(false)
      setBlockedReason("")

      // Load draft
      const draftUrl =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}`
      const draftResponse = await fetch(draftUrl)
      if (!draftResponse.ok) {
        const errorData = await draftResponse.json()
        throw new Error(errorData.message || "Failed to load draft")
      }

      const draftData = await draftResponse.json()
      const loadedDraft = draftData.draft

      // Check if draft can be edited
      if (loadedDraft.status !== "draft") {
        setBlocked(true)
        setBlockedReason(`This draft cannot be edited. Current status: ${loadedDraft.status}`)
        setLoading(false)
        return
      }

      // Check if user is the creator
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not authenticated")
        setLoading(false)
        return
      }

      if (loadedDraft.created_by !== user.id) {
        setBlocked(true)
        setBlockedReason("Only the draft creator can edit this draft.")
        setLoading(false)
        return
      }

      setDraft(loadedDraft)
      setSelectedPeriodId(loadedDraft.period_id)
      setEntryDate(loadedDraft.entry_date)
      setDescription(loadedDraft.description)

      // Convert draft lines to editor format
      const editorLines: JournalLine[] = loadedDraft.lines.map((line: DraftLine, index: number) => ({
        id: `line-${index}`,
        account_id: line.account_id,
        debit: line.debit || 0,
        credit: line.credit || 0,
        memo: line.memo || undefined,
      }))
      setLines(editorLines)

      await Promise.all([
        loadPeriods(clientBusinessId),
        loadAccounts(clientBusinessId),
      ])

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to initialize page")
      setLoading(false)
    }
  }

  const loadPeriods = async (businessId: string) => {
    try {
      const response = await fetch(`/api/accounting/periods?business_id=${businessId}`)
      if (!response.ok) {
        throw new Error("Failed to load periods")
      }

      const data = await response.json()
      // Filter to only open periods for editing drafts
      const openPeriods = (data.periods || []).filter(
        (p: AccountingPeriod) => p.status === "open" || p.status === "soft_closed"
      )
      setPeriods(openPeriods)
    } catch (err: any) {
      console.error("Error loading periods:", err)
    }
  }

  const loadAccounts = async (businessId: string) => {
    try {
      const response = await fetch(`/api/accounting/coa?business_id=${businessId}`)
      if (!response.ok) {
        throw new Error("Failed to load accounts")
      }

      const data = await response.json()
      setAccounts(data.accounts || [])
    } catch (err: any) {
      console.error("Error loading accounts:", err)
    }
  }

  const formatPeriod = (period: AccountingPeriod): string => {
    const start = new Date(period.period_start)
    return `${start.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
  }

  const addLine = () => {
    setLines([...lines, { id: Date.now().toString(), account_id: null, debit: 0, credit: 0 }])
  }

  const removeLine = (id: string) => {
    if (lines.length <= 2) {
      setError("Journal entry must have at least 2 lines")
      return
    }
    setLines(lines.filter((line) => id !== line.id))
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
    if (!isBalanced()) return false

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

  const handleSave = async () => {
    if (!canSave()) {
      setError("Please complete all required fields and ensure entry is balanced")
      return
    }

    if (!draftId) {
      setError("Draft ID missing")
      return
    }

    setSaving(true)
    setError("")

    try {
      // Build update body - only include period_id if it changed
      const updateBody: any = {
        entry_date: entryDate,
        description: description.trim(),
        lines: lines.map((line) => ({
          account_id: line.account_id,
          debit: line.debit || 0,
          credit: line.credit || 0,
          memo: line.memo || null,
        })),
      }

      // Only include period_id if it changed
      if (draft && selectedPeriodId !== draft.period_id) {
        updateBody.period_id = selectedPeriodId
      }

      const patchUrl =
        clientBusinessId
          ? `/api/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}`
          : `/api/accounting/journals/drafts/${draftId}`
      const response = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateBody),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || "Failed to update draft")
      }

      toast.showToast("Draft updated successfully", "success")
      router.push(clientBusinessId ? `/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}` : `/accounting/journals/drafts/${draftId}`)
    } catch (err: any) {
      setError(err.message || "Failed to update draft")
      toast.showToast(err.message || "Failed to update draft", "error")
      setSaving(false)
    }
  }

  if (contextLoading || loading) {
    return (
      <ProtectedLayout>
        <LoadingScreen />
      </ProtectedLayout>
    )
  }

  if (contextError) {
    return (
      <ProtectedLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader title="Edit Manual Journal Draft" />
          <EmptyState title="Client not selected" description={CLIENT_NOT_SELECTED_DESCRIPTION} />
        </div>
      </ProtectedLayout>
    )
  }

  if (blocked || !draft) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <PageHeader title="Edit Manual Journal Draft" />
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
              {blockedReason || "Draft not found"}
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId)
  const totalDebit = getTotalDebit()
  const totalCredit = getTotalCredit()
  const imbalance = Math.abs(totalDebit - totalCredit)

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Edit Manual Journal Draft"
            subtitle={
              clientBusinessId ? (
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Client: {clientBusinessId.slice(0, 8)}…
                </span>
              ) : undefined
            }
            actions={
              <Button
                variant="outline"
                onClick={() => router.push(clientBusinessId ? `/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}` : `/accounting/journals/drafts/${draftId}`)}
              >
                Cancel
              </Button>
            }
          />

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Info Banner */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 text-blue-700 dark:text-blue-400 px-4 py-3 rounded mb-6">
            <p className="text-sm font-medium">
              <strong>Note:</strong> Only drafts in "draft" status can be edited. This draft will not affect the ledger until explicitly posted by a Partner.
            </p>
          </div>

          {/* Period and Entry Date */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Accounting Period <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedPeriodId}
                  onChange={(e) => {
                    setSelectedPeriodId(e.target.value)
                    setError("")
                  }}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                >
                  <option value="">-- Select Period --</option>
                  {periods.map((period) => (
                    <option key={period.id} value={period.id}>
                      {formatPeriod(period)} ({period.status})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Only open or soft-closed periods are available
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Entry Date <span className="text-red-500">*</span>
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
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  required
                />
                {selectedPeriod && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Must be between {new Date(selectedPeriod.period_start).toLocaleDateString()} and{" "}
                    {new Date(selectedPeriod.period_end).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setError("")
                }}
                placeholder="Enter journal entry description..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                required
              />
            </div>
          </div>

          {/* Journal Lines */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Journal Lines
              </h3>
              <Button variant="outline" size="sm" onClick={addLine}>
                + Add Line
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Account
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Debit
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Credit
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Memo
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {lines.map((line) => (
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
                              {account.code} - {account.name} ({account.type})
                              {account.is_system ? " [System]" : ""}
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
                          onChange={(e) => updateLine(line.id, "memo", e.target.value || undefined)}
                          placeholder="Optional memo..."
                          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {lines.length > 2 && (
                          <button
                            onClick={() => removeLine(line.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 dark:bg-gray-900 font-semibold">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">Total</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                      ₵{totalDebit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                      ₵{totalCredit.toFixed(2)}
                    </td>
                    <td className="px-4 py-3"></td>
                    <td className="px-4 py-3"></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Balance Indicator */}
            <div className={`mt-4 p-4 rounded-lg ${
              isBalanced()
                ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700"
                : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700"
            }`}>
              <div className="flex items-center justify-between">
                <span className={`font-semibold ${
                  isBalanced()
                    ? "text-green-900 dark:text-green-300"
                    : "text-red-900 dark:text-red-300"
                }`}>
                  {isBalanced() ? "✓ Entry is Balanced" : `⚠ Entry is Not Balanced (Difference: ₵${imbalance.toFixed(2)})`}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => router.push(clientBusinessId ? `/accounting/journals/drafts/${draftId}?business_id=${clientBusinessId}` : `/accounting/journals/drafts/${draftId}`)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!canSave() || saving}
              isLoading={saving}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
