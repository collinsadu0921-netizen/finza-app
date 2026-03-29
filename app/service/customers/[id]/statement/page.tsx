"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { useToast } from "@/components/ui/ToastProvider"

type Customer = {
  id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp_phone: string | null
  address: string | null
}
type Invoice = { id: string; invoice_number: string; issue_date: string; due_date: string | null; total: number; status: string }
type Payment = { id: string; invoice_id: string; amount: number; date: string; method: string; reference: string | null }
type Summary = { totalInvoiced: number; totalPaid: number; totalCredits: number; totalOutstanding: number; totalOverdue: number }
type CreditNote = { id: string; credit_number: string; invoice_id: string; date: string; total: number; status: string; reason: string | null }

export default function ServiceCustomerStatementPage() {
  const router = useRouter()
  const params = useParams()
  const customerId = params.id as string
  const { currencySymbol } = useBusinessCurrency()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState("")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")

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
      setInvoices(data.invoices || [])
      setPayments(data.payments || [])
      setCreditNotes(data.creditNotes || [])
      setSummary(data.summary)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load statement")
      setLoading(false)
    }
  }

  const sendStatementViaWhatsApp = () => {
    if (!customer) return
    const phone = customer.whatsapp_phone || customer.phone
    if (!phone) {
      toast.showToast("Customer phone number not available", "warning")
      return
    }
    const statementUrl = `${window.location.origin}/service/customers/${customerId}/statement?start_date=${startDate || ""}&end_date=${endDate || ""}`
    const message = `Hello ${customer.name}, here is your latest Statement of Account from ${"Business"}:\n\n${statementUrl}\n\nTotal Outstanding: ${currencySymbol || ""}${summary?.totalOutstanding.toFixed(2) || "0.00"}.`
    const result = buildWhatsAppLink(phone, message)
    if (!result.ok) {
      toast.showToast(result.error, "error")
      return
    }
    window.open(result.whatsappUrl, "_blank", "noopener,noreferrer")
  }

  const downloadPDF = () => window.print()

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800",
      sent: "bg-blue-100 text-blue-800",
      partially_paid: "bg-amber-50 text-amber-700 border border-amber-100",
      paid: "bg-emerald-100 text-emerald-800 border border-emerald-200",
      overdue: "bg-red-100 text-red-800 border border-red-200",
    }
    const label = status.replace(/_/g, " ")
    return <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.draft}`}>{label}</span>
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

  const paymentsByInvoice: Record<string, Payment[]> = {}
  payments.forEach((payment) => {
    if (!paymentsByInvoice[payment.invoice_id]) paymentsByInvoice[payment.invoice_id] = []
    paymentsByInvoice[payment.invoice_id].push(payment)
  })

  const creditNotesByInvoice: Record<string, CreditNote[]> = {}
  creditNotes.forEach((cn) => {
    if (!creditNotesByInvoice[cn.invoice_id]) creditNotesByInvoice[cn.invoice_id] = []
    creditNotesByInvoice[cn.invoice_id].push(cn)
  })

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button onClick={() => router.back()} className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">Statement of Account</h1>
                <p className="text-gray-600 dark:text-gray-400">{customer.name}</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={sendStatementViaWhatsApp} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium shadow-lg transition-all">Send via WhatsApp</button>
                <button onClick={downloadPDF} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium shadow-lg transition-all">Download PDF</button>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Start Date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">End Date</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2" />
              </div>
              <div className="flex items-end">
                <button onClick={() => { setStartDate(""); setEndDate("") }} className="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-medium transition-all">
                  Clear Filters
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-xl p-4"><div className="font-semibold text-sm mb-1">Total Invoiced</div><div className="font-bold text-xl">{currencySymbol || ""}{summary.totalInvoiced.toFixed(2)}</div></div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-xl p-4"><div className="font-semibold text-sm mb-1">Total Paid</div><div className="font-bold text-xl">{currencySymbol || ""}{summary.totalPaid.toFixed(2)}</div></div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-xl p-4"><div className="font-semibold text-sm mb-1">Outstanding</div><div className="font-bold text-xl">{currencySymbol || ""}{summary.totalOutstanding.toFixed(2)}</div></div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 border border-red-200 rounded-xl p-4"><div className="font-semibold text-sm mb-1">Overdue</div><div className="font-bold text-xl">{currencySymbol || ""}{summary.totalOverdue.toFixed(2)}</div></div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Invoice & Payment History</h2>
            <div className="space-y-4">
              {invoices.map((invoice) => {
                const invoicePayments = paymentsByInvoice[invoice.id] || []
                const invoiceCredits = creditNotesByInvoice[invoice.id] || []
                const totalPaid = invoicePayments.reduce((sum, p) => sum + Number(p.amount), 0)
                const creditsTotal = invoiceCredits.reduce((sum, c) => sum + Number(c.total), 0)
                const balance = Number(invoice.total) - totalPaid - creditsTotal
                const dueStr = invoice.due_date ? String(invoice.due_date).split("T")[0] : null
                const t = new Date()
                const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`
                const isPastDueOpen = balance > 0.01 && !!dueStr && dueStr < todayStr
                const badgeStatus =
                  isPastDueOpen && !["paid", "draft", "cancelled"].includes((invoice.status || "").toLowerCase())
                    ? "overdue"
                    : invoice.status
                return (
                  <div
                    key={invoice.id}
                    className={`rounded-lg border p-4 ${
                      (invoice.status || "").toLowerCase() === "paid" || balance <= 0.01
                        ? "border-emerald-200 bg-emerald-100/80 dark:border-emerald-800/50 dark:bg-emerald-950/35"
                        : isPastDueOpen
                          ? "border-red-200 bg-red-100/80 dark:border-red-800/50 dark:bg-red-950/35"
                          : "border-gray-200 dark:border-gray-700"
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-gray-900 dark:text-white">#{invoice.invoice_number}</span>
                          {getStatusBadge(badgeStatus)}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {new Date(invoice.issue_date).toLocaleDateString("en-GH")}
                          {invoice.due_date && ` • Due: ${new Date(invoice.due_date).toLocaleDateString("en-GH")}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-gray-900 dark:text-white">{currencySymbol || ""}{Number(invoice.total).toFixed(2)}</div>
                        {balance > 0 && <div className="text-sm text-orange-600 dark:text-orange-400">Balance: {currencySymbol || ""}{balance.toFixed(2)}</div>}
                      </div>
                    </div>
                    {invoicePayments.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Payments:</div>
                        {invoicePayments.map((payment) => (
                          <div key={payment.id} className="flex justify-between items-center text-sm mb-1">
                            <span className="text-gray-600 dark:text-gray-400">
                              {new Date(payment.date).toLocaleDateString("en-GH")} • {payment.method}
                              {payment.reference && ` • ${payment.reference}`}
                            </span>
                            <span className="font-medium text-green-600 dark:text-green-400">{currencySymbol || ""}{Number(payment.amount).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {invoiceCredits.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <div className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">Credit Notes:</div>
                        {invoiceCredits.map((creditNote) => (
                          <div key={creditNote.id} className="flex justify-between items-center text-sm mb-1">
                            <span className="text-gray-600 dark:text-gray-400">
                              {creditNote.credit_number} • {new Date(creditNote.date).toLocaleDateString("en-GH")}
                              {creditNote.reason && ` • ${creditNote.reason}`}
                            </span>
                            <span className="font-medium text-red-600 dark:text-red-400">-{currencySymbol || ""}{Number(creditNote.total).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    
  )
}

