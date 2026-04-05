"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams, useSearchParams } from "next/navigation"
import Toast from "@/components/Toast"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { getGhanaLegacyView, getTaxBreakdown } from "@/lib/taxes/readTaxLines"
import { formatMoney } from "@/lib/money"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness, getSelectedBusinessId } from "@/lib/business"

type ProformaInvoice = {
  id: string
  business_id: string
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
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  converted: "bg-purple-100 text-purple-700",
  cancelled: "bg-red-100 text-red-700",
  rejected: "bg-red-100 text-red-700",
}

export default function ProformaViewPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const proformaId = (params?.id as string) || ""
  const businessIdFromUrl =
    searchParams.get("business_id") ?? searchParams.get("businessId") ?? null
  const { openConfirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [proforma, setProforma] = useState<ProformaInvoice | null>(null)
  const [items, setItems] = useState<ProformaItem[]>([])
  const [error, setError] = useState("")
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  // Send / share modal
  const [showSendModal, setShowSendModal] = useState(false)
  const [sending, setSending] = useState(false)
  const [copiedSendLink, setCopiedSendLink] = useState(false)

  useEffect(() => {
    if (proformaId) loadProforma()
  }, [proformaId, businessIdFromUrl])

  const loadProforma = async () => {
    try {
      setLoading(true)
      setError("")
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const business = user ? await getCurrentBusiness(supabase, user.id) : null
      const resolvedBusinessId =
        businessIdFromUrl?.trim() ||
        getSelectedBusinessId()?.trim() ||
        business?.id ||
        null
      const qs = resolvedBusinessId
        ? `?business_id=${encodeURIComponent(resolvedBusinessId)}`
        : ""
      const response = await fetch(`/api/proforma/${proformaId}${qs}`)
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

  /** Draft → mark sent + PRF number; already sent → return existing public_token */
  const ensureSentAndGetPublicToken = async (): Promise<string> => {
    if (!proforma) throw new Error("Proforma not loaded")
    if (proforma.status !== "draft") {
      if (!proforma.public_token) throw new Error("This proforma has no public link")
      return proforma.public_token
    }
    const response = await fetch(`/api/proforma/${proformaId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: proforma.business_id }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "Failed to send proforma")
    const tok = data.proforma?.public_token as string | undefined
    if (!tok) throw new Error("Server did not return a client link")
    await loadProforma()
    return tok
  }

  const buildClientUrl = (publicToken: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/proforma-public/${publicToken}`

  const openSendModal = () => {
    setCopiedSendLink(false)
    setShowSendModal(true)
  }

  const closeSendModal = () => {
    setShowSendModal(false)
    setCopiedSendLink(false)
  }

  const handleCopySendLink = async () => {
    try {
      setSending(true)
      const tok = await ensureSentAndGetPublicToken()
      const link = buildClientUrl(tok)
      await navigator.clipboard.writeText(link)
      setCopiedSendLink(true)
      setTimeout(() => setCopiedSendLink(false), 2000)
    } catch (err: any) {
      setToast({ message: err.message || "Could not copy link", type: "error" })
    } finally {
      setSending(false)
    }
  }

  const handleWhatsApp = async () => {
    try {
      setSending(true)
      const tok = await ensureSentAndGetPublicToken()
      const link = buildClientUrl(tok)
      const custPhone = proforma?.customers?.phone?.replace(/\D/g, "")
      const text = encodeURIComponent(
        `Hi${proforma?.customers?.name ? ` ${proforma.customers.name}` : ""},\n\nPlease review and accept your proforma invoice${proforma?.proforma_number ? ` ${proforma.proforma_number}` : ""}.\n\n${link}`
      )
      const url = custPhone
        ? `https://wa.me/${custPhone}?text=${text}`
        : `https://wa.me/?text=${text}`
      window.open(url, "_blank")
    } catch (err: any) {
      setToast({ message: err.message || "Failed to open WhatsApp", type: "error" })
    } finally {
      setSending(false)
    }
  }

  const handleEmail = async () => {
    try {
      setSending(true)
      const tok = await ensureSentAndGetPublicToken()
      const link = buildClientUrl(tok)
      const subject = encodeURIComponent(
        `Proforma Invoice${proforma?.proforma_number ? ` ${proforma.proforma_number}` : ""}`
      )
      const body = encodeURIComponent(
        `Hi${proforma?.customers?.name ? ` ${proforma.customers.name}` : ""},\n\nPlease review your proforma invoice using the link below:\n\n${link}\n\nKindly accept or decline at your earliest convenience.\n\nThank you.`
      )
      const email = proforma?.customers?.email ?? ""
      window.location.href = `mailto:${email}?subject=${subject}&body=${body}`
    } catch (err: any) {
      setToast({ message: err.message || "Failed to open email", type: "error" })
    } finally {
      setSending(false)
    }
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
            body: JSON.stringify({ business_id: proforma.business_id }),
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
            body: JSON.stringify({ business_id: proforma.business_id }),
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
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    )
  }

  if (error || (!loading && !proforma)) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="space-y-4 max-w-md w-full">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
            {error || "Unable to load this proforma invoice."}
          </div>
          <button
            onClick={() => router.push("/service/proforma")}
            className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 text-sm font-medium"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Proformas
          </button>
        </div>
      </div>
    )
  }

  if (!proforma) return null

  const taxBreakdown = proforma.tax_lines
    ? getGhanaLegacyView(proforma.tax_lines)
    : { nhil: proforma.nhil || 0, getfund: proforma.getfund || 0, covid: proforma.covid || 0, vat: proforma.vat || 0 }
  const allTaxLines = proforma.tax_lines ? getTaxBreakdown(proforma.tax_lines) : null
  const totalDiscount = (items || []).reduce((sum, item) => sum + Number(item.discount_amount || 0), 0)

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Back */}
        <button
          onClick={() => router.push("/service/proforma")}
          className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Proformas
        </button>

        {/* Header card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-bold text-slate-900">Proforma Invoice</h1>
                {proforma.proforma_number && (
                  <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 rounded-full text-sm font-mono font-medium">
                    {proforma.proforma_number}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[proforma.status] || STATUS_STYLES.draft}`}>
                  {proforma.status.charAt(0).toUpperCase() + proforma.status.slice(1)}
                </span>
                {proforma.status === "sent" && (
                  <span className="text-xs text-blue-600">Awaiting client response</span>
                )}
                {proforma.status === "converted" && proforma.converted_invoice_id && (
                  <span className="text-xs text-purple-600">Converted to Invoice</span>
                )}
              </div>
            </div>
            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap items-center">
              {/* DRAFT */}
              {proforma.status === "draft" && (
                <>
                  <button
                    onClick={() => router.push(`/service/proforma/${proformaId}/edit`)}
                    className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={openSendModal}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Send to Client
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading}
                    className="text-slate-400 hover:text-slate-600 text-sm px-2 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}
              {/* SENT */}
              {proforma.status === "sent" && (
                <>
                  <button
                    onClick={openSendModal}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                    Share Link
                  </button>
                  <button
                    onClick={handleMarkAccepted}
                    disabled={actionLoading}
                    className="px-3 py-2 text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 rounded-lg text-sm disabled:opacity-50 transition-colors"
                  >
                    Mark as Accepted
                  </button>
                  <button
                    onClick={handleMarkRejected}
                    disabled={actionLoading}
                    className="px-3 py-2 text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 rounded-lg text-sm disabled:opacity-50 transition-colors"
                  >
                    Mark as Declined
                  </button>
                  <button
                    onClick={handleCancel}
                    disabled={actionLoading}
                    className="text-slate-400 hover:text-slate-600 text-sm px-2 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}
              {/* ACCEPTED */}
              {proforma.status === "accepted" && (
                <>
                  <button
                    onClick={handleConvertToInvoice}
                    disabled={actionLoading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
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
                    className="text-slate-400 hover:text-slate-600 text-sm px-2 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}
              {/* CONVERTED */}
              {proforma.status === "converted" && proforma.converted_invoice_id && (
                <button
                  onClick={() => router.push(`/service/invoices/${proforma.converted_invoice_id}/view`)}
                  className="px-4 py-2 bg-purple-600 text-white text-sm font-semibold rounded-lg hover:bg-purple-700 transition-colors"
                >
                  View Invoice
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main Details Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">

          {/* Customer & Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Customer</h3>
              {proforma.customers ? (
                <div>
                  <p className="text-lg font-semibold text-slate-900">{proforma.customers.name}</p>
                  {proforma.customers.email && <p className="text-sm text-slate-500 mt-1">{proforma.customers.email}</p>}
                  {proforma.customers.phone && <p className="text-sm text-slate-500">{proforma.customers.phone}</p>}
                  {proforma.customers.address && <p className="text-sm text-slate-500 mt-1 whitespace-pre-line">{proforma.customers.address}</p>}
                  {proforma.customers.tin && <p className="text-sm text-slate-500 mt-1">TIN: {proforma.customers.tin}</p>}
                </div>
              ) : (
                <p className="text-slate-400">No customer assigned</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Proforma Details</h3>
              <div className="space-y-1.5">
                <div className="flex gap-4">
                  <span className="text-sm text-slate-500 w-28">Issue Date:</span>
                  <span className="text-sm text-slate-800 font-medium">{formatDate(proforma.issue_date)}</span>
                </div>
                <div className="flex gap-4">
                  <span className="text-sm text-slate-500 w-28">Validity Date:</span>
                  <span className="text-sm text-slate-800 font-medium">{formatDate(proforma.validity_date)}</span>
                </div>
                {proforma.payment_terms && (
                  <div className="flex gap-4">
                    <span className="text-sm text-slate-500 w-28">Payment Terms:</span>
                    <span className="text-sm text-slate-800 font-medium">{proforma.payment_terms}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="mb-6">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Line Items</h3>
            {items && items.length > 0 ? (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Unit Price</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Discount</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item, index) => (
                      <tr key={item.id || index} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-800">{item.description || "—"}</td>
                        <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{Number(item.qty) || 0}</td>
                        <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                          {formatMoney(Number(item.unit_price || 0), proforma.currency_code)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                          {Number(item.discount_amount || 0) > 0
                            ? formatMoney(Number(item.discount_amount), proforma.currency_code)
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-800 tabular-nums">
                          {formatMoney(Number(item.line_subtotal || 0), proforma.currency_code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400 border border-slate-200 rounded-xl">
                No line items found.
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t border-slate-100 pt-4">
            <div className="flex justify-end">
              <div className="w-72 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Subtotal:</span>
                  <span className="font-medium text-slate-800 tabular-nums">
                    {formatMoney(Number(proforma.subtotal), proforma.currency_code)}
                  </span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Discounts:</span>
                    <span className="font-medium text-rose-600 tabular-nums">
                      {formatMoney(-Math.abs(totalDiscount), proforma.currency_code)}
                    </span>
                  </div>
                )}
                {Number(proforma.total_tax) > 0 && (
                  <>
                    {proforma.tax_lines && allTaxLines ? (
                      Object.entries(allTaxLines)
                        .filter(([code, amount]) => Number(amount) > 0 && code.toUpperCase() !== "COVID")
                        .map(([code, amount]) => (
                          <div key={code} className="flex justify-between text-sm text-slate-500">
                            <span>{code}:</span>
                            <span className="tabular-nums">{formatMoney(Number(amount), proforma.currency_code)}</span>
                          </div>
                        ))
                    ) : (
                      <>
                        {taxBreakdown.nhil > 0 && (
                          <div className="flex justify-between text-sm text-slate-500">
                            <span>NHIL:</span>
                            <span className="tabular-nums">{formatMoney(Number(taxBreakdown.nhil), proforma.currency_code)}</span>
                          </div>
                        )}
                        {taxBreakdown.getfund > 0 && (
                          <div className="flex justify-between text-sm text-slate-500">
                            <span>GETFund:</span>
                            <span className="tabular-nums">{formatMoney(Number(taxBreakdown.getfund), proforma.currency_code)}</span>
                          </div>
                        )}
                        {taxBreakdown.vat > 0 && (
                          <div className="flex justify-between text-sm text-slate-500">
                            <span>VAT:</span>
                            <span className="tabular-nums">{formatMoney(Number(taxBreakdown.vat), proforma.currency_code)}</span>
                          </div>
                        )}
                      </>
                    )}
                    <div className="flex justify-between text-sm pt-1 border-t border-slate-100">
                      <span className="text-slate-500 font-medium">Total Tax:</span>
                      <span className="font-medium text-slate-800 tabular-nums">
                        {formatMoney(Number(proforma.total_tax), proforma.currency_code)}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-lg pt-2 border-t-2 border-slate-800">
                  <span className="font-bold text-slate-900">Total:</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {formatMoney(Number(proforma.total), proforma.currency_code)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          {proforma.notes && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Notes</h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{proforma.notes}</p>
            </div>
          )}

          {/* Footer Message */}
          {proforma.footer_message && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-sm text-slate-500 italic whitespace-pre-wrap">{proforma.footer_message}</p>
            </div>
          )}

          {/* Client acceptance details */}
          {proforma.status === "accepted" && proforma.client_name_signed && (
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Accepted &amp; Signed by Client
              </h3>
              <div className="flex flex-wrap items-start gap-6">
                {proforma.client_signature && (
                  <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                    <img src={proforma.client_signature} alt="Client signature" className="h-14 w-auto" />
                  </div>
                )}
                <div className="text-sm space-y-0.5">
                  <p className="font-semibold text-slate-800">{proforma.client_name_signed}</p>
                  {proforma.client_id_type && (
                    <p className="text-slate-600">
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
                    <p className="text-slate-400 text-xs">
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
            <div className="mt-6 pt-6 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">Declined by Client</h3>
              <p className="text-sm text-slate-600">{proforma.rejected_reason}</p>
              {proforma.rejected_at && (
                <p className="text-xs text-slate-400 mt-1">
                  {new Date(proforma.rejected_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── SEND / SHARE MODAL ─────────────────────────────────────── */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {proforma?.status !== "draft" && (
                  <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                <h2 className="text-lg font-bold text-slate-800">
                  {proforma?.status === "draft"
                    ? "Share with client"
                    : `${proforma?.proforma_number ?? "Proforma"} — share link`}
                </h2>
              </div>
              <button type="button" onClick={closeSendModal} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-slate-600 mb-1">
                {proforma?.status === "draft"
                  ? "Choose WhatsApp, email, or copy link. We’ll assign a PRF number and mark this proforma as Sent when you continue."
                  : "Share the client link so they can review, accept, or sign."}
              </p>
              {proforma?.status === "draft" && proforma?.customers?.name && (
                <div className="bg-slate-50 rounded-xl px-4 py-3 text-sm mb-2">
                  <p className="text-slate-400 text-xs uppercase tracking-wide font-medium mb-1">Customer</p>
                  <p className="font-semibold text-slate-800">{proforma.customers.name}</p>
                  {proforma.customers.email && <p className="text-slate-500">{proforma.customers.email}</p>}
                  {proforma.customers.phone && <p className="text-slate-500">{proforma.customers.phone}</p>}
                </div>
              )}

                  {/* WhatsApp */}
                  <button
                    type="button"
                    onClick={() => void handleWhatsApp()}
                    disabled={sending}
                    className="w-full flex items-center gap-3 bg-[#25D366] hover:bg-[#1ebe5d] disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
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
                    type="button"
                    onClick={() => void handleEmail()}
                    disabled={sending}
                    className="w-full flex items-center gap-3 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white font-semibold py-3 px-4 rounded-xl transition-colors text-sm"
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
                    type="button"
                    onClick={() => void handleCopySendLink()}
                    disabled={sending}
                    className="w-full flex items-center gap-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-medium py-3 px-4 rounded-xl transition-colors text-sm border border-slate-200"
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
                    type="button"
                    onClick={closeSendModal}
                    className="w-full text-center text-sm text-slate-400 hover:text-slate-600 pt-1"
                  >
                    Done
                  </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
