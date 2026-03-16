"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getTaxLinesForDisplay, sumTaxLines } from "@/lib/taxes/readTaxLines"
import { useToast } from "@/components/ui/ToastProvider"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import ErrorAlert from "@/components/ErrorAlert"
import Button from "@/components/ui/Button"
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
        <div className="p-6 max-w-6xl mx-auto">
          <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
            <div className="h-24 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
          </div>
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
        </div>
      </ProtectedLayout>
    )
  }

  if (error && !creditNote) {
    return (
      <ProtectedLayout>
        <div className="p-6 max-w-6xl mx-auto">
          <ErrorAlert message={error || "Credit note not found"} onDismiss={() => setError("")} />
          <Button variant="ghost" onClick={() => router.back()}>Back</Button>
        </div>
      </ProtectedLayout>
    )
  }

  if (!creditNote) {
    return (
      <ProtectedLayout>
        <div className="p-6 max-w-6xl mx-auto">
          <ErrorAlert message="Credit note not found" />
          <Button variant="ghost" onClick={() => router.back()}>Back</Button>
        </div>
      </ProtectedLayout>
    )
  }

  const statusBadge =
    creditNote.status === "applied"
      ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
      : creditNote.status === "issued"
        ? "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
        : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {error && (
            <ErrorAlert message={error} onDismiss={() => setError("")} type="error" />
          )}

          <div className="mb-6">
            <button
              type="button"
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Credit Note #{creditNote.credit_number}
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Invoice adjustment</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusBadge}`}>
                  {creditNote.status.charAt(0).toUpperCase() + creditNote.status.slice(1)}
                </span>
                {creditNote.status !== "applied" && (
                  <div className="flex flex-col items-end gap-1">
                    <Button
                      variant="primary"
                      onClick={handleApplyClick}
                      disabled={applyDisabled}
                      isLoading={applyLoading}
                    >
                      Apply Credit Note
                    </Button>
                    {showRefundableBalanceWarning && (
                      <p className="text-sm text-amber-600 dark:text-amber-400">
                        Applying this credit will create a refundable balance.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Summary</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Credit Note Status</p>
                    <p className="font-medium text-gray-900 dark:text-white capitalize">{creditNote.status}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Linked Invoice</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      #{creditNote.invoices?.invoice_number ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Credit Amount</p>
                    <p className="font-medium text-red-600 dark:text-red-400">
                      -{safeNumber(creditNote.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Remaining Invoice Balance</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </section>

              <section
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6"
                aria-label="Balance breakdown"
              >
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Balance</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Invoice Total</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">{invoiceTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Total Paid</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">-{totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Other Applied Credits</dt>
                    <dd className="font-medium text-gray-900 dark:text-white">-{otherCreditsSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-600">
                    <dt className="text-gray-700 dark:text-gray-300 font-medium">Remaining Balance</dt>
                    <dd className="font-semibold text-gray-900 dark:text-white">{remaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">Credit Note Amount</dt>
                    <dd className="font-medium text-red-600 dark:text-red-400">-{creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-600">
                    <dt className="text-gray-700 dark:text-gray-300 font-medium">Balance After Apply</dt>
                    <dd
                      className={`font-semibold ${balanceAfterApply >= -0.01
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                        }`}
                    >
                      {balanceAfterApply.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Credit Note Information</h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Customer</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {(creditNote.invoices?.customers as { name?: string } | null)?.name ?? "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Date</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {creditNote.date ? new Date(creditNote.date).toLocaleDateString("en-GH") : "—"}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-gray-500 dark:text-gray-400">Reason</p>
                    <p className="font-medium text-gray-900 dark:text-white">{creditNote.reason ?? "—"}</p>
                  </div>
                </div>
              </section>

              <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Line Items</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-600">
                        <th className="text-left py-2 font-medium text-gray-700 dark:text-gray-300">Description</th>
                        <th className="text-center py-2 font-medium text-gray-700 dark:text-gray-300">Qty</th>
                        <th className="text-right py-2 font-medium text-gray-700 dark:text-gray-300">Unit Price</th>
                        <th className="text-right py-2 font-medium text-gray-700 dark:text-gray-300">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2 text-gray-900 dark:text-white">{item.description}</td>
                          <td className="py-2 text-center text-gray-700 dark:text-gray-300">{safeNumber(item.qty)}</td>
                          <td className="py-2 text-right text-gray-700 dark:text-gray-300">
                            {safeNumber(item.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2 text-right font-medium text-red-600 dark:text-red-400">
                            -{safeNumber(item.line_subtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {(() => {
                const lines = getTaxLinesForDisplay(creditNote.tax_lines)
                const totalTax = safeNumber(creditNote.total_tax) || (creditNote.tax_lines ? sumTaxLines(creditNote.tax_lines) : 0)
                if (lines.length === 0 && totalTax <= 0) return null
                return (
                  <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Tax Breakdown</h2>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
                        <span className="font-medium text-gray-900 dark:text-white">{safeNumber(creditNote.subtotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      {lines.map(({ code, amount }) => (
                        <div key={code} className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">{code}</span>
                          <span className="text-red-600 dark:text-red-400">-{safeNumber(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                      {totalTax > 0 && (
                        <div className="flex justify-between pt-2 border-t border-gray-200 dark:border-gray-600">
                          <span className="font-medium text-gray-700 dark:text-gray-300">Total Tax</span>
                          <span className="font-medium text-red-600 dark:text-red-400">-{totalTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className="flex justify-between pt-2 border-t-2 border-gray-300 dark:border-gray-600 font-semibold">
                        <span className="text-gray-900 dark:text-white">Total Credit</span>
                        <span className="text-red-600 dark:text-red-400">-{creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </section>
                )
              })()}

              {creditNote.notes && (
                <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Notes</h2>
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{creditNote.notes}</p>
                </section>
              )}
            </div>

            <div className="lg:col-span-1">
              <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 sticky top-8">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Actions</h2>
                <div className="space-y-3">
                  {(creditNote.status === "draft" || creditNote.status === "issued") && (
                    <Button
                      variant="primary"
                      onClick={handleSendCreditNote}
                      isLoading={sendLoading}
                      disabled={sendLoading}
                      className="w-full"
                    >
                      Send Credit Note
                    </Button>
                  )}
                  <Button variant="primary" onClick={sendViaWhatsApp} className="w-full">
                    Send via WhatsApp
                  </Button>
                  <Button variant="secondary" onClick={copyLink} className="w-full">
                    Copy Link
                  </Button>
                  <Button variant="outline" onClick={downloadPDF} className="w-full">
                    Download PDF
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </ProtectedLayout>
  )
}
