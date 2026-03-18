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
  public_token: string | null
  client_name_signed: string | null
  client_id_type: string | null
  client_id_number: string | null
  client_signature: string | null
  signed_at: string | null
  rejected_reason: string | null
  rejected_at: string | null
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

  // Send modal
  const [showSendModal, setShowSendModal] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendDone, setSendDone] = useState(false)
  const [sentProformaToken, setSentProformaToken] = useState<string | null>(null)
  const [copiedSendLink, setCopiedSendLink] = useState(false)

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
        if (response.status === 404) throw new Error("Proforma invoice not found.")
        throw new Error(data.error || "Failed to load proforma invoice")
      }
      const data = await response.json()
      if (!data.proforma) throw new Error("Proforma data is missing from the response")
      setProforma(data.proforma)
      setItems(data.items || [])
    } catch (err: any) {
      setError(err.message || "Failed to load proforma invoice")
    } finally {
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

  /** Step 1 of Send: call API to mark as sent and assign PRF number */
  const executeSend = async () => {
    if (!proforma) return
    setSending(true)
    try {
      const response = await fetch(`/api/proforma/${proformaId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Failed to send proforma")
      await loadProforma()
      // After reload, public_token is set — grab it from the fresh state via data
      setSentProformaToken(data.proforma?.public_token ?? proforma.public_token)
      setSendDone(true)
    } catch (err: any) {
      setToast({ message: err.message || "Failed to send proforma", type: "error" })
      setShowSendModal(false)
    } finally {
      setSending(false)
    }
  }

  const clientLink = () => {
    const token = sentProformaToken ?? proforma?.public_token
    if (!token) return ""
    return `${typeof window !== "undefined" ? window.location.origin : ""}/proforma-public/${token}`
  }

  const openSendModal = () => {
    // If already sent, jump straight to share panel
    if (proforma?.status === "sent") {
      setSendDone(true)
      setSentProformaToken(proforma.public_token)
      setShowSendModal(true)
    } else {
      setSendDone(false)
      setShowSendModal(true)
    }
  }

  const handleCopySendLink = () => {
    navigator.clipboard.writeText(clientLink()).then(() => {
      setCopiedSendLink(true)
      setTimeout(() => setCopiedSendLink(false), 2000)
    })
  }

  const handleWhatsApp = () => {
    const link = clientLink()
    if (!link) return
    const custPhone = proforma?.customers?.phone?.replace(/\D/g, "")
    const text = encodeURIComponent(
      `Hi${proforma?.customers?.name ? ` ${proforma.customers.name}` : ""},\n\nPlease review and accept your proforma invoice${proforma?.proforma_number ? ` ${proforma.proforma_number}` : ""}.\n\n${link}`
    )
    const url = custPhone
      ? `https://wa.me/${custPhone}?text=${text}`
      : `https://wa.me/?text=${text}`
    window.open(url, "_blank")
  }

  const handleEmail = () => {
    const link = clientLink()
    if (!link) return
    const subject = encodeURIComponent(`Proforma Invoice${proforma?.proforma_number ? ` ${proforma.proforma_number}` : ""}`)
    const body = encodeURIComponent(
      `Hi${proforma?.customers?.name ? ` ${proforma.customers.name}` : ""},\n\nPlease review your proforma invoice using the link below:\n\n${link}\n\nKindly accept or decline at your earliest convenience.\n\nThank you.`
    )
    const email = proforma?.customers?.email ?? ""
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`
  }

  const handleMarkAccepted = async () => {
    if (!proforma) return
    openConfirm({
      title: "Record as Accepted",
      description: "Mark this proforma as accepted on behalf of the client (e.g. they approved in person or by phone)?",
      onConfirm: async () => {
        try {
          setActionLoading(true)
          const response = await fetch(`/api/proforma/${proformaId}/accept`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || "Failed to accept proforma")
          setToast({ message: "Recorded as accepted.", type: "success" })
          loadProforma()
        } catch (err: any) {
          setToast({ message: err.message || "Failed to accept proforma", type: "error" })
        } finally {
          setActionLoading(false)
        }
      },
    })
  }

  const handleMarkRejected = async () => {
    if (!proforma) return
    openConfirm({
      title: "Record as Declined",
      description: "Mark this proforma as declined (e.g. client declined in person or by phone)?",
      onConfirm: async () => {
        try {
          setActionLoading(true)
          const { error: updateError } = await supabase
            .from("proforma_invoices")
            .update({ status: "rejected" })
            .eq("id", proformaId)
          if (updateError) throw new Error(updateError.message || "Failed to decline proforma")
          setToast({ message: "Recorded as declined.", type: "info" })
          loadProforma()
        } catch (err: any) {
          setToast({ message: err.message || "Failed to decline proforma", type: "error" })
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
          setTimeout(() => router.push(`/service/invoices/${data.invoiceId}/view`), 1000)
        } catch (err: any) {
          setToast({ message: err.message || "Failed to convert proforma", type: "error" })
          setActionLoading(false)
        }
      },
    })
  }

  if (loading) {
    return <div className="p-6"><p className="text-gray-500">Loading...</p></div>
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

  const taxBreakdown = proforma.tax_lines
    ? getGhanaLegacyView(proforma.tax_lines)
    : { nhil: proforma.nhil || 0, getfund: proforma.getfund || 0, covid: proforma.covid || 0, vat: proforma.vat || 0 }
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
        <div className="flex gap-2 flex-wrap justify-end items-center">

          {/* DRAFT */}
          {proforma.status === "draft" && (
            <>
              <button
                onClick={() => router.push(`/service/proforma/${proformaId}/edit`)}
                className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-50 text-sm"
              >
                Edit
              </button>
              <button
                onClick={openSendModal}
                disabled={actionLoading}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50 flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                Send to Client
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="text-gray-500 hover:text-gray-700 text-sm px-2 py-2"
              >
                Cancel
              </button>
            </>
          )}

          {/* SENT — focus on sharing; Accept/Reject are manual overrides */}
          {proforma.status === "sent" && (
            <>
              <button
                onClick={openSendModal}
                className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-black text-sm font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share Link
              </button>
              {/* Manual record buttons — secondary */}
              <button
                onClick={handleMarkAccepted}
                disabled={actionLoading}
                className="text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
              >
                Mark as Accepted
              </button>
              <button
                onClick={handleMarkRejected}
                disabled={actionLoading}
                className="text-orange-600 hover:text-orange-700 border border-orange-200 bg-orange-50 hover:bg-orange-100 px-3 py-2 rounded-lg text-sm disabled:opacity-50 transition-colors"
              >
                Mark as Declined
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="text-gray-500 hover:text-gray-700 text-sm px-2 py-2"
              >
                Cancel
              </button>
            </>
          )}

          {/* ACCEPTED — convert to invoice */}
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
                className="text-gray-500 hover:text-gray-700 text-sm px-2 py-2"
              >
                Cancel
              </button>
            </>
          )}

          {/* CONVERTED */}
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

      {/* Status */}
      <div className="mb-6 flex items-center gap-3">
        {getStatusBadge(proforma.status)}
        {proforma.status === "sent" && (
          <span className="text-sm text-blue-600 dark:text-blue-400">Awaiting client response</span>
        )}
        {proforma.status === "converted" && proforma.converted_invoice_id && (
          <span className="text-sm text-purple-600 dark:text-purple-400">Converted to Invoice</span>
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
                {proforma.customers.email && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{proforma.customers.email}</p>}
                {proforma.customers.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{proforma.customers.phone}</p>}
                {proforma.customers.address && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-line">{proforma.customers.address}</p>}
                {proforma.customers.tin && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">TIN: {proforma.customers.tin}</p>}
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

        {/* Line Items */}
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
            <p className="text-sm text-gray-600 dark:text-gray-400 italic whitespace-pre-wrap">{proforma.footer_message}</p>
          </div>
        )}

        {/* Client acceptance details */}
        {proforma.status === "accepted" && proforma.client_name_signed && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
              Accepted &amp; Signed by Client
            </h3>
            <div className="flex flex-wrap items-start gap-6">
              {proforma.client_signature && (
                <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-800/50">
                  <img src={proforma.client_signature} alt="Client signature" className="h-14 w-auto" />
                </div>
              )}
              <div className="text-sm space-y-0.5">
                <p className="font-semibold text-gray-800 dark:text-gray-200">{proforma.client_name_signed}</p>
                {proforma.client_id_type && (
                  <p className="text-gray-600 dark:text-gray-400">
                    {proforma.client_id_type === "ghana_card" ? "Ghana Card" :
                     proforma.client_id_type === "national_id" ? "National ID" :
                     proforma.client_id_type === "passport" ? "Passport" :
                     proforma.client_id_type === "drivers_license" ? "Driver's License" :
                     proforma.client_id_type === "voters_id" ? "Voter's ID" :
                     proforma.client_id_type}
                    {proforma.client_id_number && `: ${proforma.client_id_number}`}
                  </p>
                )}
                {proforma.signed_at && (
                  <p className="text-gray-400 dark:text-gray-500 text-xs">
                    Signed {new Date(proforma.signed_at).toLocaleDateString("en-GB", {
                      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Rejection details */}
        {(proforma.status === "rejected") && proforma.rejected_reason && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h3 className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-2">Declined by Client</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">{proforma.rejected_reason}</p>
            {proforma.rejected_at && (
              <p className="text-xs text-gray-400 mt-1">
                {new Date(proforma.rejected_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── SEND MODAL ─────────────────────────────────────── */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

            {/* Step 1: Confirm send */}
            {!sendDone && (
              <>
                <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-700 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-slate-800 dark:text-white">Send Proforma Invoice</h2>
                  <button onClick={() => setShowSendModal(false)} className="text-slate-400 hover:text-slate-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    This will assign a proforma number <span className="font-semibold">PRF-XXXXXX</span> and mark the invoice as sent. You can then share the client link via WhatsApp, email, or copy it directly.
                  </p>
                  {proforma?.customers?.name && (
                    <div className="bg-slate-50 dark:bg-gray-800 rounded-xl px-4 py-3 text-sm">
                      <p className="text-slate-400 text-xs uppercase tracking-wide font-medium mb-1">Sending to</p>
                      <p className="font-semibold text-slate-800 dark:text-white">{proforma.customers.name}</p>
                      {proforma.customers.email && <p className="text-slate-500">{proforma.customers.email}</p>}
                      {proforma.customers.phone && <p className="text-slate-500">{proforma.customers.phone}</p>}
                    </div>
                  )}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setShowSendModal(false)}
                      className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={executeSend}
                      disabled={sending}
                      className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                    >
                      {sending ? "Sending…" : "Confirm & Send"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Step 2: Share options */}
            {sendDone && (
              <>
                <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">
                      {proforma?.proforma_number ?? "Proforma"} sent!
                    </h2>
                  </div>
                  <button onClick={() => setShowSendModal(false)} className="text-slate-400 hover:text-slate-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="p-6 space-y-3">
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    Share the client link so they can review, accept, and sign.
                  </p>

                  {/* WhatsApp */}
                  <button
                    onClick={handleWhatsApp}
                    className="w-full flex items-center gap-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
                  >
                    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                    </svg>
                    Send via WhatsApp
                    {proforma?.customers?.phone && (
                      <span className="ml-auto text-white/70 text-xs">{proforma.customers.phone}</span>
                    )}
                  </button>

                  {/* Email */}
                  <button
                    onClick={handleEmail}
                    className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
                  >
                    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    Send via Email
                    {proforma?.customers?.email && (
                      <span className="ml-auto text-white/60 text-xs">{proforma.customers.email}</span>
                    )}
                  </button>

                  {/* Copy link */}
                  <button
                    onClick={handleCopySendLink}
                    className="w-full flex items-center gap-3 bg-slate-100 hover:bg-slate-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-slate-700 dark:text-slate-200 font-medium py-3 px-4 rounded-xl transition-colors text-sm border border-slate-200 dark:border-gray-700"
                  >
                    {copiedSendLink ? (
                      <>
                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Link copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Copy client link
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => setShowSendModal(false)}
                    className="w-full text-center text-sm text-slate-400 hover:text-slate-600 pt-1"
                  >
                    Done
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
