"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getTaxLinesForDisplay, sumTaxLines } from "@/lib/taxes/readTaxLines"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"

const safeNumber = (v: unknown): number =>
  Number.isFinite(Number(v)) ? Number(v) : 0

type CreditNote = {
  id: string
  credit_number: string
  date: string
  reason: string | null
  notes: string | null
  subtotal: number
  total_tax: number
  total: number
  status: string
  public_token: string | null
  tax_lines?: unknown
  invoice_id: string
  invoices: {
    id: string
    invoice_number: string
    total: number
    customers: {
      id: string
      name: string
      email: string | null
      phone: string | null
      whatsapp_phone: string | null
    } | null
  } | null
}

type CreditNoteItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

type Payment = { id: string; amount: number }
type CreditNoteRef = { id: string; total: number; status: string }

type InvoicePayload = {
  invoice: { id: string; total: number; subtotal?: number; total_tax?: number }
  payments: Payment[]
  creditNotes: CreditNoteRef[]
}

export default function CreditNoteViewPage() {
  const router = useRouter()
  const params = useParams()
  const id = (typeof params?.id === "string" ? params.id : "") as string
  const toast = useToast()
  const { openConfirm } = useConfirm()

  const [creditNote, setCreditNote] = useState<CreditNote | null>(null)
  const [items, setItems] = useState<CreditNoteItem[]>([])
  const [invoice, setInvoice] = useState<InvoicePayload["invoice"] | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [otherCredits, setOtherCredits] = useState<CreditNoteRef[]>([])
  const [loading, setLoading] = useState(true)
  const [applyLoading, setApplyLoading] = useState(false)
  const [sendLoading, setSendLoading] = useState(false)
  const [error, setError] = useState("")

  const loadCreditNoteBundle = useCallback(async (creditNoteId: string) => {
    setLoading(true)
    setError("")
    try {
      const cnRes = await fetch(`/api/credit-notes/${creditNoteId}`)
      if (!cnRes.ok) {
        const data = await cnRes.json().catch(() => ({}))
        throw new Error(data.error || "Failed to load credit note")
      }
      const { creditNote: cn, items: cnItems } = await cnRes.json()
      if (!cn) throw new Error("Credit note not found")
      setCreditNote(cn)
      setItems(cnItems ?? [])

      const invoiceId = cn.invoice_id ?? (cn.invoices as { id?: string } | null)?.id
      if (!invoiceId) {
        setInvoice(null)
        setPayments([])
        setOtherCredits([])
        setLoading(false)
        return
      }

      const invRes = await fetch(`/api/invoices/${invoiceId}`)
      if (!invRes.ok) {
        const data = await invRes.json().catch(() => ({}))
        throw new Error(data.error || "Failed to load invoice")
      }
      const invPayload: InvoicePayload = await invRes.json()
      setInvoice(invPayload.invoice ?? null)
      setPayments(invPayload.payments ?? [])
      const applied = (invPayload.creditNotes ?? []).filter(
        (c: CreditNoteRef) => c.status === "applied"
      )
      setOtherCredits(applied)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id) loadCreditNoteBundle(id)
  }, [id, loadCreditNoteBundle])

  const invoiceTotal = safeNumber(invoice?.total ?? creditNote?.invoices?.total ?? 0)
  const totalPaid = payments.reduce((s, p) => s + safeNumber(p.amount), 0)
  const otherCreditsSum = otherCredits
    .filter((c) => c.id !== id)
    .reduce((s, c) => s + safeNumber(c.total), 0)
  const remaining = Math.max(0, invoiceTotal - totalPaid - otherCreditsSum)
  const creditAmount = safeNumber(creditNote?.total ?? 0)
  const balanceAfterApply = remaining - creditAmount

  const applyDisabled = creditNote?.status === "applied" || applyLoading

  const showRefundableBalanceWarning = creditNote && creditNote.status !== "applied" && balanceAfterApply < 0.01

  const handleApplyClick = () => {
    if (!creditNote || applyDisabled) return
    openConfirm({
      title: "Apply credit note",
      description: "Are you sure you want to apply this credit note? This will reduce the invoice balance.",
      confirmLabel: "Apply",
      onConfirm: () => runApply(),
    })
  }

  const runApply = async () => {
    if (!creditNote) return
    setApplyLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/credit-notes/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "applied" }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Failed to apply credit note")
      toast.showToast("Credit note applied successfully.", "success")
      await loadCreditNoteBundle(id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to apply credit note"
      setError(msg)
      toast.showToast(msg, "error")
    } finally {
      setApplyLoading(false)
    }
  }

  const sendViaWhatsApp = () => {
    const inv = creditNote?.invoices
    const customer = inv?.customers as { whatsapp_phone?: string; phone?: string; name?: string } | null
    const phone = customer?.whatsapp_phone || customer?.phone
    if (!phone) {
      toast.showToast("Customer phone number not available", "warning")
      return
    }
    const publicToken = creditNote?.public_token
    if (!publicToken) {
      toast.showToast("Credit note public link is not available. Cannot send via WhatsApp.", "error")
      return
    }
    const publicUrl = `${window.location.origin}/credit-public/${publicToken}`
    const message = `Hello ${customer?.name ?? "there"}, here is your credit note ${creditNote?.credit_number} for Invoice ${inv?.invoice_number ?? ""}:\n\n${publicUrl}\n\nAmount: ${creditAmount.toFixed(2)}.`
    const result = buildWhatsAppLink(phone, message)
    if (!result.ok) {
      toast.showToast(result.error, "error")
      return
    }
    window.open(result.whatsappUrl, "_blank", "noopener,noreferrer")
  }

  const copyLink = () => {
    if (!creditNote?.public_token) return
    const publicUrl = `${window.location.origin}/credit-public/${creditNote.public_token}`
    navigator.clipboard.writeText(publicUrl)
    toast.showToast("Link copied to clipboard.", "success")
  }

  const handleSendCreditNote = async () => {
    if (!id || !creditNote) return
    setSendLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/credit-notes/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || data.message || "Failed to send credit note")
      toast.showToast("Credit note sent successfully.", "success")
      await loadCreditNoteBundle(id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send credit note"
      setError(msg)
      toast.showToast(msg, "error")
    } finally {
      setSendLoading(false)
    }
  }

  const downloadPDF = async () => {
    if (!creditNote) return
    try {
      const res = await fetch(`/api/credit-notes/${id}/pdf`)
      if (!res.ok) throw new Error("Failed to generate PDF")
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${creditNote.credit_number}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: unknown) {
      toast.showToast(err instanceof Error ? err.message : "Failed to download PDF", "error")
    }
  }

  if (loading && !creditNote) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <svg className="animate-spin h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </ProtectedLayout>
    )
  }

  if (error && !creditNote) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="space-y-4 max-w-md w-full">
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error || "Credit note not found"}
            </div>
            <button onClick={() => router.back()} className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 text-sm font-medium">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  if (!creditNote) {
    return (
      <ProtectedLayout>
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm max-w-md w-full">
            Credit note not found
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  const STATUS_DOT: Record<string, string> = {
    draft: "bg-slate-400",
    issued: "bg-blue-500",
    applied: "bg-emerald-500",
    cancelled: "bg-red-500",
  }
  const STATUS_LABEL: Record<string, string> = {
    draft: "Draft",
    issued: "Issued",
    applied: "Applied",
    cancelled: "Cancelled",
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

          {/* Back */}
          <button
            type="button"
            onClick={() => router.back()}
            className="text-slate-500 hover:text-slate-800 flex items-center gap-1.5 text-sm font-medium transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Credit Notes
          </button>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
              <button onClick={() => setError("")} className="ml-2 text-red-500 hover:text-red-700">×</button>
            </div>
          )}

          {/* Header card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Credit Note {creditNote.credit_number}</h1>
                <p className="text-sm text-slate-500 mt-0.5">Invoice adjustment</p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[creditNote.status] ?? "bg-slate-400"}`} />
                  <span className="text-xs font-medium text-slate-700">{STATUS_LABEL[creditNote.status] ?? creditNote.status}</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {creditNote.status !== "applied" && (
                  <button
                    onClick={handleApplyClick}
                    disabled={applyDisabled}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {applyLoading ? "Applying..." : "Apply Credit Note"}
                  </button>
                )}
                {showRefundableBalanceWarning && (
                  <p className="text-sm text-amber-600">Applying this credit will create a refundable balance.</p>
                )}
              </div>
            </div>
          </div>

          {/* Summary card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Summary</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Customer</p>
                <p className="text-sm font-semibold text-slate-800">
                  {(creditNote.invoices?.customers as { name?: string } | null)?.name ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Date</p>
                <p className="text-sm font-semibold text-slate-800">
                  {creditNote.date ? new Date(creditNote.date).toLocaleDateString("en-GH", { year: "numeric", month: "short", day: "numeric" }) : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Linked Invoice</p>
                <p className="text-sm font-semibold text-slate-800">#{creditNote.invoices?.invoice_number ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-0.5">Credit Amount</p>
                <p className="text-sm font-bold text-rose-600">
                  −{safeNumber(creditNote.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              {creditNote.reason && (
                <div className="col-span-2">
                  <p className="text-xs text-slate-500 mb-0.5">Reason</p>
                  <p className="text-sm text-slate-700">{creditNote.reason}</p>
                </div>
              )}
            </div>
          </div>

          {/* Balance breakdown */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Balance</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Invoice Total</dt>
                <dd className="font-medium text-slate-800">{invoiceTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Total Paid</dt>
                <dd className="font-medium text-slate-800">−{totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Other Applied Credits</dt>
                <dd className="font-medium text-slate-800">−{otherCreditsSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </div>
              <div className="flex justify-between pt-2.5 border-t border-slate-100">
                <dt className="font-medium text-slate-700">Remaining Balance</dt>
                <dd className="font-semibold text-slate-900">{remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Credit Note Amount</dt>
                <dd className="font-medium text-rose-600">−{creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
              </div>
              <div className="flex justify-between pt-2.5 border-t-2 border-slate-200">
                <dt className="font-bold text-slate-900">Balance After Apply</dt>
                <dd className={`font-bold ${balanceAfterApply >= -0.01 ? "text-emerald-600" : "text-red-600"}`}>
                  {balanceAfterApply.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </dd>
              </div>
            </dl>
          </div>

          {/* Line items */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Line Items</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Unit Price</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-slate-800">{item.description}</td>
                      <td className="px-4 py-3 text-center text-slate-600">{safeNumber(item.qty)}</td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {safeNumber(item.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-rose-600 tabular-nums">
                        −{safeNumber(item.line_subtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tax breakdown (conditional) */}
          {(() => {
            const lines = getTaxLinesForDisplay(creditNote.tax_lines)
            const totalTax = safeNumber(creditNote.total_tax) || (creditNote.tax_lines ? sumTaxLines(creditNote.tax_lines) : 0)
            if (lines.length === 0 && totalTax <= 0) return null
            return (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Tax Breakdown</h2>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-medium text-slate-800">{safeNumber(creditNote.subtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  {lines.map(({ code, amount }) => (
                    <div key={code} className="flex justify-between">
                      <span className="text-slate-500">{code}</span>
                      <span className="text-rose-600">−{safeNumber(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  ))}
                  {totalTax > 0 && (
                    <div className="flex justify-between pt-2.5 border-t border-slate-100">
                      <span className="font-medium text-slate-700">Total Tax</span>
                      <span className="font-medium text-rose-600">−{totalTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2.5 border-t-2 border-slate-200 font-bold">
                    <span className="text-slate-900">Total Credit</span>
                    <span className="text-rose-600">−{creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Notes */}
          {creditNote.notes && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Notes</h2>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{creditNote.notes}</p>
            </div>
          )}

          {/* Actions */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Actions</h2>
            <div className="flex flex-wrap gap-3">
              {(creditNote.status === "draft" || creditNote.status === "issued") && (
                <button
                  onClick={handleSendCreditNote}
                  disabled={sendLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  {sendLoading ? "Sending..." : "Send Credit Note"}
                </button>
              )}
              <button onClick={sendViaWhatsApp} className="inline-flex items-center gap-2 px-4 py-2 bg-[#25D366] text-white text-sm font-semibold rounded-lg hover:bg-[#1ebe5d] transition-colors">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Send via WhatsApp
              </button>
              <button onClick={copyLink} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Copy Link
              </button>
              <button onClick={downloadPDF} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download PDF
              </button>
            </div>
          </div>

        </div>
      </div>
    </ProtectedLayout>
  )
}
