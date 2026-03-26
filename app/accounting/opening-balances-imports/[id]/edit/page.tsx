"use client"

import { useState, useEffect } from "react"
import ProtectedLayout from "@/components/ProtectedLayout"
import EmptyState from "@/components/ui/EmptyState"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getActiveFirmId } from "@/lib/accounting/firm/session"
import AccountingBreadcrumbs from "@/components/AccountingBreadcrumbs"
import COAPicker from "@/components/accounting/COAPicker"
import {
  useAccountingBusiness,
  CLIENT_NOT_SELECTED_DESCRIPTION,
} from "@/lib/accounting/useAccountingBusiness"

type OpeningBalanceLine = {
  id: string
  account_id: string | null
  debit: number
  credit: number
  memo: string
}

type OpeningBalanceImport = {
  id: string
  status: "draft" | "approved" | "posted"
  source_type: "manual" | "csv" | "excel"
  lines: OpeningBalanceLine[]
  period_id: string
  accounting_periods: {
    period_start: string
    period_end: string
    status: string
  } | null
}

export default function EditOpeningBalanceImportPage() {
  const router = useRouter()
  const params = useParams()
  const importId = params.id as string
  const { businessId: clientBusinessId, loading: contextLoading, error: contextError } = useAccountingBusiness()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [firmId, setFirmId] = useState<string | null>(null)
  const [importData, setImportData] = useState<OpeningBalanceImport | null>(null)
  const [lines, setLines] = useState<OpeningBalanceLine[]>([])

  useEffect(() => {
    setFirmId(getActiveFirmId())
  }, [])

  useEffect(() => {
    if (importId && clientBusinessId) {
      loadImport()
    }
  }, [importId, clientBusinessId])

  const loadImport = async () => {
    if (!importId || !clientBusinessId) return

    try {
      setLoading(true)
      const response = await fetch(
        `/api/accounting/opening-balances/${importId}?business_id=${clientBusinessId}`
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load opening balance import")
      }

      const data = await response.json()
      const importData = data.import

      if (!importData) {
        throw new Error("Opening balance import not found")
      }

      if (importData.status !== "draft") {
        setError("Only draft imports can be edited")
        setLoading(false)
        return
      }

      setImportData(importData)
      // Convert lines to editable format
      const editableLines = (importData.lines || []).map((line: any, index: number) => ({
        id: `line-${index}`,
        account_id: line.account_id,
        debit: line.debit || 0,
        credit: line.credit || 0,
        memo: line.memo || "",
      }))

      if (editableLines.length === 0) {
        editableLines.push(
          { id: "1", account_id: null, debit: 0, credit: 0, memo: "" },
          { id: "2", account_id: null, debit: 0, credit: 0, memo: "" }
        )
      }

      setLines(editableLines)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load opening balance import")
      setLoading(false)
    }
  }

  const addLine = () => {
    setLines([
      ...lines,
      { id: Date.now().toString(), account_id: null, debit: 0, credit: 0, memo: "" },
    ])
  }

  const removeLine = (id: string) => {
    if (lines.length <= 2) {
      setError("At least 2 lines are required")
      return
    }
    setLines(lines.filter((line) => line.id !== id))
  }

  const updateLine = (id: string, field: keyof OpeningBalanceLine, value: any) => {
    setLines(
      lines.map((line) => {
        if (line.id === id) {
          return { ...line, [field]: value }
        }
        return line
      })
    )
  }

  const calculateTotals = () => {
    const totalDebit = lines.reduce((sum, line) => sum + (line.debit || 0), 0)
    const totalCredit = lines.reduce((sum, line) => sum + (line.credit || 0), 0)
    return { totalDebit, totalCredit, difference: totalDebit - totalCredit }
  }

  const validateLines = () => {
    if (lines.length < 2) {
      return "At least 2 lines are required"
    }

    for (const line of lines) {
      if (!line.account_id) {
        return "All lines must have an account selected"
      }
      if (line.debit === 0 && line.credit === 0) {
        return "Each line must have either a debit or credit amount"
      }
      if (line.debit < 0 || line.credit < 0) {
        return "Amounts cannot be negative"
      }
    }

    const { difference } = calculateTotals()
    if (Math.abs(difference) > 0.01) {
      return `Debits and credits must balance. Difference: ${difference.toFixed(2)}`
    }

    return null
  }

  const handleSave = async () => {
    if (!importId) return

    const validationError = validateLines()
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setSaving(true)
      setError("")

      // Format lines for API
      const formattedLines = lines.map((line) => ({
        account_id: line.account_id!,
        debit: line.debit || 0,
        credit: line.credit || 0,
        memo: line.memo || null,
      }))

      const response = await fetch(
        `/api/accounting/opening-balances/${importId}?business_id=${clientBusinessId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lines: formattedLines,
          }),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to update opening balance import")
      }

      // Reload import data
      await loadImport()
    } catch (err: any) {
      setError(err.message || "Failed to save opening balance import")
    } finally {
      setSaving(false)
    }
  }

  const { totalDebit, totalCredit, difference } = calculateTotals()
  const isBalanced = Math.abs(difference) < 0.01
  const validationError = validateLines()

  if (contextLoading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
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

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (!importData) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded">
              {error || "Opening balance import not found"}
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
          <AccountingBreadcrumbs />

          <div className="mb-8">
            <button
              onClick={() =>
                router.push(
                  clientBusinessId
                    ? `/accounting/opening-balances-imports?business_id=${clientBusinessId}`
                    : "/accounting/opening-balances-imports"
                )
              }
              className="text-blue-600 dark:text-blue-400 hover:underline mb-2 text-sm"
            >
              ← Back to Opening Balance Imports
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Edit Opening Balance Import
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              Period:{" "}
              {importData.accounting_periods
                ? new Date(importData.accounting_periods.period_start).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                  })
                : "—"}
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {validationError && !isBalanced && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 text-yellow-700 dark:text-yellow-400 px-4 py-3 rounded mb-6">
              {validationError}
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Line Items</h2>
              <button
                onClick={addLine}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg transition-colors"
              >
                + Add Line
              </button>
            </div>

            {!clientBusinessId ? (
              <p className="text-gray-500 dark:text-gray-400">Please select a client first</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Account
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Debit
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Credit
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Memo
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3">
                          <COAPicker
                            businessId={clientBusinessId!}
                            value={line.account_id}
                            onChange={(accountId) => updateLine(line.id, "account_id", accountId)}
                            placeholder="Select account..."
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.debit || ""}
                            onChange={(e) =>
                              updateLine(line.id, "debit", parseFloat(e.target.value) || 0)
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-right"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.credit || ""}
                            onChange={(e) =>
                              updateLine(line.id, "credit", parseFloat(e.target.value) || 0)
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-right"
                            placeholder="0.00"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={line.memo || ""}
                            onChange={(e) => updateLine(line.id, "memo", e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            placeholder="Memo (optional)"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => removeLine(line.id)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                            disabled={lines.length <= 2}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 dark:bg-gray-700 font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">Totals:</td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                        {totalDebit.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900 dark:text-white">
                        {totalCredit.toFixed(2)}
                      </td>
                      <td className="px-4 py-3" colSpan={2}>
                        <span
                          className={
                            isBalanced
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400"
                          }
                        >
                          Difference: {difference.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              onClick={() =>
                router.push(
                  clientBusinessId
                    ? `/accounting/opening-balances-imports?business_id=${clientBusinessId}`
                    : "/accounting/opening-balances-imports"
                )
              }
              className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !isBalanced || !!validationError}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-800 text-white font-medium rounded-lg shadow-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Saving..." : "Save Draft"}
            </button>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
