"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { useToast } from "@/components/ui/ToastProvider"

type RecurringInvoice = {
  id: string
  frequency: string
  next_run_date: string
  last_run_date: string | null
  auto_send: boolean
  auto_whatsapp: boolean
  status: string
  invoice_template_data: any
  customers: {
    name: string
    email: string | null
    phone: string | null
  } | null
}

export default function RecurringInvoiceViewPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [recurringInvoice, setRecurringInvoice] = useState<RecurringInvoice | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    loadRecurringInvoice()
  }, [id])

  const loadRecurringInvoice = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/recurring-invoices/${id}`)
      
      if (!response.ok) {
        throw new Error("Failed to load recurring invoice")
      }

      const { recurringInvoice: data } = await response.json()
      setRecurringInvoice(data)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load recurring invoice")
      setLoading(false)
    }
  }

  const handleGenerateNow = async () => {
    try {
      const response = await fetch("/api/recurring-invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurring_invoice_id: id }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to generate invoice")
      }

      const { invoice, whatsappInfo } = await response.json()

      if (whatsappInfo?.url) {
        window.open(whatsappInfo.url, "_blank", "noopener,noreferrer")
      }

      toast.showToast(`Invoice ${invoice.invoice_number} generated successfully!`, "success")
      loadRecurringInvoice()
    } catch (err: any) {
      setError(err.message || "Failed to generate invoice")
    }
  }

  const handleToggleStatus = async () => {
    if (!recurringInvoice) return

    try {
      const newStatus = recurringInvoice.status === "active" ? "paused" : "active"
      const response = await fetch(`/api/recurring-invoices/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        throw new Error("Failed to update status")
      }

      loadRecurringInvoice()
    } catch (err: any) {
      setError(err.message || "Failed to update status")
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

  if (error || !recurringInvoice) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || "Recurring invoice not found"}
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const templateData = recurringInvoice.invoice_template_data || {}
  const lineItems = templateData.line_items || []

  const formatFrequency = (frequency: string) => {
    const frequencies: Record<string, string> = {
      weekly: "Weekly",
      biweekly: "Bi-weekly",
      monthly: "Monthly",
      quarterly: "Quarterly",
      yearly: "Yearly",
    }
    return frequencies[frequency] || frequency
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
                  Recurring Invoice
                </h1>
                <p className="text-gray-600 dark:text-gray-400">View and manage recurring billing template</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleStatus}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    recurringInvoice.status === "active"
                      ? "bg-orange-600 text-white hover:bg-orange-700"
                      : "bg-green-600 text-white hover:bg-green-700"
                  }`}
                >
                  {recurringInvoice.status === "active" ? "Pause" : "Resume"}
                </button>
                <button
                  onClick={() => router.push(`/recurring/${id}/edit`)}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-2 rounded-lg hover:from-blue-700 hover:to-indigo-700 font-medium shadow-lg transition-all"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>

          {/* Details */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Recurring Settings</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Customer</label>
                <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">
                  {recurringInvoice.customers?.name || "No Customer"}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Frequency</label>
                <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">
                  {formatFrequency(recurringInvoice.frequency)}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Next Run Date</label>
                <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">
                  {new Date(recurringInvoice.next_run_date).toLocaleDateString("en-GH")}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Last Run</label>
                <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">
                  {recurringInvoice.last_run_date
                    ? new Date(recurringInvoice.last_run_date).toLocaleDateString("en-GH")
                    : "Never"}
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Status</label>
                <p className="mt-1">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      recurringInvoice.status === "active"
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                        : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {recurringInvoice.status.charAt(0).toUpperCase() + recurringInvoice.status.slice(1)}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Auto Send</label>
                <p className="mt-1">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {recurringInvoice.auto_send ? "Email" : ""}
                    {recurringInvoice.auto_whatsapp ? (recurringInvoice.auto_send ? " + WhatsApp" : "WhatsApp") : ""}
                    {!recurringInvoice.auto_send && !recurringInvoice.auto_whatsapp ? "Manual" : ""}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Template Preview */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700 mb-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Invoice Template</h2>
            <div className="space-y-3">
              {lineItems.map((item: any, index: number) => (
                <div key={index} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{item.description}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Qty: {item.qty} × ₵{Number(item.unit_price).toFixed(2)}
                      {item.discount_amount > 0 && ` - Discount: ₵${Number(item.discount_amount).toFixed(2)}`}
                    </p>
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    ₵{((item.qty * item.unit_price) - (item.discount_amount || 0)).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
            {/* Totals from canonical template (subtotal, total_tax, total, tax_lines) */}
            {(templateData.subtotal != null || templateData.total != null) && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-1">
                {templateData.apply_taxes && templateData.subtotal != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                    <span className="font-medium text-gray-900 dark:text-white">₵{Number(templateData.subtotal).toFixed(2)}</span>
                  </div>
                )}
                {templateData.apply_taxes && Array.isArray(templateData.tax_lines?.lines) && templateData.tax_lines.lines.length > 0 && (
                  <>
                    {templateData.tax_lines.lines.map((line: { code?: string; name?: string; amount?: number }, i: number) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">{line.name || line.code || "Tax"}</span>
                        <span className="font-medium text-gray-900 dark:text-white">₵{Number(line.amount || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </>
                )}
                {templateData.apply_taxes && templateData.total_tax != null && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Total Tax</span>
                    <span className="font-medium text-gray-900 dark:text-white">₵{Number(templateData.total_tax).toFixed(2)}</span>
                  </div>
                )}
                {templateData.total != null && (
                  <div className="flex justify-between font-semibold text-gray-900 dark:text-white pt-2">
                    <span>Total</span>
                    <span>₵{Number(templateData.total).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}
            {templateData.notes && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{templateData.notes}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Actions</h2>
            <div className="flex gap-4">
              <button
                onClick={handleGenerateNow}
                disabled={recurringInvoice.status !== "active"}
                className="bg-gradient-to-r from-green-600 to-green-700 text-white px-6 py-3 rounded-lg hover:from-green-700 hover:to-green-800 disabled:opacity-50 font-medium shadow-lg transition-all flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Generate Invoice Now
              </button>
            </div>
            {recurringInvoice.status !== "active" && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                Resume this recurring invoice to enable generation
              </p>
            )}
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}

