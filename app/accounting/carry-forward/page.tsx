"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getUserRole } from "@/lib/userRoles"
import { isUserAccountantReadonly } from "@/lib/userRoles"
import { buildAccountingRoute } from "@/lib/accounting/routes"

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type CarryForwardBalance = {
  account_id: string
  account_code: string
  account_name: string
  account_type: string
  ending_balance: number
}

type CarryForwardBatch = {
  id: string
  business_id: string
  from_period_start: string
  to_period_start: string
  journal_entry_id: string
  created_by: string
  created_at: string
  note: string | null
}

type CarryForwardLineWithAccount = {
  id: string
  account_id: string
  amount: number
  account: {
    id: string
    code: string
    name: string
    type: string
  }
}


export default function CarryForwardPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [isReadonlyAccountant, setIsReadonlyAccountant] = useState(false)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [fromPeriodStart, setFromPeriodStart] = useState<string | null>(null)
  const [toPeriodStart, setToPeriodStart] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [applying, setApplying] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [existingBatch, setExistingBatch] = useState<CarryForwardBatch | null>(null)
  const [existingLines, setExistingLines] = useState<CarryForwardLineWithAccount[]>([])
  const [previewBalances, setPreviewBalances] = useState<CarryForwardBalance[]>([])
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    loadContext()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (businessId) {
      loadPeriods()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId])

  useEffect(() => {
    if (businessId && fromPeriodStart && toPeriodStart) {
      loadExistingBatch()
      loadPreview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, fromPeriodStart, toPeriodStart])

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
      const role = await getUserRole(supabase, user.id, ctx.businessId)
      setUserRole(role)
      const readonly = await isUserAccountantReadonly(supabase, user.id, ctx.businessId)
      setIsReadonlyAccountant(readonly)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load business")
      setLoading(false)
    }
  }

  const loadPeriods = async () => {
    if (!businessId) return
    try {
      setLoading(true)
      const response = await fetch(`/api/accounting/periods?business_id=${businessId}`)

      if (!response.ok) {
        throw new Error("Failed to load accounting periods")
      }

      const data = await response.json()
      setPeriods(data.periods || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load accounting periods")
      setLoading(false)
    }
  }

  const loadExistingBatch = async () => {
    if (!businessId || !fromPeriodStart || !toPeriodStart) return
    try {
      const response = await fetch(
        `/api/accounting/carry-forward?business_id=${businessId}&from_period_start=${fromPeriodStart}&to_period_start=${toPeriodStart}`
      )

      if (!response.ok) {
        throw new Error("Failed to load existing batch")
      }

      const data = await response.json()
      if (data.batch) {
        setExistingBatch(data.batch)
        setExistingLines(data.lines || [])
        setJournalEntryId(data.journal_entry?.id || data.batch.journal_entry_id || null)
      } else {
        setExistingBatch(null)
        setExistingLines([])
        setJournalEntryId(null)
        if (data.preview) {
          setPreviewBalances(data.preview.balances || [])
        }
      }
    } catch (err: any) {
      console.error("Error loading existing batch:", err)
      setExistingBatch(null)
      setExistingLines([])
      setJournalEntryId(null)
    }
  }

  const loadPreview = async () => {
    if (!businessId || !fromPeriodStart || !toPeriodStart || existingBatch) return
    try {
      setLoadingPreview(true)
      const response = await fetch(
        `/api/accounting/carry-forward?business_id=${businessId}&from_period_start=${fromPeriodStart}&to_period_start=${toPeriodStart}`
      )

      if (!response.ok) {
        throw new Error("Failed to load preview")
      }

      const data = await response.json()
      if (data.preview) {
        setPreviewBalances(data.preview.balances || [])
      }
    } catch (err: any) {
      console.error("Error loading preview:", err)
    } finally {
      setLoadingPreview(false)
    }
  }

  const formatPeriod = (periodStart: string): string => {
    const date = new Date(periodStart)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    return `${year}-${month}`
  }

  const getAccountTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      asset: "Asset",
      liability: "Liability",
      equity: "Equity",
    }
    return labels[type] || type
  }

  const deriveDebitCredit = (accountType: string, amount: number): { debit: number; credit: number } => {
    if (accountType === "asset") {
      return amount >= 0 ? { debit: amount, credit: 0 } : { debit: 0, credit: Math.abs(amount) }
    } else {
      return amount >= 0 ? { debit: 0, credit: amount } : { debit: Math.abs(amount), credit: 0 }
    }
  }

  const handleApply = async () => {
    if (!businessId || !fromPeriodStart || !toPeriodStart) {
      setError("Please select source period and target period")
      return
    }

    if (previewBalances.length === 0) {
      setError("No balances to carry forward. Source period has no eligible accounts with non-zero balances.")
      return
    }

    setApplying(true)
    setError("")

    try {
      const response = await fetch("/api/accounting/carry-forward/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          from_period_start: fromPeriodStart,
          to_period_start: toPeriodStart,
          note: note.trim() || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to apply carry-forward")
      }

      await loadExistingBatch()
      setShowConfirmModal(false)
      setConfirmChecked(false)
      setNote("")
    } catch (err: any) {
      setError(err.message || "Failed to apply carry-forward")
    } finally {
      setApplying(false)
    }
  }

  const getSourcePeriods = () => {
    return periods.filter((p) => p.status === "soft_closed" || p.status === "locked")
  }

  const getTargetPeriods = () => {
    return periods.filter((p) => p.status === "open")
  }

  const canApply = 
    !isReadonlyAccountant &&
    (userRole === "admin" || userRole === "owner" || userRole === "accountant") &&
    existingBatch === null &&
    fromPeriodStart &&
    toPeriodStart &&
    previewBalances.length > 0

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

  const hasWriteAccess = 
    (userRole === "admin" || userRole === "owner") ||
    (userRole === "accountant" && !isReadonlyAccountant)

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
                ← Back to Accounting
              </button>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Carry-Forward Balances
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Generate next-period opening balances from prior period ending balances. Carry-forward creates a balanced opening entry using all balance-sheet accounts.
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Period Selectors */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Source Period (From) *
                </label>
                <select
                  value={fromPeriodStart || ""}
                  onChange={(e) => {
                    setFromPeriodStart(e.target.value || null)
                    setNote("")
                    setError("")
                  }}
                  disabled={!!existingBatch}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">-- Select Source Period --</option>
                  {getSourcePeriods().map((period) => (
                    <option key={period.id} value={period.period_start}>
                      {formatPeriod(period.period_start)} ({period.status})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Select a period that is soft_closed or locked (recommended: soft_closed or locked)
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Target Period (To) *
                </label>
                <select
                  value={toPeriodStart || ""}
                  onChange={(e) => {
                    setToPeriodStart(e.target.value || null)
                    setNote("")
                    setError("")
                  }}
                  disabled={!!existingBatch}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                >
                  <option value="">-- Select Target Period --</option>
                  {getTargetPeriods().map((period) => (
                    <option key={period.id} value={period.period_start}>
                      {formatPeriod(period.period_start)} ({period.status})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Select an open period (must be empty of non-carry-forward entries)
                </p>
              </div>
            </div>
          </div>

          {existingBatch ? (
            /* Read-Only View - Carry-Forward Already Applied */
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 text-green-700 dark:text-green-400 px-4 py-3 rounded mb-6">
                <p className="font-medium">Carry-forward already applied for these periods</p>
                <p className="text-sm mt-1">
                  Applied at: {new Date(existingBatch.created_at).toLocaleString()}
                  {journalEntryId && (
                    <> • Journal Entry ID: <span className="font-mono text-xs">{journalEntryId}</span></>
                  )}
                </p>
              </div>

              <div className="mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <strong>From:</strong> {formatPeriod(existingBatch.from_period_start)} → <strong>To:</strong> {formatPeriod(existingBatch.to_period_start)}
                </p>
              </div>

              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Carry-Forward Lines</h2>
              <div className="overflow-x-auto mb-6">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Account
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Type
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Ending Balance
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Debit
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Credit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {existingLines.map((line) => {
                      const { debit, credit } = deriveDebitCredit(line.account.type, line.amount)
                      return (
                        <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-4 py-3 text-sm">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {line.account.code} - {line.account.name}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                            {getAccountTypeLabel(line.account.type)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                            {line.amount >= 0 ? "+" : ""}{line.amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                            {debit > 0 ? debit.toLocaleString() : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                            {credit > 0 ? credit.toLocaleString() : "—"}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {existingBatch.note && (
                <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    <strong>Note:</strong> {existingBatch.note}
                  </p>
                </div>
              )}

              {journalEntryId && (
                <div className="mt-4">
                  <button
                    onClick={() => router.push(businessId ? `${buildAccountingRoute("/accounting/ledger", businessId)}&entry_id=${journalEntryId}` : "/accounting")}
                    className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                  >
                    View Journal Entry →
                  </button>
                </div>
              )}
            </div>
          ) : hasWriteAccess && fromPeriodStart && toPeriodStart ? (
            /* Write View - Apply Carry-Forward */
            <>
              {loadingPreview ? (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                  <p className="text-gray-500 dark:text-gray-400">Loading preview...</p>
                </div>
              ) : previewBalances.length > 0 ? (
                <>
                  {/* Preview of Ending Balances */}
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                      Preview: Ending Balances from Source Period
                    </h2>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      The following balance-sheet accounts (including system accounts) will have their ending balances carried forward to the target period. The entry will be naturally balanced (no offset required):
                    </p>
                    <div className="overflow-x-auto mb-4">
                      <table className="w-full">
                        <thead className="bg-gray-50 dark:bg-gray-700">
                          <tr>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                              Account
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                              Type
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                              Ending Balance
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                              Debit
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                              Credit
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {previewBalances.map((balance) => {
                            const { debit, credit } = deriveDebitCredit(balance.account_type, balance.ending_balance)
                            return (
                              <tr key={balance.account_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="px-4 py-3 text-sm">
                                  <div className="font-medium text-gray-900 dark:text-white">
                                    {balance.account_code} - {balance.account_name}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                                  {getAccountTypeLabel(balance.account_type)}
                                </td>
                                <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                                  {balance.ending_balance >= 0 ? "+" : ""}{balance.ending_balance.toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                                  {debit > 0 ? debit.toLocaleString() : "—"}
                                </td>
                                <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">
                                  {credit > 0 ? credit.toLocaleString() : "—"}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Note */}
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Note (Optional)
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Optional note about this carry-forward..."
                      rows={3}
                      disabled={applying}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>

                  {/* Apply Button */}
                  <div className="flex justify-end">
                    <button
                      onClick={() => setShowConfirmModal(true)}
                      disabled={!canApply || applying}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {applying ? "Applying..." : "Apply Carry-Forward"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded mb-6">
                  <p>No balance-sheet accounts with non-zero balances found in source period. Carry-forward cannot be applied.</p>
                </div>
              )}

              {/* Confirmation Modal */}
              {showConfirmModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                      Confirm Apply Carry-Forward
                    </h2>
                    <div className="mb-4">
                      <p className="text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-4">
                        ⚠️ <strong>Warning:</strong> This creates a journal entry in the target period and cannot be edited. Carry-forward is idempotent - it cannot be applied twice for the same source/target period pair.
                      </p>
                      <p className="text-gray-700 dark:text-gray-300 mb-2">
                        <strong>From:</strong> {fromPeriodStart ? formatPeriod(fromPeriodStart) : "—"}
                      </p>
                      <p className="text-gray-700 dark:text-gray-300 mb-4">
                        <strong>To:</strong> {toPeriodStart ? formatPeriod(toPeriodStart) : "—"}
                      </p>
                      <p className="text-gray-700 dark:text-gray-300 mb-2">
                        Accounts: <span className="font-semibold">{previewBalances.length}</span>
                      </p>
                    </div>
                    <div className="mb-6">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={confirmChecked}
                          onChange={(e) => setConfirmChecked(e.target.checked)}
                          className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          I understand that this action creates a journal entry and is idempotent (cannot be applied twice)
                        </span>
                      </label>
                    </div>
                    <div className="flex gap-4">
                      <button
                        onClick={() => {
                          setShowConfirmModal(false)
                          setConfirmChecked(false)
                        }}
                        disabled={applying}
                        className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleApply}
                        disabled={!confirmChecked || applying}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white px-4 py-3 rounded-lg font-medium shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {applying ? "Applying..." : "Confirm Apply"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : !hasWriteAccess ? (
            /* No Write Access */
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
              <p>You do not have permission to apply carry-forward. Only admins, owners, or accountants with write access can apply carry-forward.</p>
            </div>
          ) : null}
        </div>
      </div>
    </ProtectedLayout>
  )
}
