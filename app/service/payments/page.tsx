"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { exportToCSV, exportToExcel, ExportColumn, formatCurrencyRaw, formatDate } from "@/lib/exportUtils"
import Button from "@/components/ui/Button"
import { getCurrencySymbol } from "@/lib/currency"
import { Money } from "@/components/ui/Money"
import { cn } from "@/lib/utils"

type Payment = {
  id: string
  amount: number
  date: string
  method: string
  reference: string | null
  notes: string | null
  invoice_id: string | null
  invoices: {
    id: string
    invoice_number: string
    customers: {
      id: string
      name: string
    } | null
  } | null
}

type DateRange = "this_month" | "last_month" | "custom"

export default function ServicePaymentsPage() {
  const router = useRouter()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [currencySymbol, setCurrencySymbol] = useState<string>("GHS")
  const [dateRange, setDateRange] = useState<DateRange>("this_month")
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")

  useEffect(() => {
    loadBusiness()
  }, [])

  useEffect(() => {
    if (businessId) {
      loadPayments()
    }
  }, [businessId, dateRange, customStartDate, customEndDate])

  const loadBusiness = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      // Get currency symbol from currency code (no hardcoded fallback)
      const currencyCode = business.default_currency
      const symbol = currencyCode ? getCurrencySymbol(currencyCode) : "GHS"
      setCurrencySymbol(symbol)
    } catch (err: any) {
      console.error("Error loading business:", err)
      setError(err.message || "Failed to load business")
      setLoading(false)
    }
  }

  const getDateRange = () => {
    const today = new Date()
    let startDate: string
    let endDate: string

    if (dateRange === "this_month") {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      startDate = startOfMonth.toISOString().split("T")[0]
      endDate = today.toISOString().split("T")[0]
    } else if (dateRange === "last_month") {
      const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0)
      startDate = startOfLastMonth.toISOString().split("T")[0]
      endDate = endOfLastMonth.toISOString().split("T")[0]
    } else {
      // Custom range
      startDate = customStartDate
      endDate = customEndDate
    }

    return { startDate, endDate }
  }

  const loadPayments = async () => {
    try {
      setLoading(true)
      setError("")

      if (!businessId) return

      const { startDate, endDate } = getDateRange()

      if (dateRange === "custom" && (!startDate || !endDate)) {
        setLoading(false)
        return
      }

      const params = new URLSearchParams()
      params.append("business_id", businessId)
      if (startDate) params.append("start_date", startDate)
      if (endDate) params.append("end_date", endDate)

      const response = await fetch(`/api/payments/list?${params.toString()}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load payments")
      }

      const data = await response.json()
      setPayments(data.payments || [])
    } catch (err: any) {
      console.error("Error loading payments:", err)
      setError(err.message || "Failed to load payments")
    } finally {
      setLoading(false)
    }
  }

  const formatMethod = (method: string) => {
    const methods: Record<string, string> = {
      cash: "Cash",
      bank: "Bank Transfer",
      momo: "Mobile Money",
      card: "Card Payment",
      cheque: "Cheque",
      paystack: "Paystack",
      other: "Other",
    }
    return methods[method] || method
  }

  // Export payments to CSV
  const handleExportCSV = () => {
    try {
      if (payments.length === 0) {
        setError("No payments to export")
        return
      }

      const columns: ExportColumn<Payment>[] = [
        { header: "Payment Date", accessor: (p) => formatDate(p.date), width: 15 },
        { header: "Customer", accessor: (p) => p.invoices?.customers?.name || "N/A", width: 30 },
        { header: "Invoice Reference", accessor: (p) => p.invoices?.invoice_number || "N/A", width: 20 },
        {
          header: "Amount",
          accessor: (p) => Number(p.amount || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        { header: "Payment Method", accessor: (p) => formatMethod(p.method), width: 20 },
      ]

      exportToCSV(payments, columns, "payments")
    } catch (error: any) {
      console.error("Export error:", error)
      setError(error.message || "Failed to export payments")
    }
  }

  // Export payments to Excel
  const handleExportExcel = async () => {
    try {
      if (payments.length === 0) {
        setError("No payments to export")
        return
      }

      const columns: ExportColumn<Payment>[] = [
        {
          header: "Payment Date",
          accessor: (p) => p.date || "",
          formatter: (val) => val ? formatDate(val) : "",
          excelType: "date",
          width: 15,
        },
        { header: "Customer", accessor: (p) => p.invoices?.customers?.name || "N/A", width: 30 },
        { header: "Invoice Reference", accessor: (p) => p.invoices?.invoice_number || "N/A", width: 20 },
        {
          header: "Amount",
          accessor: (p) => Number(p.amount || 0),
          formatter: formatCurrencyRaw,
          excelType: "number",
          width: 15,
        },
        { header: "Payment Method", accessor: (p) => formatMethod(p.method), width: 20 },
      ]

      await exportToExcel(payments, columns, "payments")
    } catch (error: any) {
      console.error("Export error:", error)
      setError(error.message || "Failed to export payments")
    }
  }

  const totalCollected = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const paymentCount = payments.length

  if (loading && !businessId) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
          <p className="text-slate-500 font-medium animate-pulse">Loading Payments...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2 tracking-tight">Payments</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">View all cash collected payments</p>
          </div>
          {payments.length > 0 && (
            <div className="flex gap-2">
              <Button
                onClick={handleExportCSV}
                variant="outline"
                leftIcon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                }
                className="text-xs"
              >
                CSV
              </Button>
              <Button
                onClick={handleExportExcel}
                variant="outline"
                leftIcon={
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                }
                className="text-xs"
              >
                Excel
              </Button>
            </div>
          )}
        </div>

        {/* Summary Bar */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-6 mb-8 flex flex-col md:flex-row gap-8">
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Total Collected</p>
            <div className="text-3xl font-bold text-slate-900 dark:text-white">
              <Money amount={totalCollected} currency={currencySymbol || "GHS"} className="text-3xl" />
            </div>
          </div>
          <div className="w-px bg-slate-100 dark:bg-slate-700 hidden md:block"></div>
          <div className="flex-1">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Transactions</p>
            <p className="text-3xl font-bold text-slate-900 dark:text-white tabular-nums">{paymentCount}</p>
          </div>

          {/* Filters Inline */}
          <div className="flex-1 md:flex-none flex flex-col justify-end gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="w-full md:w-48 text-sm border-slate-200 dark:border-slate-600 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-slate-800"
            >
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="custom">Custom Range</option>
            </select>

            {dateRange === "custom" && (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full text-xs border-slate-200 rounded px-2 py-1"
                />
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full text-xs border-slate-200 rounded px-2 py-1"
                />
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Payments Table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-4"></div>
              <p className="text-slate-500 dark:text-slate-400">Updating list...</p>
            </div>
          ) : payments.length === 0 ? (
            <div className="p-16 text-center">
              <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-1">No payments found</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm">Adjust your date range to see more records.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-700 text-slate-500">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium w-32">Date</th>
                    <th className="px-6 py-3 text-left font-medium">Customer</th>
                    <th className="px-6 py-3 text-left font-medium">Invoice</th>
                    <th className="px-6 py-3 text-left font-medium">Method</th>
                    <th className="px-6 py-3 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {payments.map((payment) => (
                    <tr
                      key={payment.id}
                      className="group hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="px-6 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300 tabular-nums">
                        {new Date(payment.date).toLocaleDateString("en-GH", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-6 py-3 text-slate-900 dark:text-white font-medium">
                        {payment.invoices?.customers?.name || "—"}
                      </td>
                      <td className="px-6 py-3">
                        {payment.invoices?.invoice_number ? (
                          <button
                            onClick={() => router.push(`/service/invoices/${payment.invoices!.id}/view`)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium hover:underline decoration-blue-200 underline-offset-2"
                          >
                            {payment.invoices.invoice_number}
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-slate-600 dark:text-slate-400">
                        <span className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize",
                          payment.method === 'cash' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                            payment.method === 'momo' ? "bg-yellow-50 text-yellow-700 border border-yellow-100" :
                              "bg-slate-100 text-slate-700 border border-slate-200"
                        )}>
                          {formatMethod(payment.method)}
                        </span>
                      </td>
                      <td className="px-6 py-3 whitespace-nowrap text-right">
                        <Money amount={payment.amount} currency={currencySymbol} className="font-bold text-slate-900 dark:text-white" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
