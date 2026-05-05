"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { useToast } from "@/components/ui/ToastProvider"
import { downloadFileFromApi } from "@/lib/download/downloadFileFromApi"

type Customer = {
  id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp_phone: string | null
  address: string | null
}
type Summary = {
  openingBalance?: number
  totalInvoiced: number
  totalPaid: number
  totalCredits: number
  totalOutstanding: number
  totalOverdue: number
  closingBalance?: number
}
type StatementTransaction = {
  id: string
  date: string | null
  type: "invoice" | "payment" | "credit_note"
  reference: string
  description: string
  debit: number
  credit: number
  balance: number
}

export default function ServiceCustomerStatementPage() {
  const router = useRouter()
  const params = useParams()
  const customerId = params.id as string
  const { format } = useBusinessCurrency()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [transactions, setTransactions] = useState<StatementTransaction[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [downloadingPdf, setDownloadingPdf] = useState(false)

  useEffect(() => {
    loadStatement()
  }, [customerId, startDate, endDate])

  const loadStatement = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (startDate) params.append("start_date", startDate)
      if (endDate) params.append("end_date", endDate)

      const response = await fetch(`/api/customers/${customerId}/statement?${params.toString()}`)
      if (!response.ok) throw new Error("Failed to load statement")

      const data = await response.json()
      setCustomer(data.customer)
      setTransactions(data.transactions || [])
      setSummary(data.summary)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load statement")
      setLoading(false)
    }
  }

  const downloadPDF = async () => {
    try {
      setDownloadingPdf(true)
      const query = new URLSearchParams()
      if (startDate) query.set("start_date", startDate)
      if (endDate) query.set("end_date", endDate)
      const suffix = query.toString() ? `?${query.toString()}` : ""
      await downloadFileFromApi(`/api/customers/${customerId}/statement/pdf${suffix}`, {
        fallbackFilename: `customer-statement-${customer?.id?.slice(0, 8) || customerId}.pdf`,
        expectedMimePrefix: "application/pdf",
      })
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Failed to download statement PDF", "error")
    } finally {
      setDownloadingPdf(false)
    }
  }

  const getTypeBadge = (type: StatementTransaction["type"]) => {
    if (type === "invoice") return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
    if (type === "payment") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
    return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300"
  }

  if (loading) {
    return (
      
        <div className="p-6"><p>Loading...</p></div>
      
    )
  }

  if (error || !customer || !summary) {
    return (
      
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error || "Statement not found"}</div>
        </div>
      
    )
  }

  const openingBalance = Number(summary.openingBalance || 0)
  const closingBalance = Number(summary.closingBalance ?? summary.totalOutstanding)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <button onClick={() => router.back()} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back
          </button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white">Customer Statement</h1>
              <p className="text-slate-600 dark:text-slate-300 mt-1">{customer.name}</p>
              <div className="text-sm text-slate-500 dark:text-slate-400 mt-2 space-y-0.5">
                {customer.email ? <p>{customer.email}</p> : null}
                {customer.phone ? <p>{customer.phone}</p> : null}
                {customer.address ? <p>{customer.address}</p> : null}
              </div>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-3">
                Statements are private. Download the PDF and send it manually if needed.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={downloadPDF}
                disabled={downloadingPdf}
                className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-60 font-medium"
              >
                {downloadingPdf ? "Downloading..." : "Download PDF"}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-950" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-950" />
            </div>
            <div className="sm:col-span-2 lg:col-span-2 flex items-end">
              <button onClick={() => { setStartDate(""); setEndDate("") }} className="w-full sm:w-auto bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-medium">
                Clear filters
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4"><div className="text-sm text-slate-500">Opening</div><div className="text-xl font-bold text-slate-900 dark:text-white">{format(openingBalance)}</div></div>
          <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-900/20 p-4"><div className="text-sm text-blue-700 dark:text-blue-300">Invoiced</div><div className="text-xl font-bold text-blue-900 dark:text-blue-200">{format(summary.totalInvoiced)}</div></div>
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-900/20 p-4"><div className="text-sm text-emerald-700 dark:text-emerald-300">Payments</div><div className="text-xl font-bold text-emerald-900 dark:text-emerald-200">{format(summary.totalPaid)}</div></div>
          <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-900/20 p-4"><div className="text-sm text-rose-700 dark:text-rose-300">Credit notes</div><div className="text-xl font-bold text-rose-900 dark:text-rose-200">{format(summary.totalCredits)}</div></div>
          <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-900/20 p-4"><div className="text-sm text-amber-700 dark:text-amber-300">Outstanding</div><div className="text-xl font-bold text-amber-900 dark:text-amber-200">{format(summary.totalOutstanding)}</div></div>
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50/70 dark:bg-red-900/20 p-4"><div className="text-sm text-red-700 dark:text-red-300">Overdue</div><div className="text-xl font-bold text-red-900 dark:text-red-200">{format(summary.totalOverdue)}</div></div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Statement transactions</h2>
            <div className="text-sm text-slate-500 dark:text-slate-400">Closing balance: <span className="font-semibold text-slate-800 dark:text-slate-200">{format(closingBalance)}</span></div>
          </div>
          {transactions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
              No statement transactions found for this date range.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="text-left py-2 pr-3">Date</th>
                    <th className="text-left py-2 pr-3">Type</th>
                    <th className="text-left py-2 pr-3">Reference</th>
                    <th className="text-left py-2 pr-3">Description</th>
                    <th className="text-right py-2 pr-3">Debit</th>
                    <th className="text-right py-2 pr-3">Credit</th>
                    <th className="text-right py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800/70">
                      <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{row.date ? new Date(row.date).toLocaleDateString("en-GH") : "—"}</td>
                      <td className="py-2 pr-3"><span className={`px-2 py-1 rounded text-xs font-medium ${getTypeBadge(row.type)}`}>{row.type === "credit_note" ? "Credit note" : row.type === "payment" ? "Payment" : "Invoice"}</span></td>
                      <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{row.reference || "—"}</td>
                      <td className="py-2 pr-3 text-slate-700 dark:text-slate-300">{row.description || "—"}</td>
                      <td className="py-2 pr-3 text-right text-slate-700 dark:text-slate-300">{row.debit > 0 ? format(row.debit) : "—"}</td>
                      <td className="py-2 pr-3 text-right text-slate-700 dark:text-slate-300">{row.credit > 0 ? format(row.credit) : "—"}</td>
                      <td className="py-2 text-right font-semibold text-slate-900 dark:text-white">{format(row.balance)}</td>
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

