"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { formatMoney } from "@/lib/money"
import { useToast } from "@/components/ui/ToastProvider"
import {
  ManualInvoicePaymentDetails,
  type InvoiceManualPaymentDetailsProps,
} from "@/components/invoices/ManualInvoicePaymentDetails"

type Invoice = {
  id: string
  invoice_number: string
  total: number
  currency_code: string
  currency_symbol: string
  status: string
  public_token?: string | null
  customers: { name: string } | null
  businesses?: { id: string; address_country: string | null } | null
}

type InvoicePaymentRow = {
  id: string
  amount: number
  date: string
  method: string
  notes?: string | null
  reference?: string | null
  public_token?: string | null
}

/** Customer-facing manual wallet instructions (public invoice API). */
type ManualWalletPayment = {
  provider_type: "manual_wallet"
  network: string | null
  account_name: string | null
  wallet_number: string | null
  instructions: string | null
  display_label: string | null
}

type PaymentStatus =
  | "idle"
  | "initiating"
  | "pending"      // waiting for phone approval / Hubtel return
  | "otp"          // Vodafone OTP step
  | "success"
  | "failed"
  | "pending_verification"

const PAY_LINK_UNAVAILABLE =
  "This payment link is no longer available. Please use the invoice link sent by the business."

export default function PayInvoicePage() {
  const params  = useParams()
  const router  = useRouter()
  const searchParams = useSearchParams()
  const toast   = useToast()
  const invoiceId = (params?.invoiceId as string) || ""
  const publicToken = (searchParams.get("token") ?? "").trim()

  const [invoice,          setInvoice]          = useState<Invoice | null>(null)
  const [payments,         setPayments]          = useState<InvoicePaymentRow[]>([])
  const [loading,          setLoading]           = useState(false)
  const [linkUnavailable, setLinkUnavailable]   = useState(false)
  const [error,            setError]             = useState("")
  const [paymentRef,       setPaymentRef]        = useState("")
  const [paymentStatus,    setPaymentStatus]     = useState<PaymentStatus>("idle")
  const [displayText,      setDisplayText]       = useState("")
  const [qrCodeUrl,        setQrCodeUrl]         = useState("")
  const [manualWalletPayment, setManualWalletPayment] = useState<ManualWalletPayment | null>(null)
  const [paymentFlow, setPaymentFlow] = useState<"manual_wallet" | "hubtel_checkout">("manual_wallet")
  const [tenantOnlinePay, setTenantOnlinePay] = useState(false)
  const [invoiceSettingsPublic, setInvoiceSettingsPublic] = useState<InvoiceManualPaymentDetailsProps | null>(null)
  const [hubtelClientReference, setHubtelClientReference] = useState("")
  /** Paystack MoMo: token returned from /charge (same row as poll/verify). MTN: filled from refreshed `payments` after success. */
  const [chargePublicToken, setChargePublicToken] = useState<string | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // ── Load invoice (requires ?token= matching public_token — never ID alone) ───
  useEffect(() => {
    if (!invoiceId) {
      setLoading(false)
      return
    }
    if (!publicToken) {
      setLoading(false)
      setInvoice(null)
      setLinkUnavailable(false)
      return
    }
    void loadInvoice()
  }, [invoiceId, publicToken])

  // ── Poll for payment confirmation ─────────────────────────────────────────
  useEffect(() => {
    if (paymentStatus === "pending" && paymentRef) {
      pollRef.current = setInterval(pollStatus, 3000)
      return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }
  }, [paymentStatus, paymentRef])

  // ── Hubtel return from checkout ───────────────────────────────────────────
  useEffect(() => {
    if (!invoiceId || !publicToken) return
    const hubtelReturn = searchParams.get("hubtel_return") === "1"
    const hubtelCancelled = searchParams.get("hubtel_cancelled") === "1"
    const refFromQuery = (searchParams.get("clientReference") ?? "").trim()
    if (hubtelCancelled) {
      setError("Payment was cancelled on Hubtel.")
      return
    }
    if (hubtelReturn && refFromQuery) {
      setHubtelClientReference(refFromQuery)
      setPaymentRef(refFromQuery)
      setPaymentStatus("pending")
      setDisplayText("Payment returned. Checking status…")
    }
  }, [invoiceId, publicToken, searchParams])

  const loadInvoice = async () => {
    if (!invoiceId || !publicToken) return
    try {
      setLoading(true)
      setError("")
      setLinkUnavailable(false)
      const res = await fetch(
        `/api/public/invoice/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(publicToken)}`
      )
      if (!res.ok) {
        setInvoice(null)
        setPayments([])
        setLinkUnavailable(true)
        return
      }
      const data = await res.json()
      if (!data.invoice) {
        setInvoice(null)
        setPayments([])
        setLinkUnavailable(true)
        return
      }

      if (data.tenant_invoice_online_payments_enabled !== true) {
        router.replace(`/invoice-public/${encodeURIComponent(publicToken)}`)
        return
      }

      setInvoice(data.invoice)
      setPayments((data.payments || []) as InvoicePaymentRow[])
      setManualWalletPayment(data.manual_wallet_payment ?? null)
      setPaymentFlow(
        data.invoice_payment_flow === "hubtel_checkout" ? "hubtel_checkout" : "manual_wallet"
      )
      setTenantOnlinePay(data.tenant_invoice_online_payments_enabled === true)
      setInvoiceSettingsPublic(data.invoice_settings_public ?? null)
      const origin = window.location.origin
      const payUrl = `${origin}/pay/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(publicToken)}`
      setQrCodeUrl(
        `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payUrl)}`
      )
    } catch {
      setInvoice(null)
      setPayments([])
      setLinkUnavailable(true)
    } finally {
      setLoading(false)
    }
  }

  const pollStatus = async () => {
    if (!paymentRef) return
    try {
      if (paymentFlow === "hubtel_checkout" || paymentRef.startsWith("FZHB")) {
        const res = await fetch(
          `/api/payments/hubtel/tenant/invoice/status?clientReference=${encodeURIComponent(paymentRef)}&invoice_id=${encodeURIComponent(invoiceId)}&token=${encodeURIComponent(publicToken)}`
        )
        const data = await res.json()
        if (data.success && data.status === "paid") {
          if (pollRef.current) clearInterval(pollRef.current)
          setPaymentStatus("success")
          setTimeout(loadInvoice, 1000)
        } else if (data.success && data.status === "verification_unavailable") {
          if (pollRef.current) clearInterval(pollRef.current)
          setPaymentStatus("pending_verification")
          setDisplayText(
            data.message ||
              "Your payment is being verified. We will update this invoice once confirmed."
          )
        } else if (data.success && (data.status === "failed" || data.status === "refunded")) {
          if (pollRef.current) clearInterval(pollRef.current)
          setPaymentStatus("failed")
          setError(data.message || "Payment was not completed")
        }
        return
      }

      if (paymentRef.startsWith("finza-mtn-")) {
        const res = await fetch(
          `/api/payments/momo/tenant/invoice/status?reference=${encodeURIComponent(paymentRef)}&invoice_id=${encodeURIComponent(invoiceId)}`
        )
        const data = await res.json()
        if (data.success && data.status === "success") {
          if (pollRef.current) clearInterval(pollRef.current)
          setPaymentStatus("success")
          setTimeout(loadInvoice, 1000)
        } else if (data.success && data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current)
          setPaymentStatus("failed")
          setChargePublicToken(null)
          setError(data.message || "Payment was not completed")
        }
        return
      }

      const res = await fetch(`/api/payments/paystack/verify?reference=${paymentRef}`)
      if (res.status === 403) {
        if (pollRef.current) clearInterval(pollRef.current)
        setPaymentStatus("failed")
        setChargePublicToken(null)
        setError("Online invoice payment is not available for this invoice.")
        return
      }
      const data = await res.json()
      if (data.status === "success") {
        if (pollRef.current) clearInterval(pollRef.current)
        setPaymentStatus("success")
        setTimeout(loadInvoice, 1000)
      } else if (data.status === "failed" || data.status === "abandoned") {
        if (pollRef.current) clearInterval(pollRef.current)
        setPaymentStatus("failed")
        setChargePublicToken(null)
        setError(data.gateway_response || "Payment was not completed")
      }
    } catch {}
  }

  const handlePayHubtel = async () => {
    if (!invoiceId || !publicToken) return
    setError("")
    setChargePublicToken(null)
    setPaymentStatus("initiating")
    try {
      const res = await fetch("/api/payments/hubtel/tenant/invoice/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: invoiceId,
          public_token: publicToken,
          payee_name: invoice?.customers?.name ?? undefined,
        }),
      })
      const data = await res.json()
      if (!data.success || !data.checkoutUrl) {
        throw new Error(data.error || "Failed to open Hubtel checkout")
      }
      setHubtelClientReference(data.clientReference ?? "")
      setPaymentRef(data.clientReference ?? "")
      window.location.href = data.checkoutUrl
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Hubtel checkout failed")
      setPaymentStatus("idle")
    }
  }

  // ── Loading / error screens ───────────────────────────────────────────────
  if (loading && publicToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading…</p>
        </div>
      </div>
    )
  }

  if (!publicToken || linkUnavailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <p className="text-gray-800 leading-relaxed">{PAY_LINK_UNAVAILABLE}</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Go home
          </button>
        </div>
      </div>
    )
  }

  if (!invoice) return null

  const totalPaid      = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const remaining      = Number(invoice.total) - totalPaid
  const receiptPublicToken =
    chargePublicToken ||
    (paymentRef
      ? payments.find((p) => p.reference && paymentRef && p.reference === paymentRef)?.public_token
      : null) ||
    (invoice.status === "paid" && payments.length > 0
      ? [...payments].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]?.public_token
      : null) ||
    null

  const openReceipt = (opts?: { savePdf?: boolean }) => {
    if (!receiptPublicToken) return
    const qs = opts?.savePdf ? "?savePdf=1" : ""
    window.open(
      `${window.location.origin}/receipt-public/${encodeURIComponent(receiptPublicToken)}${qs}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">
            {tenantOnlinePay ? "Pay invoice" : "Invoice"}
          </h1>
          <p className="text-gray-500 text-sm">#{invoice.invoice_number}</p>
        </div>

        {/* Invoice summary */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-5">
          <div className="flex items-center justify-between pb-4 border-b border-gray-100">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Customer</p>
              <p className="font-semibold text-gray-900">{invoice.customers?.name || "—"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Total</p>
              <p className="text-2xl font-bold text-gray-900">{formatMoney(invoice.total, invoice.currency_code)}</p>
            </div>
          </div>

          {remaining > 0 && remaining < Number(invoice.total) && (
            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg px-4 py-2 text-sm text-orange-800">
              Remaining: <strong>{formatMoney(remaining, invoice.currency_code)}</strong>
            </div>
          )}

          {invoice.status === "paid" && (
            <div className="mt-4 space-y-2">
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-800 font-medium">
                ✓ This invoice has been paid
              </div>
              {paymentStatus !== "success" && receiptPublicToken && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => openReceipt()}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-green-700 bg-white px-4 py-2.5 text-sm font-semibold text-green-900 shadow-sm hover:bg-green-50 transition-colors"
                  >
                    View receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => openReceipt({ savePdf: true })}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 transition-colors"
                  >
                    Download receipt
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status banners */}
        {paymentStatus === "success" && (
          <div className="bg-green-50 border-l-4 border-green-400 text-green-800 p-4 rounded-lg mb-5 flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Payment Successful!</p>
              <p className="text-sm mt-0.5">
                {receiptPublicToken
                  ? "You can open your payment receipt below."
                  : "Your receipt will appear here once payment details have synced — refresh the page in a moment if needed."}
              </p>
              {receiptPublicToken && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => openReceipt()}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-green-700 bg-white px-4 py-2.5 text-sm font-semibold text-green-900 shadow-sm hover:bg-green-100 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    View receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => openReceipt({ savePdf: true })}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 transition-colors"
                  >
                    Download receipt
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {paymentStatus === "pending_verification" && (
          <div className="bg-amber-50 border-l-4 border-amber-400 text-amber-900 p-4 rounded-lg mb-5 flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold">Payment pending verification</p>
              <p className="text-sm mt-0.5">
                {displayText ||
                  "Your payment is being verified. We will update this invoice once confirmed."}
              </p>
            </div>
          </div>
        )}

        {paymentStatus === "pending" && (
          <div className="bg-blue-50 border-l-4 border-blue-400 text-blue-800 p-4 rounded-lg mb-5 flex items-start gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-semibold">Waiting for Approval…</p>
              <p className="text-sm mt-0.5">
                {displayText || "A payment prompt has been sent to your phone. Please approve it to complete payment."}
              </p>
            </div>
          </div>
        )}

        {paymentStatus === "failed" && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-800 p-4 rounded-lg mb-5">
            <p className="font-semibold">Payment Failed</p>
            <p className="text-sm mt-0.5">{error || "Please try again or use a different provider."}</p>
            <button
              onClick={() => {
                setPaymentStatus("idle")
                setError("")
                setChargePublicToken(null)
              }}
              className="mt-2 text-sm underline font-medium"
            >
              Try again
            </button>
          </div>
        )}

        {error && paymentStatus !== "failed" && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-800 p-4 rounded-lg mb-5 text-sm">
            {error}
          </div>
        )}

        {/* Payment form — only when unpaid */}
        {invoice.status !== "paid" && remaining > 0 && paymentStatus !== "success" && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-5">

            {!tenantOnlinePay ? (
              <div className="space-y-4">
                <ManualInvoicePaymentDetails
                  details={invoiceSettingsPublic}
                  manualWallet={manualWalletPayment}
                  showPayFallbackBanner
                  payFallbackSubtitle="Online payment is currently unavailable for this invoice. Please use the payment details provided by the business."
                />
                {invoice.public_token && (
                  <>
                    <p className="text-xs text-center text-gray-500">
                      For a printable copy or PDF, open the full invoice from the business link.
                    </p>
                    <a
                      href={`/invoice-public/${encodeURIComponent(invoice.public_token)}`}
                      className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      View invoice
                    </a>
                  </>
                )}
              </div>
            ) : paymentFlow === "hubtel_checkout" ? (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Pay with Hubtel</h2>
                <p className="text-sm text-gray-600 mb-4">
                  You will be redirected to Hubtel&apos;s secure checkout to pay this invoice. We confirm payment
                  only after Hubtel verifies the transaction.
                </p>
                <ManualInvoicePaymentDetails
                  details={invoiceSettingsPublic}
                  manualWallet={null}
                  className="mb-4"
                />
                <button
                  type="button"
                  onClick={handlePayHubtel}
                  disabled={paymentStatus === "initiating"}
                  className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 text-white py-4 rounded-xl font-bold text-lg shadow-md hover:from-indigo-700 hover:to-violet-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                >
                  {paymentStatus === "initiating" ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      Opening Hubtel checkout…
                    </>
                  ) : (
                    <>Pay {formatMoney(remaining, invoice.currency_code)} with Hubtel</>
                  )}
                </button>
                {hubtelClientReference && paymentStatus === "pending" && (
                  <p className="text-xs text-gray-500 mt-3 text-center">Reference: {hubtelClientReference}</p>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900 mb-1">Manual payment</h2>
                <p className="text-sm text-gray-600">
                  Use the bank or MoMo details below. This invoice updates when the business records your payment — there is
                  no automatic online confirmation for manual transfers.
                </p>
                <ManualInvoicePaymentDetails
                  details={invoiceSettingsPublic}
                  manualWallet={manualWalletPayment}
                />
                <p className="text-xs text-gray-500">
                  Amount due: <strong>{formatMoney(remaining, invoice.currency_code)}</strong>
                </p>
              </div>
            )}
          </div>
        )}

        {/* QR / share — pay-page URL includes token; invoice-public is the generic customer-facing link */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <h3 className="text-base font-semibold text-gray-900 mb-3">
            {tenantOnlinePay ? "Share payment link" : "View invoice"}
          </h3>
          {tenantOnlinePay ? (
            <p className="text-xs text-gray-500 mb-3 max-w-sm mx-auto">
              Link opens this pay page and includes the security token. For email or WhatsApp, prefer sharing the{" "}
              public invoice link below (same page customers get from Finza invoice sends).
            </p>
          ) : null}
          {qrCodeUrl && (
            <div className="flex justify-center mb-3">
              <img src={qrCodeUrl} alt="QR Code" className="border border-gray-200 rounded-lg p-2" width={160} height={160} />
            </div>
          )}
          {tenantOnlinePay ? (
            <button
              type="button"
              onClick={() => {
                const u = `${window.location.origin}/pay/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(publicToken)}`
                navigator.clipboard.writeText(u)
                toast.showToast("Payment link copied!", "success")
              }}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Copy payment link
            </button>
          ) : invoice.public_token ? (
            <button
              type="button"
              onClick={() => {
                const u = `${window.location.origin}/invoice-public/${encodeURIComponent(invoice.public_token!)}`
                navigator.clipboard.writeText(u)
                toast.showToast("Invoice link copied!", "success")
              }}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Copy invoice link
            </button>
          ) : (
            <p className="text-sm text-gray-500">Ask the business for their invoice link if you need a printable copy.</p>
          )}
        </div>

      </div>
    </div>
  )
}
