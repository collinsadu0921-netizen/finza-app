"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useParams, usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"

const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>
import ActivityHistory from "@/components/ActivityHistory"
import Toast from "@/components/Toast"
import SendInvoiceModal from "@/components/invoices/SendInvoiceModal"
import SendMethodDropdown, { SendMethod } from "@/components/invoices/SendMethodDropdown"
import InvoicePreviewModal from "@/components/invoices/InvoicePreviewModal"
import AddPaymentModal from "@/components/invoices/AddPaymentModal"
import { getTaxLinesForDisplay, sumTaxLines } from "@/lib/taxes/readTaxLines"
import { normalizeCountry, getAllowedMethods, getMobileMoneyLabel } from "@/lib/payments/eligibility"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { formatMoney } from "@/lib/money"

// FINZA Design System Components
import { StatusBadge } from "@/components/ui/StatusBadge"
import { getCurrentBusiness, getSelectedBusinessId } from "@/lib/business"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { downloadInvoicePdfDocument } from "@/lib/invoices/downloadInvoicePdfClient"

type Invoice = {
  id: string
  business_id: string
  invoice_number: string
  issue_date: string
  due_date: string | null
  payment_terms: string | null
  notes: string | null
  footer_message: string | null
  currency_code: string
  currency_symbol: string
  subtotal: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  total_tax: number
  total: number
  apply_taxes: boolean
  status: string
  public_token: string | null
  sent_at: string | null
  sent_via_method: string | null
  source_type: string | null
  source_id: string | null
  tax_lines?: any | null
  fx_rate?: number | null
  home_currency_code?: string | null
  wht_receivable_applicable?: boolean | null
  wht_receivable_amount?: number | null
  orders?: {
    id: string
    order_number: string | null
  } | null
  customers: {
    id: string
    name: string
    email: string | null
    phone: string | null
    whatsapp_phone: string | null
    address: string | null
  } | null
}

type Payment = {
  id: string
  amount: number
  date: string
  method: string
  reference: string | null
  notes: string | null
  public_token: string | null
  public_url?: string // Optional dynamic field
}

type InvoiceItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

type CreditNote = {
  id: string
  invoice_id: string | null
  credit_number: string
  total: number
  date: string
  status: string
}

