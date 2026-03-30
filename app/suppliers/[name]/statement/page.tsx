"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { useToast } from "@/components/ui/ToastProvider"
import { billSupplierBalanceRemaining } from "@/lib/billBalance"
import { formatMoney } from "@/lib/money"

type Bill = {
  id: string
  bill_number: string
  issue_date: string
  due_date: string | null
  total: number
  status: string
  wht_applicable?: boolean | null
  wht_amount?: number | null
}

type Payment = {
  id: string
  bill_id: string
  amount: number
  date: string
  method: string
  reference: string | null
}

type Summary = {
  totalBilled: number
  totalPaid: number
  totalOutstanding: number
  totalOverdue: number
}

type Supplier = {
  name: string
  phone: string | null
  email: string | null
}

export default function SupplierStatementPage() {
  const router = useRouter()
  const params = useParams()
  const supplierName = decodeURIComponent(params.name as string)
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [bills, setBills] = useState<Bill[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [currencyCode, setCurrencyCode] = useState("GHS")
  const [error, setError] = useState("")

  useEffect(() => {
    loadStatement()
  }, [supplierName])

  const loadStatement = async () => {
    try {
      setLoading(true)
      setError("")
      
      const response = await fetch(`/api/suppliers/statement/${encodeURIComponent(supplierName)}`)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `Failed to load statement: ${response.status}`)
      }

      const data = await response.json()
      
      if (!data || (!data.supplier && !data.bills)) {
        throw new Error("No data returned from server")
      }
      
      setSupplier(data.supplier || { name: supplierName, phone: null, email: null })
      setBills(data.bills || [])
      setPayments(data.payments || [])
      setSummary(data.summary || {
        totalBilled: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        totalOverdue: 0,
      })
      setCurrencyCode(
        typeof data.currency_code === "string" && data.currency_code
          ? data.currency_code
          : "GHS"
      )
      setLoading(false)
    } catch (err: any) {
      console.error("Error loading statement:", err)
      setError(err.message || "Failed to load statement")
      setLoading(false)
    }
  }

  const sendStatementViaWhatsApp = () => {
    if (!supplier || !supplier.phone) {
      toast.showToast("Supplier phone number not available", "warning")
      return
    }

    const billed = formatMoney(summary?.totalBilled ?? 0, currencyCode)
    const paid = formatMoney(summary?.totalPaid ?? 0, currencyCode)
    const outstanding = formatMoney(summary?.totalOutstanding ?? 0, currencyCode)
    const message = `Hello, here is your latest Statement of Account from Business:\n\nTotal Billed: ${billed}\nTotal Paid: ${paid}\nTotal Outstanding: ${outstanding}\n\nFor any clarifications, please reply here.`

    const result = buildWhatsAppLink(supplier.phone, message)
    if (!result.ok) {
      toast.showToast(result.error, "error")
      return
    }
    window.open(result.whatsappUrl, "_blank", "noopener,noreferrer")
  }

  const downloadPDF = () => {
    toast.showToast("PDF download will be available soon", "info")
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

  if (error || !supplier || !summary) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || "Statement not found"}
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  // Group payments by bill
  const paymentsByBill: Record<string, Payment[]> = {}
  payments.forEach((payment) => {
    if (!paymentsByBill[payment.bill_id]) {
      paymentsByBill[payment.bill_id] = []
    }
    paymentsByBill[payment.bill_id].push(payment)
  })

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
                  Supplier Statement
                </h1>
                <p className="text-gray-600 dark:text-gray-400">{supplier.name}</p>
              </div>
              <div className="flex items-center gap-3">
                {supplier.phone && (
                  <button
                    onClick={sendStatementViaWhatsApp}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium shadow-lg transition-all flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    Send via WhatsApp
                  </button>
                )}
                <button
                  onClick={downloadPDF}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium shadow-lg transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Download PDF
                </button>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-700 rounded-xl p-4">
              <div className="text-purple-900 dark:text-purple-300 font-semibold text-sm mb-1">Total Billed</div>
              <div className="text-purple-900 dark:text-purple-300 font-bold text-xl">{formatMoney(summary.totalBilled, currencyCode)}</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <div className="text-green-900 dark:text-green-300 font-semibold text-sm mb-1">Total Paid</div>
              <div className="text-green-900 dark:text-green-300 font-bold text-xl">{formatMoney(summary.totalPaid, currencyCode)}</div>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border border-orange-200 dark:border-orange-700 rounded-xl p-4">
              <div className="text-orange-900 dark:text-orange-300 font-semibold text-sm mb-1">Outstanding</div>
              <div className="text-orange-900 dark:text-orange-300 font-bold text-xl">{formatMoney(summary.totalOutstanding, currencyCode)}</div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border border-red-200 dark:border-red-700 rounded-xl p-4">
              <div className="text-red-900 dark:text-red-300 font-semibold text-sm mb-1">Overdue</div>
              <div className="text-red-900 dark:text-red-300 font-bold text-xl">{formatMoney(summary.totalOverdue, currencyCode)}</div>
            </div>
          </div>

          {/* Bills List */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden mb-6">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">Bills</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Bill #</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Due Date</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {bills.map((bill) => {
                    const billPayments = paymentsByBill[bill.id] || []
                    const totalPaid = billPayments.reduce((sum, p) => sum + Number(p.amount), 0)
                    const balance = billSupplierBalanceRemaining(
                      Number(bill.total),
                      bill.wht_applicable,
                      bill.wht_amount,
                      totalPaid
                    )
                    return (
                      <tr key={bill.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{bill.bill_number}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                          {new Date(bill.issue_date).toLocaleDateString("en-GH")}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                          {bill.due_date ? new Date(bill.due_date).toLocaleDateString("en-GH") : "—"}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">{formatMoney(Number(bill.total), currencyCode)}</td>
                        <td className="px-6 py-4 text-sm">
                          <span className={`px-2 py-1 rounded text-xs ${
                            bill.status === "paid" ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" :
                            bill.status === "overdue" ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300" :
                            bill.status === "partially_paid" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300" :
                            "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                          }`}>
                            {bill.status.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">{formatMoney(balance, currencyCode)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payments List */}
          {payments.length > 0 && (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Payments</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Date</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Bill #</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Method</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Reference</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {payments.map((payment) => {
                      const bill = bills.find((b) => b.id === payment.bill_id)
                      return (
                        <tr key={payment.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">
                            {new Date(payment.date).toLocaleDateString("en-GH")}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{bill?.bill_number || "N/A"}</td>
                          <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{payment.method}</td>
                          <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300">{payment.reference || "—"}</td>
                          <td className="px-6 py-4 text-sm font-semibold text-green-600 dark:text-green-400 text-right">{formatMoney(Number(payment.amount), currencyCode)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

