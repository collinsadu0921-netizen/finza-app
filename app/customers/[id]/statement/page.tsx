"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
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

type Invoice = {
  id: string
  invoice_number: string
  issue_date: string
  due_date: string | null
  total: number
  status: string
}

type Payment = {
  id: string
  invoice_id: string
  amount: number
  date: string
  method: string
  reference: string | null
}

type Summary = {
  totalInvoiced: number
  totalPaid: number
  totalCredits: number
  totalOutstanding: number
  totalOverdue: number
}

type CreditNote = {
  id: string
  credit_number: string
  invoice_id: string
  date: string
  total: number
  status: string
  reason: string | null
}

export default function CustomerStatementPage() {
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

      if (!response.ok) {
        throw new Error("Failed to load statement")
      }

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

    const statementUrl = `${window.location.origin}/customers/${customerId}/statement?start_date=${startDate || ""}&end_date=${endDate || ""}`
    const message = `Hello ${customer.name},

Your statement of account is ready.

View statement:
${statementUrl}

Thank you.`

    const result = buildWhatsAppLink(phone, message)
    if (!result.ok) {
      toast.showToast(result.error, "error")
      return
    }
    window.open(result.whatsappUrl, "_blank", "noopener,noreferrer")
  }

  const downloadPDF = () => {
    // TODO: Implement PDF generation
    window.print()
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800",
      sent: "bg-blue-100 text-blue-800",
      partially_paid: "bg-yellow-100 text-yellow-800",
      paid: "bg-green-100 text-green-800",
      overdue: "bg-red-100 text-red-800",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
        {status.replace("_", " ")}
      </span>
    )
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

  if (error || !customer || !summary) {
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

  // Group payments by invoice
  const paymentsByInvoice: Record<string, Payment[]> = {}
  payments.forEach((payment) => {
    if (!paymentsByInvoice[payment.invoice_id]) {
      paymentsByInvoice[payment.invoice_id] = []
    }
    paymentsByInvoice[payment.invoice_id].push(payment)
  })

  // Group credit notes by invoice
  const creditNotesByInvoice: Record<string, CreditNote[]> = {}
  creditNotes.forEach((cn) => {
    if (!creditNotesByInvoice[cn.invoice_id]) {
      creditNotesByInvoice[cn.invoice_id] = []
    }
    creditNotesByInvoice[cn.invoice_id].push(cn)
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
                <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
                  Statement of Account
                </h1>
                <p className="text-gray-600 dark:text-gray-400">{customer.name}</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={sendStatementViaWhatsApp}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 font-medium shadow-lg transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                  </svg>
                  Send via WhatsApp
                </button>
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

          {/* Date Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 mb-6">
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
                  className="w-full bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 font-medium transition-all"
                >
                  Clear Filters
                </button>
              </div>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4">
              <div className="text-blue-900 dark:text-blue-300 font-semibold text-sm mb-1">Total Invoiced</div>
              <div className="text-blue-900 dark:text-blue-300 font-bold text-xl">{currencySymbol || ""}{summary.totalInvoiced.toFixed(2)}</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <div className="text-green-900 dark:text-green-300 font-semibold text-sm mb-1">Total Paid</div>
              <div className="text-green-900 dark:text-green-300 font-bold text-xl">{currencySymbol || ""}{summary.totalPaid.toFixed(2)}</div>
            </div>
            {summary.totalCredits > 0 && (
              <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border border-red-200 dark:border-red-700 rounded-xl p-4">
                <div className="text-red-900 dark:text-red-300 font-semibold text-sm mb-1">Credit Notes</div>
                <div className="text-red-900 dark:text-red-300 font-bold text-xl">-{currencySymbol || ""}{summary.totalCredits.toFixed(2)}</div>
              </div>
            )}
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border border-orange-200 dark:border-orange-700 rounded-xl p-4">
              <div className="text-orange-900 dark:text-orange-300 font-semibold text-sm mb-1">Outstanding</div>
              <div className="text-orange-900 dark:text-orange-300 font-bold text-xl">{currencySymbol || ""}{summary.totalOutstanding.toFixed(2)}</div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border border-red-200 dark:border-red-700 rounded-xl p-4">
              <div className="text-red-900 dark:text-red-300 font-semibold text-sm mb-1">Overdue</div>
              <div className="text-red-900 dark:text-red-300 font-bold text-xl">{currencySymbol || ""}{summary.totalOverdue.toFixed(2)}</div>
            </div>
          </div>

          {/* Statement Details */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Invoice & Payment History</h2>
            <div className="space-y-4">
              {invoices.map((invoice) => {
                const invoicePayments = paymentsByInvoice[invoice.id] || []
                const invoiceCredits = creditNotesByInvoice[invoice.id] || []
                const totalPaid = invoicePayments.reduce((sum, p) => sum + Number(p.amount), 0)
                const balance = Number(invoice.total) - totalPaid

                return (
                  <div key={invoice.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-gray-900 dark:text-white">#{invoice.invoice_number}</span>
                          {getStatusBadge(invoice.status)}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {new Date(invoice.issue_date).toLocaleDateString("en-GH")}
                          {invoice.due_date && ` • Due: ${new Date(invoice.due_date).toLocaleDateString("en-GH")}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-gray-900 dark:text-white">{currencySymbol || ""}{Number(invoice.total).toFixed(2)}</div>
                        {balance > 0 && (
                          <div className="text-sm text-orange-600 dark:text-orange-400">Balance: {currencySymbol || ""}{balance.toFixed(2)}</div>
                        )}
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
    </ProtectedLayout>
  )
}

