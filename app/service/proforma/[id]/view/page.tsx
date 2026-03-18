"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import Toast from "@/components/Toast"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { getGhanaLegacyView, getTaxBreakdown } from "@/lib/taxes/readTaxLines"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { supabase } from "@/lib/supabaseClient"

type ProformaInvoice = {
  id: string
  proforma_number: string | null
  issue_date: string
  validity_date: string | null
  payment_terms: string | null
  notes: string | null
  footer_message: string | null
  subtotal: number
  total_tax: number
  total: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  status: string
  apply_taxes: boolean
  tax_lines: any | null
  currency_code: string | null
  currency_symbol: string | null
  converted_invoice_id: string | null
  customers?: {
    id: string
    name: string
    email: string | null
    phone: string | null
    address: string | null
    tin: string | null
  } | null
}

type ProformaItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  accepted: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  converted: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  rejected: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
}

export default function ProformaViewPage() {
  const router = useRouter()
  const params = useParams()
  const proformaId = (params?.id as string) || ""
  const { openConfirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [proforma, setProforma] = useState<ProformaInvoice | null>(null)
  const [items, setItems] = useState<ProformaItem[]>([])
  const [error, setError] = useState("")
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    if (proformaId) loadProforma()
  }, [proformaId])

  const loadProforma = async () => {
    try {
      setLoading(true)
      setError("")

      const response = await fetch(`/api/proforma/${proformaId}`)

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 404) {
          throw new Error("Proforma invoice not found. It may have been deleted or the link is incorrect.")
        }
        throw new Error(data.error || "Failed to load proforma invoice")
      }

      const data = await response.json()
      if (!data.proforma) throw new Error("Proforma data is missing from the response")

      setProforma(data.proforma)
      setItems(data.items || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load proforma invoice")
      setLoading(false)
    }
  }

  const currencyDisplay = resolveCurrencyDisplay(proforma)

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "—"
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const getStatusBadge = (status: string) => (
    <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[status] || STATUS_STYLES.draft}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )

  const handleSend = async () => {
    if (!proforma) return
    openConfirm({
      title: "Send Proforma Invoice",
      description: "This will mark the proforma as sent and assign a proforma number. Are you sure?",
      onConfirm: async () => {
        try {
          setActionLoading(true)
          const response = await fetch(`/api/proforma/${proformaId}/send`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || "Failed to send proforma")
          setToast({ message: "Proforma invoice sent successfully!", type: "success" })
          loadProforma()
        } catch (err: any) {
          setToast({ message: err.message || "Failed to send proforma", type: "error" })
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleAccept = async () => {
    if (!proforma) return
    openConfirm({
      title: "Accept Proforma Invoice",
      description: "Mark this proforma as accepted by the customer?",
      onConfirm: async () => {
        try {
          setActionLoading(true)
          const response = await fetch(`/api/proforma/${proformaId}/accept`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || "Failed to accept proforma")
          setToast({ message: "Proforma invoice accepted!", type: "success" })
          loadProforma()
        } catch (err: any) {
          setToast({ message: err.message || "Failed to accept proforma", type: "error" })
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleReject = async () => {
    if (!proforma) return
    openConfirm({
      title: "Reject Proforma Invoice",
      description: "Mark this proforma as rejected? This cannot be undone.",
      onConfirm: async () => {
        try {
          setActionLoading(true)
          const { error: updateError } = await supabase
            .from("proforma_invoices")
            .update({ status: "rejected" })
            .eq("id", proformaId)
          if (updateError) throw new Error(updateError.message || "Failed to reject proforma")
          setToast({ message: "Proforma invoice rejected.", type: "info" })
          loadProforma()
        } catch (err: any) {
          setToast({ message: err.message || "Failed to reject proforma", type: "error" })
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleCancel = async () => {
    if (!proforma) return
    openConfirm({
      title: "Cancel Proforma Invoice",
      description: "Cancel this proforma invoice? This cannot be undone.",
      onConfirm: async () => {
        try {
          setActionLoading(true)
          const { error: updateError } = await supabase
            .from("proforma_invoices")
            .update({ status: "cancelled" })
            .eq("id", proformaId)
          if (updateError) throw new Error(updateError.message || "Failed to cancel proforma")
          setToast({ message: "Proforma invoice cancelled.", type: "info" })
          loadProforma()
        } catch (err: any) {
          setToast({ message: err.message || "Failed to cancel proforma", type: "error" })
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleConvertToInvoice = async () => {
    if (!proforma) return
    openConfirm({
      title: "Convert to Invoice",
      description: "This will create a new invoice from this proforma. The proforma will be marked as converted. Continue?",
      onConfirm: async () => {
        try {
          setActionLoading(true)
          const response = await fetch(`/api/proforma/${proformaId}/convert-to-invoice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || "Failed to convert proforma to invoice")
          setToast({ message: "Invoice created successfully! Redirecting...", type: "success" })
          setTimeout(() => {
            router.push(`/service/invoices/${data.invoiceId}/view`)
          }, 1000)
        } catch (err: any) {
          setToast({ message: err.message || "Failed to convert proforma", type: "error" })
          setActionLoading(false)
        }
      },
    })
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  if (error || (!loading && !proforma)) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
          {error || "Unable to load this proforma invoice."}
        </div>
        <button
          onClick={() => router.push("/service/proforma")}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
        >
          Back to Proformas
        </button>
      </div>
    )
  }

  if (!proforma) return null

  // Tax display
  const taxBreakdown = proforma.tax_lines
    ? getGhanaLegacyView(proforma.tax_lines)
    : {
        nhil: proforma.nhil || 0,
        getfund: proforma.getfund || 0,
        covid: proforma.covid || 0,
        vat: proforma.vat || 0,
      }
  const allTaxLines = proforma.tax_lines ? getTaxBreakdown(proforma.tax_lines) : null

  return (
    <div className="p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => router.push("/service/proforma")}
              className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Proformas
            </button>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Proforma Invoice</h1>
            {proforma.proforma_number && (
              <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-full text-sm font-mono font-medium">
                {proforma.proforma_number}
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons — status-based */}
        <div className="flex gap-2 flex-wrap justify-end">
          {proforma.status === "draft" && (
            <>
              <button
                onClick={() => router.push(`/service/proforma/${proformaId}/edit`)}
                className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 text-sm"
              >
                Edit
              </button>
              <button
                onClick={handleSend}
                disabled={actionLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                {actionLoading ? "Sending..." : "Send"}
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          )}

          {proforma.status === "sent" && (
            <>
              <button
                onClick={handleAccept}
                disabled={actionLoading}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
              >
                {actionLoading ? "Accepting..." : "Accept"}
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 text-sm disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          )}

          {proforma.status === "accepted" && (
            <>
              <button
                onClick={handleConvertToInvoice}
                disabled={actionLoading}
                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 text-sm disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading ? "Converting..." : "Convert to Invoice"}
                {!actionLoading && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                )}
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 text-sm disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          )}

          {proforma.status === "converted" && proforma.converted_invoice_id && (
            <button
              onClick={() => router.push(`/service/invoices/${proforma.converted_invoice_id}/view`)}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 text-sm"
            >
              View Invoice
            </button>
          )}
        </div>
      </div>

      {/* Status Badge */}
      <div className="mb-6">
        {getStatusBadge(proforma.status)}
        {proforma.status === "converted" && proforma.converted_invoice_id && (
          <span className="ml-3 text-sm text-purple-600 dark:text-purple-400">
            Converted to Invoice
          </span>
        )}
      </div>

      {/* Main Details Card */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">

        {/* Customer & Details Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Customer</h3>
            {proforma.customers ? (
              <div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">{proforma.customers.name}</p>
                {proforma.customers.email && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{proforma.customers.email}</p>
                )}
                {proforma.customers.phone && (
                  <p className="text-sm text-gray-600 dark:text-gray-400">{proforma.customers.phone}</p>
                )}
                {proforma.customers.address && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-line">{proforma.customers.address}</p>
                )}
                {proforma.customers.tin && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">TIN: {proforma.customers.tin}</p>
                )}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No customer assigned</p>
            )}
          </div>

          <div>
            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Proforma Details</h3>
            <div className="space-y-1.5">
              <div className="flex gap-4">
                <span className="text-sm text-gray-500 dark:text-gray-400 w-28">Issue Date:</span>
                <span className="text-sm text-gray-900 dark:text-white font-medium">{formatDate(proforma.issue_date)}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-sm text-gray-500 dark:text-gray-400 w-28">Validity Date:</span>
                <span className="text-sm text-gray-900 dark:text-white font-medium">{formatDate(proforma.validity_date)}</span>
              </div>
              {proforma.payment_terms && (
                <div className="flex gap-4">
                  <span className="text-sm text-gray-500 dark:text-gray-400 w-28">Payment Terms:</span>
                  <span className="text-sm text-gray-900 dark:text-white font-medium">{proforma.payment_terms}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="mb-6">
          <h3 className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Line Items</h3>
          {items && items.length > 0 ? (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Description</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">Qty</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">Unit Price</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">Discount</th>
                    <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {items.map((item, index) => (
                    <tr key={item.id || index} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-4 py-3 text-gray-900 dark:text-white">{item.description || "—"}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">{Number(item.qty) || 0}</td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">
                        {currencyDisplay} {Number(item.unit_price || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 dark:text-gray-300 tabular-nums">
                        {Number(item.discount_amount || 0) > 0
                          ? `${currencyDisplay} ${Number(item.discount_amount).toFixed(2)}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white tabular-nums">
                        {currencyDisplay} {Number(item.line_subtotal || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg">
              No line items found.
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex justify-end">
            <div className="w-72 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                <span className="font-medium text-gray-900 dark:text-white tabular-nums">
                  {currencyDisplay} {Number(proforma.subtotal).toFixed(2)}
                </span>
              </div>

              {Number(proforma.total_tax) > 0 && (
                <>
                  {proforma.tax_lines && allTaxLines ? (
                    Object.entries(allTaxLines)
                      .filter(([code, amount]) => Number(amount) > 0 && code.toUpperCase() !== "COVID")
                      .map(([code, amount]) => (
                        <div key={code} className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                          <span>{code}:</span>
                          <span className="tabular-nums">{currencyDisplay} {Number(amount).toFixed(2)}</span>
                        </div>
                      ))
                  ) : (
                    <>
                      {taxBreakdown.nhil > 0 && (
                        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                          <span>NHIL:</span>
                          <span className="tabular-nums">{currencyDisplay} {Number(taxBreakdown.nhil).toFixed(2)}</span>
                        </div>
                      )}
                      {taxBreakdown.getfund > 0 && (
                        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                          <span>GETFund:</span>
                          <span className="tabular-nums">{currencyDisplay} {Number(taxBreakdown.getfund).toFixed(2)}</span>
                        </div>
                      )}
                      {taxBreakdown.vat > 0 && (
                        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                          <span>VAT:</span>
                          <span className="tabular-nums">{currencyDisplay} {Number(taxBreakdown.vat).toFixed(2)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between text-sm pt-1 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-gray-600 dark:text-gray-400 font-medium">Total Tax:</span>
                    <span className="font-medium text-gray-900 dark:text-white tabular-nums">
                      {currencyDisplay} {Number(proforma.total_tax).toFixed(2)}
                    </span>
                  </div>
                </>
              )}

              <div className="flex justify-between text-lg pt-2 border-t-2 border-gray-300 dark:border-gray-600">
                <span className="font-bold text-gray-900 dark:text-white">Total:</span>
                <span className="font-bold text-gray-900 dark:text-white tabular-nums">
                  {currencyDisplay} {Number(proforma.total).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        {proforma.notes && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Notes</h3>
            <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{proforma.notes}</p>
          </div>
        )}

        {/* Footer Message */}
        {proforma.footer_message && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Footer</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{proforma.footer_message}</p>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  )
}
