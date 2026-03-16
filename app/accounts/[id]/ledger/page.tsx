"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"

type Account = {
  id: string
  name: string
  code: string
  type: string
}

type Transaction = {
  id: string
  debit: number
  credit: number
  description: string | null
  running_balance: number
  journal_entries: {
    id: string
    date: string
    description: string
    reference_type: string | null
    reference_id: string | null
  }
}

export default function AccountLedgerPage() {
  const router = useRouter()
  const params = useParams()
  const accountId = params.id as string

  const [loading, setLoading] = useState(true)
  const [account, setAccount] = useState<Account | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [finalBalance, setFinalBalance] = useState(0)
  const [error, setError] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

  useEffect(() => {
    loadLedger()
  }, [accountId, startDate, endDate])

  const loadLedger = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (startDate) params.append("start_date", startDate)
      if (endDate) params.append("end_date", endDate)

      const response = await fetch(`/api/accounts/${accountId}/ledger?${params.toString()}`)
      
      if (!response.ok) {
        throw new Error("Failed to load ledger")
      }

      const data = await response.json()
      setAccount(data.account)
      setTransactions(data.transactions || [])
      setFinalBalance(data.final_balance || 0)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load ledger")
      setLoading(false)
    }
  }

  const exportToCSV = () => {
    if (!account || transactions.length === 0) return

    const headers = ["Date", "Description", "Debit", "Credit", "Balance"]
    const rows = transactions.map((t) => [
      new Date(t.journal_entries.date).toLocaleDateString("en-GH"),
      t.journal_entries.description || t.description || "",
      t.debit.toFixed(2),
      t.credit.toFixed(2),
      t.running_balance.toFixed(2),
    ])

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `account-${account.code}-ledger.csv`
    a.click()
    window.URL.revokeObjectURL(url)
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

  if (error || !account) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || "Account not found"}
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                  {account.name} ({account.code})
                </h1>
                <p className="text-gray-600 dark:text-gray-400">Account Ledger</p>
              </div>
              <button
                onClick={exportToCSV}
                className="bg-gradient-to-r from-green-600 to-green-700 text-white px-4 py-2 rounded-lg hover:from-green-700 hover:to-green-800 font-medium shadow-lg transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Export CSV
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-4 mb-6 border border-gray-100 dark:border-gray-700">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={() => {
                    setStartDate("")
                    setEndDate("")
                  }}
                  className="w-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-all"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>

          {/* Balance Summary */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-6 mb-6">
            <div className="flex items-center justify-between">
              <span className="text-blue-900 dark:text-blue-300 font-semibold text-lg">Final Balance:</span>
              <span className="text-blue-900 dark:text-blue-300 font-bold text-2xl">₵{finalBalance.toFixed(2)}</span>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Description</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Debit</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Credit</th>
                    <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-gray-400">
                        No transactions found
                      </td>
                    </tr>
                  ) : (
                    transactions.map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                          {new Date(transaction.journal_entries.date).toLocaleDateString("en-GH")}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                          {transaction.journal_entries.description || transaction.description || "—"}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                          {transaction.debit > 0 ? (
                            <span className="font-medium text-gray-900 dark:text-white">₵{transaction.debit.toFixed(2)}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                          {transaction.credit > 0 ? (
                            <span className="font-medium text-gray-900 dark:text-white">₵{transaction.credit.toFixed(2)}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                          <span className={`font-semibold ${transaction.running_balance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            ₵{transaction.running_balance.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}


