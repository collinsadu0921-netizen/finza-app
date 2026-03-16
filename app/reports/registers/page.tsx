"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type NonCashTotal = {
  code: string
  name: string
  received: number
  paid: number
}

type RegisterReport = {
  register_id: string
  register_name: string
  session_id: string | null
  opening_cash_balance: number
  cash_received: number
  cash_paid: number
  non_cash_totals: NonCashTotal[]
  expected_cash: number
  closing_cash_balance: number
  variance: number
  invariant_valid: boolean
}

type RegisterReportResponse = {
  period: {
    start_date: string
    end_date: string
  }
  registers: RegisterReport[]
}

export default function RegistersReportPage() {
  const router = useRouter()
  const { format } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reportData, setReportData] = useState<RegisterReportResponse | null>(null)
  
  // Default to today
  const now = new Date()
  const today = now.toISOString().split("T")[0]
  
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)

  useEffect(() => {
    loadReport()
  }, [startDate, endDate])

  const loadReport = async () => {
    try {
      setLoading(true)
      setError("")

      if (!startDate || !endDate) {
        setError("Please select both start and end dates")
        setLoading(false)
        return
      }

      const response = await fetch(
        `/api/reports/registers?start_date=${startDate}&end_date=${endDate}`
      )

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Failed to load Register Report")
        setReportData(null)
        setLoading(false)
        return
      }

      const data = await response.json()
      setReportData(data)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load Register Report")
      setReportData(null)
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading Register Report...</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-6xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Register Report (Ledger-Based)</h1>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              Dashboard
            </button>
          </div>
        </div>

        {/* Date Range Selector */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
            <button
              onClick={loadReport}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {reportData && reportData.registers.length > 0 ? (
          <div className="space-y-4">
            {reportData.registers.map((register) => (
              <div key={`${register.register_id}_${register.session_id || 'no_session'}`} className="border p-6 rounded-lg bg-white">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h2 className="text-xl font-semibold">{register.register_name}</h2>
                    {register.session_id && (
                      <p className="text-sm text-gray-600 mt-1">
                        Session ID: {register.session_id.substring(0, 8)}...
                      </p>
                    )}
                    <p className="text-sm text-gray-600">
                      Period: {reportData.period.start_date} to {reportData.period.end_date}
                    </p>
                  </div>
                  <div
                    className={`px-3 py-1 rounded text-sm font-medium ${
                      register.invariant_valid
                        ? "bg-green-100 text-green-800"
                        : "bg-red-100 text-red-800"
                    }`}
                  >
                    {register.invariant_valid ? "✓ Valid" : "✗ Invalid"}
                  </div>
                </div>

                {/* Cash Reconciliation */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  <div className="border p-4 rounded bg-blue-50">
                    <div className="text-sm text-gray-600 mb-1">Opening Cash Balance</div>
                    <div className="text-2xl font-bold">{format(register.opening_cash_balance)}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      Balance at start of period
                    </div>
                  </div>
                  
                  <div className="border p-4 rounded bg-green-50">
                    <div className="text-sm text-gray-600 mb-1">Cash Received</div>
                    <div className="text-2xl font-bold text-green-700">
                      {format(register.cash_received)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Debits to Cash account
                    </div>
                  </div>
                  
                  <div className="border p-4 rounded bg-red-50">
                    <div className="text-sm text-gray-600 mb-1">Cash Paid</div>
                    <div className="text-2xl font-bold text-red-700">
                      {format(register.cash_paid)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Credits from Cash account
                    </div>
                  </div>
                  
                  <div className="border p-4 rounded bg-purple-50">
                    <div className="text-sm text-gray-600 mb-1">Expected Cash</div>
                    <div className="text-2xl font-bold text-purple-700">
                      {format(register.expected_cash)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Opening + Received
                    </div>
                  </div>
                  
                  <div className="border p-4 rounded bg-indigo-50">
                    <div className="text-sm text-gray-600 mb-1">Closing Cash Balance</div>
                    <div className="text-2xl font-bold text-indigo-700">
                      {format(register.closing_cash_balance)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Opening + Received - Paid
                    </div>
                  </div>
                  
                  <div className={`border p-4 rounded ${
                    register.variance === 0
                      ? "bg-gray-50"
                      : register.variance > 0
                      ? "bg-yellow-50"
                      : "bg-orange-50"
                  }`}>
                    <div className="text-sm text-gray-600 mb-1">Variance</div>
                    <div className={`text-2xl font-bold ${
                      register.variance === 0
                        ? "text-gray-700"
                        : register.variance > 0
                        ? "text-yellow-700"
                        : "text-orange-700"
                    }`}>
                      {format(register.variance)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {register.variance === 0
                        ? "Balanced"
                        : register.variance > 0
                        ? "Shortage"
                        : "Overage"}
                    </div>
                  </div>
                </div>

                {/* Non-Cash Totals */}
                {register.non_cash_totals.length > 0 && (
                  <div className="border-t pt-4">
                    <h3 className="text-sm font-semibold mb-3 text-gray-700">
                      Non-Cash Payment Methods
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {register.non_cash_totals.map((total) => (
                        <div key={total.code} className="border p-3 rounded bg-gray-50">
                          <div className="text-sm font-medium text-gray-700 mb-1">
                            {total.name} ({total.code})
                          </div>
                          <div className="text-sm">
                            <div className="text-gray-600">
                              Received: <span className="font-semibold">{format(total.received)}</span>
                            </div>
                            <div className="text-gray-600">
                              Paid: <span className="font-semibold">{format(total.paid)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Invariant Check */}
                <div className="mt-6 pt-4 border-t">
                  <div className="text-sm text-gray-600 space-y-1">
                    <div>
                      <strong>Invariant:</strong> opening + cash_in - cash_out = closing ± adjustments
                    </div>
                    <div>
                      <strong>Calculation:</strong> {format(register.opening_cash_balance)} + {format(register.cash_received)} - {format(register.cash_paid)} = {format(register.opening_cash_balance + register.cash_received - register.cash_paid)}
                    </div>
                    <div>
                      <strong>Actual Closing:</strong> {format(register.closing_cash_balance)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border p-8 rounded-lg text-center bg-gray-50">
            <p className="text-gray-600">No register data available for the selected period.</p>
          </div>
        )}

        {/* Data Source Note */}
        {reportData && reportData.registers.length > 0 && (
          <div className="mt-4 border p-4 rounded-lg bg-blue-50 border-blue-200">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> This report sources financial data exclusively from{" "}
              <code className="bg-blue-100 px-1 rounded">journal_entry_lines</code> for Cash (1000) and clearing accounts.
              Register/session grouping uses reference_id metadata. All calculations are ledger-based.
            </p>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
