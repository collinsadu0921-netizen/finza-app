"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { useAccountingBusiness } from "@/lib/accounting/useAccountingBusiness"
import { hasAccountingRouteContext } from "@/lib/accounting/assertAccountingRouteContext"
import { logAccountingRouteWithoutBusinessId } from "@/lib/accounting/devContextLogger"
import { getUserRole } from "@/lib/userRoles"
import { isUserAccountantReadonly } from "@/lib/userRoles"
import COAPicker from "@/components/accounting/COAPicker"
import { buildAccountingRoute } from "@/lib/accounting/routes"

type AccountingPeriod = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: "open" | "soft_closed" | "locked"
}

type OpeningBalanceLine = {
  id: string
  account_id: string | null
  amount: number
}

type OpeningBalanceBatch = {
  id: string
  business_id: string
  period_start: string
  equity_offset_account_id: string
  journal_entry_id: string
  applied_by: string
  applied_at: string
  note: string | null
  equity_offset_account: {
    id: string
    code: string
    name: string
    type: string
  } | null
}

type OpeningBalanceLineWithAccount = {
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

export default function OpeningBalancesPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { businessId: urlBusinessId } = useAccountingBusiness()
  const routeContextOk = hasAccountingRouteContext(pathname ?? "", urlBusinessId)
  const [loading, setLoading] = useState(true)
  const [noContext, setNoContext] = useState(false)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [isReadonlyAccountant, setIsReadonlyAccountant] = useState(false)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [lines, setLines] = useState<OpeningBalanceLine[]>([])
  const [equityOffsetAccountId, setEquityOffsetAccountId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [applying, setApplying] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [existingBatch, setExistingBatch] = useState<OpeningBalanceBatch | null>(null)
  const [existingLines, setExistingLines] = useState<OpeningBalanceLineWithAccount[]>([])
  const [journalEntryId, setJournalEntryId] = useState<string | null>(null)

  useEffect(() => {
    if (!routeContextOk && pathname) logAccountingRouteWithoutBusinessId(pathname)
  }, [routeContextOk, pathname])

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
    if (businessId && selectedPeriodStart) {
      loadExistingBatch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, selectedPeriodStart])

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
      // Filter to only open periods for opening balances
      const openPeriods = (data.periods || []).filter((p: AccountingPeriod) => p.status === "open")
      setPeriods(openPeriods)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load accounting periods")
      setLoading(false)
    }
  }

  const loadExistingBatch = async () => {
    if (!businessId || !selectedPeriodStart) return
    try {
      const response = await fetch(
        `/api/accounting/opening-balances?business_id=${businessId}&period_start=${selectedPeriodStart}`
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
      }
    } catch (err: any) {
      console.error("Error loading existing batch:", err)
      // Don't show error - batch might not exist yet
      setExistingBatch(null)
      setExistingLines([])
      setJournalEntryId(null)
    }
  }

  const addLine = () => {
    setLines([...lines, { id: `temp-${Date.now()}`, account_id: null, amount: 0 }])
  }

  const removeLine = (id: string) => {
    setLines(lines.filter((line) => line.id !== id))
  }

  const updateLine = (id: string, field: "account_id" | "amount", value: string | number) => {
    setLines(
      lines.map((line) =>
        line.id === id ? { ...line, [field]: value } : line
      )
    )
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
    // Asset: normal = DEBIT (positive = debit, negative = credit)
    // Liability/Equity: normal = CREDIT (positive = credit, negative = debit)
    if (accountType === "asset") {
      return amount >= 0 ? { debit: amount, credit: 0 } : { debit: 0, credit: Math.abs(amount) }
    } else {
      return amount >= 0 ? { debit: 0, credit: amount } : { debit: Math.abs(amount), credit: 0 }
    }
  }

  const handleApply = async () => {
    if (!businessId || !selectedPeriodStart || !equityOffsetAccountId) {
      setError("Please select a period and equity offset account")
      return
    }

    // Validate lines
    const validLines = lines.filter((line) => line.account_id && line.amount !== 0)
    if (validLines.length === 0) {
      setError("Please add at least one opening balance line")
      return
    }

    // Check for duplicate accounts
    const accountIds = validLines.map((line) => line.account_id)
    if (new Set(accountIds).size !== accountIds.length) {
      setError("Each account can only appear once in opening balance lines")
      return
    }

    // Check if equity offset account is in lines
    if (accountIds.includes(equityOffsetAccountId)) {
      setError("Equity offset account cannot be included in opening balance lines")
      return
    }

    setApplying(true)
    setError("")

    try {
      const response = await fetch("/api/accounting/opening-balances/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: selectedPeriodStart,
          equity_offset_account_id: equityOffsetAccountId,
          lines: validLines.map((line) => ({
            account_id: line.account_id,
            amount: line.amount,
          })),
          note: note.trim() || null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to apply opening balances")
      }

      // Reload existing batch to show read-only view
      await loadExistingBatch()
      setShowConfirmModal(false)
      setConfirmChecked(false)
      setLines([])
      setEquityOffsetAccountId(null)
      setNote("")
    } catch (err: any) {
      setError(err.message || "Failed to apply opening balances")
    } finally {
      setApplying(false)
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

  if (!routeContextOk || noContext) {
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

  // Check write access (not readonly for accountants)
  const hasWriteAccess = 
    (userRole === "admin" || userRole === "owner") ||
    (userRole === "accountant" && !isReadonlyAccountant)
  
  const canApply = hasWriteAccess && existingBatch === null && selectedPeriodStart && equityOffsetAccountId && lines.filter((l) => l.account_id && l.amount !== 0).length > 0

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
                Opening Balances
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Set opening balances for asset, liability, and equity accounts
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Period Selector */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Period (Open Only) *
            </label>
            <select
              value={selectedPeriodStart || ""}
              onChange={(e) => {
                setSelectedPeriodStart(e.target.value || null)
                setLines([])
                setEquityOffsetAccountId(null)
                setNote("")
                setError("")
              }}
              disabled={!!existingBatch}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
            >
              <option value="">-- Select Period --</option>
              {periods.map((period) => (
                <option key={period.id} value={period.period_start}>
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

          {existingBatch ? (
            /* Read-Only View - Opening Balances Already Applied */
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400 text-green-700 dark:text-green-400 px-4 py-3 rounded mb-6">
                <p className="font-medium">Opening balances already applied for this period</p>
                <p className="text-sm mt-1">
                  Applied at: {new Date(existingBatch.applied_at).toLocaleString()}
                  {journalEntryId && (
                    <> • Journal Entry ID: <span className="font-mono text-xs">{journalEntryId}</span></>
                  )}
                </p>
              </div>

              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Opening Balance Lines</h2>
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
                        Amount
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

              <div className="mt-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                {existingBatch.equity_offset_account && (
                  <p className="text-sm text-blue-700 dark:text-blue-400">
                    <strong>Equity Offset Account:</strong> {existingBatch.equity_offset_account.code} - {existingBatch.equity_offset_account.name}
                  </p>
                )}
                {existingBatch.note && (
                  <p className="text-sm text-blue-700 dark:text-blue-400 mt-2">
                    <strong>Note:</strong> {existingBatch.note}
                  </p>
                )}
              </div>

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
          ) : hasWriteAccess ? (
            /* Write View - Apply Opening Balances */
            <>
              {/* Equity Offset Account Selector */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Equity Offset Account (Equity, Non-System) *
                </label>
                <div className="mb-2">
                  <COAPicker
                    businessId={businessId || ""}
                    value={equityOffsetAccountId}
                    onChange={(accountId) => {
                      setEquityOffsetAccountId(accountId)
                      setError("")
                    }}
                    placeholder="Select equity account for balancing..."
                    disabled={applying}
                    restrictToType="equity"
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  This account will be used to balance the opening balance journal entry. Must be an equity account (non-system).
                </p>
              </div>

              {/* Opening Balance Lines */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Opening Balance Lines</h2>
                  <button
                    onClick={addLine}
                    disabled={applying}
                    className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50"
                  >
                    + Add Line
                  </button>
                </div>

                {lines.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-sm">
                    Click "Add Line" to add opening balance entries for accounts
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                            Account *
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                            Amount *
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {lines.map((line) => (
                          <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                            <td className="px-4 py-3">
                              <COAPicker
                                businessId={businessId || ""}
                                value={line.account_id}
                                onChange={(accountId) => {
                                  updateLine(line.id, "account_id", accountId || "")
                                  setError("")
                                }}
                                placeholder="Select account..."
                                disabled={applying}
                                className="min-w-[300px]"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                step="0.01"
                                value={line.amount || ""}
                                onChange={(e) => {
                                  updateLine(line.id, "amount", parseFloat(e.target.value) || 0)
                                  setError("")
                                }}
                                placeholder="0.00"
                                disabled={applying}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-right"
                              />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => removeLine(line.id)}
                                disabled={applying}
                                className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Note (Optional)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note about this opening balance..."
                    rows={3}
                    disabled={applying}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Apply Button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowConfirmModal(true)}
                  disabled={!canApply || applying}
                  className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {applying ? "Applying..." : "Apply Opening Balances"}
                </button>
              </div>

              {/* Confirmation Modal */}
              {showConfirmModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                  <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6">
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                      Confirm Apply Opening Balances
                    </h2>
                    <div className="mb-4">
                      <p className="text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-4">
                        ⚠️ <strong>Warning:</strong> This creates a journal entry and cannot be edited. If you need to correct opening balances, you must post an adjustment entry in a later period.
                      </p>
                      <p className="text-gray-700 dark:text-gray-300 mb-2">
                        Period: <span className="font-semibold">{selectedPeriodStart ? formatPeriod(selectedPeriodStart) : "—"}</span>
                      </p>
                      <p className="text-gray-700 dark:text-gray-300 mb-4">
                        Lines: <span className="font-semibold">{lines.filter((l) => l.account_id && l.amount !== 0).length}</span>
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
                          I understand that this action cannot be undone and I must post an adjustment if corrections are needed
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
          ) : (
            /* No Write Access */
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
              <p>You do not have permission to apply opening balances. Only admins, owners, or accountants with write access can apply opening balances.</p>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
