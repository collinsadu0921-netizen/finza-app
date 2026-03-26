"use client"

/**
 * Shared adjustments form content.
 * Accepts businessId as a prop so it can be used from both:
 *   - /accounting/adjustments (resolves businessId from URL context then passes here)
 *   - /accounting/clients/[id]/adjustments (reads id from params, passes directly)
 */

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { supabase } from "@/lib/supabaseClient"
import { getUserRole, isUserAccountantReadonly } from "@/lib/userRoles"
import AdjustmentDecisionHelper, { type AdjustmentPath } from "@/components/accounting/AdjustmentDecisionHelper"
import ApprovalChainStatus from "@/components/accounting/ApprovalChainStatus"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { formatCurrencySafe } from "@/lib/currency/formatCurrency"

type AccountingPeriod = {
  id: string
  business_id: string
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
  description?: string
}

interface Props {
  businessId: string
}

export default function AdjustmentsContent({ businessId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [isReadonlyAccountant, setIsReadonlyAccountant] = useState(false)
  const [periods, setPeriods] = useState<AccountingPeriod[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedPeriodStart, setSelectedPeriodStart] = useState<string | null>(null)
  const [entryDate, setEntryDate] = useState<string>("")
  const [description, setDescription] = useState("")
  const [lines, setLines] = useState<JournalLine[]>([
    { id: "1", account_id: null, debit: 0, credit: 0 },
    { id: "2", account_id: null, debit: 0, credit: 0 },
  ])
  const [error, setError] = useState("")
  const [applying, setApplying] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [selectedPath, setSelectedPath] = useState<AdjustmentPath | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadAuth() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const [role, readonly] = await Promise.all([
          getUserRole(supabase, user.id, businessId),
          isUserAccountantReadonly(supabase, user.id, businessId),
        ])
        if (!cancelled) {
          setUserRole(role)
          setIsReadonlyAccountant(readonly)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }
    loadAuth()
    return () => { cancelled = true }
  }, [businessId])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    async function loadPeriods() {
      try {
        const res = await fetch(`/api/accounting/periods?business_id=${businessId}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled)
          setPeriods((data.periods ?? []).filter((p: AccountingPeriod) => p.status === "open"))
      } catch { /* silent */ }
    }
    async function loadAccounts() {
      try {
        const res = await fetch(`/api/accounting/coa?business_id=${businessId}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (!cancelled) setAccounts(data.accounts ?? [])
      } catch { /* silent */ }
    }
    loadPeriods()
    loadAccounts()
    return () => { cancelled = true }
  }, [businessId])

  useEffect(() => {
    if (!selectedPeriodStart || periods.length === 0) return
    const period = periods.find((p) => p.period_start === selectedPeriodStart)
    if (period && (!entryDate || entryDate < period.period_start || entryDate > period.period_end)) {
      setEntryDate(period.period_start)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodStart, periods])

  const formatPeriod = (ps: string) => {
    const d = new Date(ps)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  }

  const addLine = () =>
    setLines((prev) => [...prev, { id: Date.now().toString(), account_id: null, debit: 0, credit: 0 }])

  const removeLine = (id: string) => {
    if (lines.length <= 2) { setError("Adjusting journal must have at least 2 lines"); return }
    setLines((prev) => prev.filter((l) => l.id !== id))
  }

  const updateLine = (id: string, field: keyof JournalLine, value: unknown) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l
        const updated = { ...l, [field]: value }
        if (field === "debit" && (value as number) > 0) updated.credit = 0
        else if (field === "credit" && (value as number) > 0) updated.debit = 0
        return updated
      })
    )
    setError("")
  }

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0)
  const imbalance = Math.abs(totalDebit - totalCredit)
  const isBalanced = imbalance < 0.01

  const selectedPeriod = periods.find((p) => p.period_start === selectedPeriodStart)

  const canApply = (): boolean => {
    if (!selectedPeriodStart || !entryDate || !description.trim()) return false
    if (lines.length < 2 || !isBalanced) return false
    if (!selectedPeriod) return false
    if (entryDate < selectedPeriod.period_start || entryDate > selectedPeriod.period_end) return false
    return lines.every((l) => l.account_id && (l.debit > 0 || l.credit > 0))
  }

  const handleApply = async () => {
    if (!canApply()) { setError("Please complete all required fields and ensure entry is balanced"); return }
    setApplying(true)
    setError("")
    try {
      const res = await fetch("/api/accounting/adjustments/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          period_start: selectedPeriodStart,
          entry_date: entryDate,
          description: description.trim(),
          adjustment_reason: description.trim(),
          lines: lines.map((l) => ({
            account_id: l.account_id,
            debit: l.debit || 0,
            credit: l.credit || 0,
            description: l.description || null,
          })),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to apply adjusting journal")
      }
      const data = await res.json()
      if (data.journal_entry_id) {
        router.push(
          `${buildAccountingRoute("/accounting/ledger", businessId)}&entry_id=${data.journal_entry_id}`
        )
      } else {
        setError("Adjusting journal applied but journal entry ID not returned")
        setApplying(false)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to apply adjusting journal")
      setApplying(false)
    }
  }

  const hasWriteAccess =
    userRole === "admin" || userRole === "owner" || (userRole === "accountant" && !isReadonlyAccountant)

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6"><p>Loading...</p></div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                Adjusting Journals
              </h1>
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                Create correcting entries, accrue or defer amounts, or reclassify balances. Adjustments are permanent and auditable.
              </p>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {!hasWriteAccess ? (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded">
              <p>You do not have permission to create adjusting journals. Only admins, owners, or accountants with write access can create adjusting journals.</p>
            </div>
          ) : (
            <>
              <AdjustmentDecisionHelper businessId={businessId} onSelect={setSelectedPath} />

              <div className="mb-6">
                <ApprovalChainStatus businessId={businessId} />
              </div>

              {selectedPath !== "adjustment" && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                  Select &quot;Adjustment / reclassification&quot; above to create an adjusting journal entry on this page.
                </p>
              )}

              {selectedPath === "adjustment" && (
                <>
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Accounting Period (Open Only) *
                        </label>
                        <select
                          value={selectedPeriodStart || ""}
                          onChange={(e) => { setSelectedPeriodStart(e.target.value || null); setError("") }}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                          <option value="">-- Select Period --</option>
                          {periods.map((p) => (
                            <option key={p.id} value={p.period_start}>
                              {formatPeriod(p.period_start)} ({p.status})
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Select an open period. Adjustments cannot be posted into closed or locked periods.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Entry Date *
                        </label>
                        <input
                          type="date"
                          value={entryDate}
                          onChange={(e) => { setEntryDate(e.target.value); setError("") }}
                          min={selectedPeriod?.period_start}
                          max={selectedPeriod?.period_end}
                          disabled={!selectedPeriodStart}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
                        />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          Must fall within selected period:{" "}
                          {selectedPeriod ? `${selectedPeriod.period_start} to ${selectedPeriod.period_end}` : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Description *
                    </label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => { setDescription(e.target.value); setError("") }}
                      placeholder="Enter adjustment description (e.g., 'Accrue interest expense', 'Reclassify prepaid insurance')"
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>

                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-xl font-bold text-gray-900 dark:text-white">Journal Lines *</h2>
                      <button onClick={addLine} className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">
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
                            <th className="px-4 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Description</th>
                            <th className="px-4 py-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {lines.map((line) => (
                            <tr key={line.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <td className="px-4 py-3">
                                <select
                                  value={line.account_id || ""}
                                  onChange={(e) => updateLine(line.id, "account_id", e.target.value || null)}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                >
                                  <option value="">Select account...</option>
                                  {accounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.code} - {a.name} ({a.type}){a.is_system ? " [System]" : ""}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number" step="0.01" min="0"
                                  value={line.debit || ""}
                                  onChange={(e) => updateLine(line.id, "debit", parseFloat(e.target.value) || 0)}
                                  placeholder="0.00"
                                  className="w-full px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="number" step="0.01" min="0"
                                  value={line.credit || ""}
                                  onChange={(e) => updateLine(line.id, "credit", parseFloat(e.target.value) || 0)}
                                  placeholder="0.00"
                                  className="w-full px-3 py-2 text-sm text-right border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                              </td>
                              <td className="px-4 py-3">
                                <input
                                  type="text"
                                  value={line.description || ""}
                                  onChange={(e) => updateLine(line.id, "description", e.target.value)}
                                  placeholder="Optional line description"
                                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                />
                              </td>
                              <td className="px-4 py-3 text-center">
                                {lines.length > 2 && (
                                  <button onClick={() => removeLine(line.id)} className="text-red-600 dark:text-red-400 hover:text-red-800 text-sm">
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
                            <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(totalDebit)}</td>
                            <td className="px-4 py-3 text-right text-gray-900 dark:text-white">{formatCurrencySafe(totalCredit)}</td>
                            <td className="px-4 py-3" colSpan={2}>
                              {isBalanced ? (
                                <span className="text-green-600 dark:text-green-400">✓ Balanced</span>
                              ) : (
                                <span className="text-red-600 dark:text-red-400">Imbalance: {formatCurrencySafe(imbalance)}</span>
                              )}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <div className="flex justify-end mb-6">
                    <button
                      onClick={() => setShowConfirmModal(true)}
                      disabled={!canApply() || applying}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {applying ? "Applying..." : "Apply Adjusting Journal"}
                    </button>
                  </div>

                  {showConfirmModal && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
                          Confirm Apply Adjusting Journal
                        </h2>
                        <div className="mb-4">
                          <p className="text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3 mb-4">
                            ⚠️ <strong>Warning:</strong> This creates a permanent adjusting journal entry and cannot be edited or deleted. This adjustment is auditable and will affect your ledger balances.
                          </p>
                          <p className="text-gray-700 dark:text-gray-300 mb-2"><strong>Period:</strong> {selectedPeriodStart ? formatPeriod(selectedPeriodStart) : "—"}</p>
                          <p className="text-gray-700 dark:text-gray-300 mb-2"><strong>Entry Date:</strong> {entryDate || "—"}</p>
                          <p className="text-gray-700 dark:text-gray-300 mb-2"><strong>Description:</strong> {description || "—"}</p>
                          <p className="text-gray-700 dark:text-gray-300 mb-2"><strong>Lines:</strong> {lines.length}</p>
                          <p className="text-gray-700 dark:text-gray-300 mb-2"><strong>Total Debit:</strong> {formatCurrencySafe(totalDebit)}</p>
                          <p className="text-gray-700 dark:text-gray-300 mb-4"><strong>Total Credit:</strong> {formatCurrencySafe(totalCredit)}</p>
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
                              I understand that this action creates a permanent adjusting journal entry and is auditable
                            </span>
                          </label>
                        </div>
                        <div className="flex gap-4">
                          <button
                            onClick={() => { setShowConfirmModal(false); setConfirmChecked(false) }}
                            disabled={applying}
                            className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleApply}
                            disabled={!confirmChecked || applying}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-medium shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {applying ? "Applying..." : "Confirm Apply"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}