export default function InvoiceViewPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const businessIdFromUrl =
    searchParams.get("business_id") ?? searchParams.get("businessId") ?? null
  const [resolvedBusinessId, setResolvedBusinessId] = useState<string | null>(businessIdFromUrl)
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? FragmentWrapper : ProtectedLayout
  const params = useParams()
  const invoiceId = (params?.id as string) || ""

  useEffect(() => {
    setResolvedBusinessId(businessIdFromUrl ?? getSelectedBusinessId())
  }, [businessIdFromUrl])

  const invoiceApiSuffix = resolvedBusinessId
    ? `?business_id=${encodeURIComponent(resolvedBusinessId)}`
    : ""
  const { openConfirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [error, setError] = useState("")
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendModalVariant, setSendModalVariant] = useState<"send" | "resend">("send")
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [downloadDocLoading, setDownloadDocLoading] = useState(false)
  const [sendMethod, setSendMethod] = useState<SendMethod>("whatsapp")
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)
  const [hasCheckedSendParam, setHasCheckedSendParam] = useState(false)
  const [reconcileResult, setReconcileResult] = useState<{
    status: string
    delta: number
    expectedBalance?: number
    ledgerBalance?: number
  } | null>(null)

  const loadInvoice = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      setReconcileResult(null)

      if (!invoiceId) {
        throw new Error("Invoice ID is missing")
      }

      const response = await fetch(`/api/invoices/${invoiceId}${invoiceApiSuffix}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))

        if (response.status === 404) {
          throw new Error("We couldn't find this invoice. It may have been deleted or the link is incorrect.")
        } else if (response.status === 401 || response.status === 403) {
          throw new Error("You can't view this invoice. It may have been removed or you don't have access.")
        } else {
          const friendlyError = errorData.error || errorData.details || "We couldn't load this invoice. Please refresh or check your connection."
          throw new Error(friendlyError)
        }
      }

      const data = await response.json()

      if (!data.invoice) {
        throw new Error("Invoice data is missing from the response")
      }

      setInvoice(data.invoice)
      setItems(data.items || [])
      setPayments(data.payments || [])
      setCreditNotes(data.creditNotes || [])

      if (data.reconciliationWarning) {
        setReconcileResult({
          status: data.reconciliationWarning.status ?? "",
          delta: typeof data.reconciliationWarning.delta === "number" ? data.reconciliationWarning.delta : 0,
          expectedBalance: data.reconciliationWarning.expectedBalance,
          ledgerBalance: data.reconciliationWarning.ledgerBalance,
        })
      } else if (data.invoice?.business_id) {
        try {
          const recUrl = `/api/internal/reconcile/invoice?businessId=${encodeURIComponent(data.invoice.business_id)}&invoiceId=${encodeURIComponent(invoiceId)}&context=DISPLAY`
          const recRes = await fetch(recUrl)
          if (recRes.ok) {
            const rec = await recRes.json()
            setReconcileResult({
              status: rec.status ?? "",
              delta: typeof rec.delta === "number" ? rec.delta : 0,
              expectedBalance: rec.expectedBalance,
              ledgerBalance: rec.ledgerBalance,
            })
          }
        } catch {
          // Silent catch for recon failures
        }
      }

      if (data.invoice?.business_id) {
        const { data: businessDetails } = await supabase
          .from("businesses")
          .select("address_country")
          .eq("id", data.invoice.business_id)
          .single()
        setBusinessCountry(businessDetails?.address_country || null)
      }

      setLoading(false)
    } catch (err: any) {
      console.error("Error loading invoice:", err)
      setError(err.message || "We couldn't load this invoice. Please refresh or check your connection.")
      setLoading(false)
    }
  }, [invoiceId, invoiceApiSuffix])

  useEffect(() => {
    if (invoiceId) {
      loadInvoice()
    }
  }, [invoiceId, loadInvoice])

  useEffect(() => {
    if (hasCheckedSendParam || !invoice || invoice.status !== "draft") return

    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search)
      if (searchParams.get("send") === "true") {
        setHasCheckedSendParam(true)
        setTimeout(() => {
          setShowSendModal(true)
          window.history.replaceState({}, "", window.location.pathname)
        }, 500)
      }
    }
  }, [invoice, hasCheckedSendParam])

  const handlePaymentAdded = () => {
    setShowPaymentModal(false)
    setToast({ message: "Payment added successfully!", type: "success" })
    loadInvoice()
  }

  const handlePaymentEdited = () => {
    setEditingPayment(null)
    setToast({ message: "Payment updated successfully!", type: "success" })
    loadInvoice()
  }

  const sendReceiptViaWhatsApp = (payment: Payment) => {
    if (!invoice || !invoice.customers) return

    const phone = invoice.customers.whatsapp_phone || invoice.customers.phone
    if (!phone) {
      setToast({ message: "Customer phone number not available", type: "info" })
      return
    }

    if (!payment.public_token) {
      setToast({ message: "Receipt link is not available. Cannot send via WhatsApp.", type: "error" })
      return
    }

    const receiptUrl = `${window.location.origin}/receipt-public/${payment.public_token}`
    const message = `Hello ${invoice.customers.name},

We've recorded a payment on Invoice ${invoice.invoice_number}.

View receipt:
${receiptUrl}

Thank you.`

    const result = buildWhatsAppLink(phone, message)
    if (!result.ok) {
      setToast({ message: result.error, type: "error" })
      return
    }
    window.open(result.whatsappUrl, "_blank", "noopener,noreferrer")
  }

  const currency = resolveCurrencyDisplay(invoice)

  const handleDeleteInvoice = () => {
    openConfirm({
      title: "Delete draft invoice",
      description: "Are you sure you want to delete this draft invoice? This cannot be undone.",
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/invoices/${invoiceId}${invoiceApiSuffix}`, { method: "DELETE" })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) {
            throw new Error(data.error || "Failed to delete invoice")
          }
          setToast({ message: "Invoice deleted", type: "success" })
          router.push("/service/invoices")
        } catch (err: any) {
          setToast({ message: err.message || "Failed to delete invoice", type: "error" })
        }
      },
    })
  }

  const openPaymentReceipt = (payment: Payment, opts?: { savePdf?: boolean }) => {
    const tok = payment.public_token
    if (!tok) {
      setToast({ message: "Receipt link is not available for this payment yet.", type: "info" })
      return
    }
    const qs = opts?.savePdf ? "?savePdf=1" : ""
    window.open(
      `${window.location.origin}/receipt-public/${encodeURIComponent(tok)}${qs}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  // Format method helper for payment history
  const formatMethod = (method: string) => {
    const methods: Record<string, string> = {
      cash: "Cash",
      bank: "Bank Transfer",
      momo: "Mobile Money",
      card: "Card Payment",
      cheque: "Cheque",
      paystack: "Paystack",
      customer_credit: "Customer Credit",
      other: "Other",
    }
    return methods[method] || method
  }

  if (loading) {
    return (
      <Wrapper>
        <div className="p-8 flex items-center justify-center min-h-[50vh]">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-mj-slate-900"></div>
            <p className="text-mj-slate-500 font-medium animate-pulse">Loading Invoice...</p>
          </div>
        </div>
      </Wrapper>
    )
  }

  if (error || !invoice) {
    return (
      <Wrapper>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
          <div className="max-w-xl mx-auto bg-white dark:bg-gray-800 border border-red-100 dark:border-red-900 rounded-lg shadow-sm p-8 text-center">
            <div className="w-12 h-12 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Unable to Load Invoice
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-6 text-sm">
              {error || "We encountered an issue retrieving this invoice."}
            </p>
            <button
              onClick={() => router.push("/service/invoices")}
              className="bg-mj-slate-900 text-white px-6 py-2 rounded-md hover:bg-black font-medium transition-all text-sm"
            >
              Return to Invoices
            </button>
          </div>
        </div>
      </Wrapper>
    )
  }

  // Derived financials (invoice is defined: error/loading paths returned above)
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0)
  const totalCredits = creditNotes
    .filter((cn) => cn.status === "applied")
    .reduce((sum, cn) => sum + Number(cn.total), 0)
  const remainingBalance = Number(invoice.total || 0) - totalPaid - totalCredits

  const lineItemsGross = items.reduce((s, item) => s + Number(item.qty) * Number(item.unit_price), 0)
  const lineItemsDiscountTotal = items.reduce((s, item) => s + Number(item.discount_amount || 0), 0)
  const showLineDiscountSummary = lineItemsDiscountTotal > 0.005

  // Not useCallback: hooks must not run after conditional returns above.
  const handleDownloadInvoiceDocument = async () => {
    try {
      setDownloadDocLoading(true)
      await downloadInvoicePdfDocument(
        invoiceId,
        invoice.invoice_number,
        resolvedBusinessId
      )
    } catch (err: any) {
      setToast({
        message: err?.message || "Could not download invoice document.",
        type: "error",
      })
    } finally {
      setDownloadDocLoading(false)
    }
  }

  return (
    <Wrapper>
      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* Top Navigation */}
          <div className="mb-5 print-hide">
            <button
              onClick={() => router.back()}
              className="group inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <svg className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Invoices
            </button>
          </div>

          {/* Header — card layout, single-line title, fused actions */}
          <div className="mb-8 rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/40 print-hide">
            <div className="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 max-w-full overflow-x-auto sm:overflow-visible">
                    <h1 className="whitespace-nowrap text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
                      Invoice #{invoice.invoice_number || "Draft"}
                    </h1>
                  </div>
                  <StatusBadge status={invoice.status} className="shrink-0 px-2.5 py-0.5 text-xs font-medium" />
                </div>
                <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  <span className="text-slate-500 dark:text-slate-500">Issued to </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {invoice.customers?.name || "Unknown Customer"}
                  </span>
                  <span className="text-slate-500 dark:text-slate-500"> · </span>
                  {new Date(invoice.issue_date).toLocaleDateString("en-GH", { dateStyle: "long" })}
                  {invoice.sent_at && (
                    <>
                      <span className="text-slate-500 dark:text-slate-500"> · </span>
                      <span className="text-slate-600 dark:text-slate-400">
                        Sent{" "}
                        {new Date(invoice.sent_at).toLocaleDateString("en-GH", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </>
                  )}
                </p>
                <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                  Ref · {invoice.id.substring(0, 8)}…
                </p>
              </div>

              <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-center sm:justify-end">
                <div className="flex flex-1 flex-row flex-nowrap items-center gap-2 sm:flex-initial sm:justify-end">
                  {invoice.status === "draft" && (
                    <button
                      type="button"
                      onClick={() => router.push(`/service/invoices/${invoiceId}/edit`)}
                      className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPreviewModal(true)}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <svg className="h-4 w-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    Preview
                  </button>
                  {invoice.status !== "draft" && (
                    <button
                      type="button"
                      onClick={handleDownloadInvoiceDocument}
                      disabled={downloadDocLoading}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <svg className="h-4 w-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      {downloadDocLoading ? "…" : "Download"}
                    </button>
                  )}
                </div>

                <div className="flex w-full shrink-0 sm:w-auto">
                  {invoice.status === "draft" ? (
                    <div className="flex w-full rounded-xl border border-slate-200 shadow-sm dark:border-slate-600 sm:w-auto [&>div>button]:h-10 [&>div>button]:rounded-l-xl [&>div>button]:rounded-r-none [&>div>button]:border-0 [&>div>button]:border-r [&>div>button]:border-slate-200 dark:[&>div>button]:border-slate-600">
                      {/* No overflow-hidden: it clips SendMethodDropdown’s absolute menu; modal has no such wrapper so choices work there. */}
                      <SendMethodDropdown
                        value={sendMethod}
                        onChange={setSendMethod}
                        className="min-w-0 flex-1 sm:min-w-[10rem] sm:flex-initial"
                        showIssueAndDownloadOption
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setSendModalVariant("send")
                          setShowSendModal(true)
                        }}
                        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-r-xl rounded-l-none bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                      >
                        Send
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:w-auto sm:items-stretch">
                      {remainingBalance > 0.01 ? (
                        <button
                          type="button"
                          onClick={() => setShowPaymentModal(true)}
                          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-500 sm:w-auto"
                        >
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                          </svg>
                          Record payment
                        </button>
                      ) : (
                        <div className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-emerald-200/80 bg-emerald-50 px-4 text-sm font-medium text-emerald-800 select-none dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300 sm:w-auto">
                          Paid in full
                        </div>
                      )}
                      {invoice.invoice_number &&
                        !["draft", "void", "cancelled"].includes(String(invoice.status || "").toLowerCase()) && (
                          <button
                            type="button"
                            onClick={() => {
                              setSendModalVariant("resend")
                              setShowSendModal(true)
                            }}
                            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 sm:w-auto"
                          >
                            Resend
                          </button>
                        )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Financial Position Bar — dashboard style (formatMoney, sans-serif) */}
          <div className="mb-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:gap-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-gray-800">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Total</span>
              <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-gray-100">
                {formatMoney(Number(invoice.total), invoice.currency_code)}
              </span>
            </div>
            <div className="hidden sm:block text-slate-300 text-2xl font-light select-none">−</div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider mb-1">Paid</span>
              <span className="text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                +{formatMoney(Number(totalPaid), invoice.currency_code)}
              </span>
            </div>
            {totalCredits > 0 && (
              <>
                <div className="hidden sm:block text-slate-300 text-2xl font-light select-none">−</div>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold text-amber-600 tracking-wider mb-1">Credits</span>
                  <span className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-500">
                    +{formatMoney(Number(totalCredits), invoice.currency_code)}
                  </span>
                </div>
              </>
            )}
            <div className="hidden sm:block text-slate-300 text-2xl font-light select-none">=</div>
            <div className="flex flex-col sm:border-l-2 border-slate-100 dark:border-slate-700 sm:pl-8 ml-auto sm:ml-0 pt-4 sm:pt-0 border-t sm:border-t-0 w-full sm:w-auto mt-2 sm:mt-0">
              <span className={`text-[10px] uppercase font-bold tracking-wider mb-1 ${remainingBalance > 0.01 ? "text-rose-600" : "text-emerald-600"}`}>
                {remainingBalance > 0.01 ? "Amount Due" : "Balance"}
              </span>
              <span className={`text-2xl font-semibold tabular-nums ${remainingBalance > 0.01 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
                {formatMoney(Number(remainingBalance), invoice.currency_code)}
              </span>
            </div>
          </div>

          {/* Reconciliation Warning (if any) */}
          {(reconcileResult?.status === "WARN" || reconcileResult?.status === "FAIL") && (
            <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <div>
                <p className="font-semibold">Ledger Discrepancy Detected</p>
                <div className="mt-1 opacity-90">
                  The displayed balance does not match the accounting ledger. <br />
                  Ledger: {formatMoney(Number(reconcileResult.ledgerBalance), invoice.currency_code)} vs Display: {formatMoney(Number(reconcileResult.expectedBalance), invoice.currency_code)}
                </div>
              </div>
            </div>
          )}

          {/* Main Content Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* Left Column: Invoice Document */}
            <div className="lg:col-span-2 space-y-8">

              {/* Line Items Table */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-gray-200 uppercase tracking-wide">Line Items</h3>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-gray-900/50 text-slate-500">
                      <tr>
                        <th className="px-6 py-3 text-left font-medium w-2/5">Description</th>
                        <th className="px-6 py-3 text-center font-medium">Qty</th>
                        <th className="px-6 py-3 text-right font-medium">Unit Price</th>
                        <th className="px-6 py-3 text-right font-medium">Discount</th>
                        <th className="px-6 py-3 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                      {items.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-gray-700/30 transition-colors">
                          <td className="px-6 py-4 text-slate-900 dark:text-gray-100">
                            <div className="font-medium">{(item as any).products_services?.name || item.description || "Item"}</div>
                            {(item as any).products_services?.name && item.description && item.description !== (item as any).products_services?.name && (
                              <div className="text-slate-500 text-xs mt-0.5">{item.description}</div>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center text-slate-600 dark:text-gray-400 tabular-nums">{item.qty}</td>
                          <td className="px-6 py-4 text-right text-slate-600 dark:text-gray-400">
                            {formatMoney(Number(item.unit_price), invoice.currency_code)}
                          </td>
                          <td className="px-6 py-4 text-right text-slate-600 dark:text-gray-400 tabular-nums">
                            {Number(item.discount_amount) > 0
                              ? formatMoney(Number(item.discount_amount), invoice.currency_code)
                              : "—"}
                          </td>
                          <td className="px-6 py-4 text-right font-medium text-slate-900 dark:text-white">
                            {formatMoney(
                              item.line_subtotal != null
                                ? Number(item.line_subtotal)
                                : Number(item.qty) * Number(item.unit_price) - Number(item.discount_amount || 0),
                              invoice.currency_code
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 dark:bg-slate-800/80">
                      {/* Tax Breakdown Rows */}
                      {(() => {
                        if (!invoice.apply_taxes) return null;

                        let displayLines = getTaxLinesForDisplay(invoice.tax_lines)
                        // Fallback support (legacy)
                        if (displayLines.length === 0 && !invoice.tax_lines) {
                          const legacy = { NHIL: invoice.nhil, GETFUND: invoice.getfund, VAT: invoice.vat }
                          displayLines = Object.entries(legacy)
                            .filter(([_, v]) => Number(v) > 0)
                            .map(([code, amount]) => ({ code, amount: Number(amount) }))
                        }

                        const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
                        const isGhana = countryCode === "GH"
                        // Filter VAT only for non-Ghana regions if needed
                        const toShow = isGhana ? displayLines : displayLines.filter(l => l.code === 'VAT')

                        return (
                          <>
                            {showLineDiscountSummary && (
                              <>
                                <tr className="border-t border-slate-200 dark:border-slate-700">
                                  <td colSpan={4} className="px-6 pt-4 text-right text-slate-500 text-xs uppercase font-medium">
                                    Gross amount
                                  </td>
                                  <td className="px-6 pt-4 text-right font-medium text-slate-900 dark:text-white tabular-nums">
                                    {formatMoney(lineItemsGross, invoice.currency_code)}
                                  </td>
                                </tr>
                                <tr>
                                  <td colSpan={4} className="px-6 py-1 text-right text-slate-500 text-xs uppercase font-medium">
                                    Discount
                                  </td>
                                  <td className="px-6 py-1 text-right text-sm font-medium text-rose-600 dark:text-rose-400 tabular-nums">
                                    −{formatMoney(lineItemsDiscountTotal, invoice.currency_code)}
                                  </td>
                                </tr>
                              </>
                            )}
                            <tr className={showLineDiscountSummary ? "" : "border-t border-slate-200 dark:border-slate-700"}>
                              <td colSpan={4} className="px-6 pt-4 text-right text-slate-500 text-xs uppercase font-medium">
                                {showLineDiscountSummary ? "Subtotal (excl. tax)" : "Subtotal"}
                              </td>
                              <td className="px-6 pt-4 text-right font-medium text-slate-900 dark:text-white">
                                {formatMoney(Number(invoice.subtotal ?? invoice.total), invoice.currency_code)}
                              </td>
                            </tr>
                            {toShow.map(tax => (
                              <tr key={tax.code}>
                                <td colSpan={4} className="px-6 py-1 text-right text-slate-400 text-xs uppercase font-medium">{tax.code}</td>
                                <td className="px-6 py-1 text-right text-slate-600 dark:text-slate-400 text-sm">
                                  {formatMoney(Number(tax.amount), invoice.currency_code)}
                                </td>
                              </tr>
                            ))}
                            <tr>
                              <td colSpan={4} className="px-6 py-4 text-right text-slate-900 dark:text-white font-bold text-sm uppercase">Total</td>
                              <td className="px-6 py-4 text-right text-lg font-bold border-t border-slate-200 dark:border-slate-700 mt-2">
                                {formatMoney(Number(invoice.total), invoice.currency_code)}
                              </td>
                            </tr>
                          </>
                        )
                      })()}

                      {/* If No Taxes, just total */}
                      {!invoice.apply_taxes && (
                        <>
                          {showLineDiscountSummary && (
                            <>
                              <tr className="border-t border-slate-200 dark:border-slate-700">
                                <td colSpan={4} className="px-6 pt-4 text-right text-slate-500 text-xs uppercase font-medium">
                                  Gross amount
                                </td>
                                <td className="px-6 pt-4 text-right font-medium text-slate-900 dark:text-white tabular-nums">
                                  {formatMoney(lineItemsGross, invoice.currency_code)}
                                </td>
                              </tr>
                              <tr>
                                <td colSpan={4} className="px-6 py-1 text-right text-slate-500 text-xs uppercase font-medium">
                                  Discount
                                </td>
                                <td className="px-6 py-1 text-right text-sm font-medium text-rose-600 dark:text-rose-400 tabular-nums">
                                  −{formatMoney(lineItemsDiscountTotal, invoice.currency_code)}
                                </td>
                              </tr>
                            </>
                          )}
                          <tr className="border-t border-slate-200 dark:border-slate-700">
                            <td colSpan={4} className="px-6 py-4 text-right text-slate-900 dark:text-white font-bold uppercase">Total</td>
                            <td className="px-6 py-4 text-right font-bold text-lg">
                              {formatMoney(Number(invoice.total), invoice.currency_code)}
                            </td>
                          </tr>
                        </>
                      )}
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Notes */}
              {invoice.notes && (
                <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-6 border border-slate-100 dark:border-slate-800">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Notes</h4>
                  <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
            </div>

            {/* Right Column: Metadata & History */}
            <div className="space-y-6">

              {/* Quick Details Card */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Invoice Details</h3>
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Issue Date</dt>
                    <dd className="font-medium text-slate-900 dark:text-white tabular-nums">{new Date(invoice.issue_date).toLocaleDateString("en-GH")}</dd>
                  </div>
                  {invoice.due_date && (
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Due Date</dt>
                      <dd className="font-medium text-slate-900 dark:text-white tabular-nums">{new Date(invoice.due_date).toLocaleDateString("en-GH")}</dd>
                    </div>
                  )}
                  {invoice.payment_terms && (
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                      <dt className="shrink-0 text-slate-500">Payment terms</dt>
                      <dd className="min-w-0 break-words text-sm font-medium text-slate-900 dark:text-white sm:max-w-[min(100%,18rem)] sm:text-right">
                        {invoice.payment_terms}
                      </dd>
                    </div>
                  )}
                  {invoice.source_type === "order" && invoice.orders && (
                    <div className="flex justify-between border-t border-slate-100 pt-3 mt-3">
                      <dt className="text-slate-500">Source Order</dt>
                      <dd className="font-medium text-blue-600">{invoice.orders.order_number || "View Order"}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Actions Panel (Secondary) */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 p-5">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Management</h3>
                <div className="space-y-2">
                  <button
                    onClick={() => router.push(`/service/credit-notes/create?invoiceId=${invoice.id}`)}
                    className="w-full text-left px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 rounded transition-colors"
                  >
                    Issue Credit Note
                  </button>
                  {invoice.status === "draft" && (
                    <button
                      type="button"
                      onClick={handleDeleteInvoice}
                      className="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded transition-colors"
                    >
                      Delete Invoice
                    </button>
                  )}
                </div>
              </div>

              {/* Payment History List */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="bg-slate-50 dark:bg-slate-800/50 px-5 py-3 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Payment History</h3>
                  {/* Only show 'Add' if there's balance */}
                  {remainingBalance > 0.01 && invoice.status !== 'draft' && (
                    <button
                      onClick={() => setShowPaymentModal(true)}
                      className="text-xs text-blue-600 font-medium hover:underline"
                    >
                      + Record
                    </button>
                  )}
                </div>

                {payments.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">
                    No payments recorded yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {payments.map(payment => (
                      <li key={payment.id} className="p-4 hover:bg-slate-50 dark:hover:bg-gray-700/20 transition-colors">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            +{formatMoney(Number(payment.amount), invoice.currency_code)}
                          </span>
                          <span className="text-xs text-slate-400 tabular-nums">
                            {new Date(payment.date).toLocaleDateString("en-GH", { year: '2-digit', month: '2-digit', day: '2-digit' })}
                          </span>
                        </div>
                        <div className="flex justify-between items-end">
                          <div className="text-xs text-slate-500">
                            {formatMethod(payment.method)}
                            {payment.reference && <span className="ml-1 opacity-70">#{payment.reference}</span>}
                          </div>
                          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
                            <button
                              type="button"
                              onClick={() => openPaymentReceipt(payment)}
                              disabled={!payment.public_token}
                              className="text-[10px] uppercase font-bold text-slate-700 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={payment.public_token ? "Open receipt in a new tab" : "Receipt link not available"}
                            >
                              View receipt
                            </button>
                            <button
                              type="button"
                              onClick={() => openPaymentReceipt(payment, { savePdf: true })}
                              disabled={!payment.public_token}
                              className="text-[10px] uppercase font-bold text-slate-700 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed"
                              title={
                                payment.public_token
                                  ? "Opens receipt then print dialog — choose Save as PDF"
                                  : "Receipt link not available"
                              }
                            >
                              Download
                            </button>
                            <button
                              type="button"
                              onClick={() => sendReceiptViaWhatsApp(payment)}
                              className="text-[10px] uppercase font-bold text-emerald-700 hover:text-emerald-800"
                              title="Send receipt link via WhatsApp"
                            >
                              WhatsApp
                            </button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showPaymentModal && invoice.status !== "draft" && (
        <AddPaymentModal
          invoiceId={invoiceId}
          invoiceNumber={invoice.invoice_number}
          customerName={invoice.customers?.name || "Customer"}
          invoiceTotal={Number(invoice.total)}
          totalPaid={totalPaid}
          creditsApplied={totalCredits}
          currencySymbol={currency}
          businessCountry={businessCountry}
          invoiceFxRate={invoice.fx_rate ?? null}
          invoiceCurrencyCode={invoice.currency_code ?? null}
          homeCurrencyCode={invoice.home_currency_code ?? null}
          invoiceWhtApplicable={invoice.wht_receivable_applicable ?? false}
          invoiceWhtAmount={Number(invoice.wht_receivable_amount ?? 0)}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentAdded}
        />
      )}

      {editingPayment && invoice.status !== "draft" && (
        <EditPaymentModal
          payment={editingPayment}
          invoiceId={invoiceId}
          onClose={() => setEditingPayment(null)}
          onSuccess={handlePaymentEdited}
        />
      )}

      {showPreviewModal && invoice && (
        <InvoicePreviewModal
          invoiceId={invoiceId}
          invoiceNumber={invoice.invoice_number}
          businessId={resolvedBusinessId}
          invoiceStatus={invoice.status}
          isOpen={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
        />
      )}

      {showSendModal && invoice && (
        <SendInvoiceModal
          businessId={invoice.business_id}
          variant={sendModalVariant}
          invoice={{
            ...invoice,
            public_token: invoice.public_token || "",
            customers: invoice.customers ? {
              ...invoice.customers,
              email: invoice.customers.email || undefined,
              phone: invoice.customers.phone || undefined,
              whatsapp_phone: invoice.customers.whatsapp_phone || undefined,
            } : null,
          }}
          invoiceId={invoiceId}
          defaultMethod={sendMethod}
          onClose={() => setShowSendModal(false)}
          onSuccess={(opts) => {
            setShowSendModal(false)
            setToast({
              message: opts?.issuedViaDownload
                ? "Invoice issued — document downloaded."
                : sendModalVariant === "resend"
                  ? "Invoice resent successfully."
                  : "Invoice sent successfully!",
              type: "success",
            })
            setTimeout(() => {
              loadInvoice()
            }, 500)
          }}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </Wrapper>
  )
}

function EditPaymentModal({
  payment,
  invoiceId,
  onClose,
  onSuccess,
}: {
  payment: Payment
  invoiceId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    amount: payment.amount.toString(),
    date: payment.date,
    method: payment.method,
    reference: payment.reference || "",
    notes: payment.notes || "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = Number(formData.amount)
    if (!amount || amount <= 0) {
      setError("Amount must be greater than 0")
      return
    }

    try {
      setLoading(true)
      const response = await fetch(`/api/payments/${payment.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error("Failed to update payment")
      }
      onSuccess()
    } catch (err: any) {
      setError(err.message || "Failed to update payment")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold mb-4">Edit Payment</h2>
        {error && <div className="bg-red-50 text-red-600 px-3 py-2 rounded mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Amount</label>
            <input
              type="number" step="0.01"
              value={formData.amount}
              onChange={e => setFormData({ ...formData, amount: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          {/* Simplified for brevity - full fields would go here */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}
