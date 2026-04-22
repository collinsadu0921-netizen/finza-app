"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { formatMoney } from "@/lib/money"
import { useToast } from "@/components/ui/ToastProvider"

type Invoice = {
  id: string
  invoice_number: string
  total: number
  currency_code: string
  currency_symbol: string
  status: string
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
  | "pending"      // waiting for phone approval
  | "otp"          // Vodafone OTP step
  | "success"
  | "failed"

const PROVIDERS = [
  { id: "mtn",        label: "MTN MoMo",      color: "yellow",  icon: "📱" },
  { id: "vodafone",   label: "Vodafone Cash",  color: "red",     icon: "📱" },
  { id: "airteltigo", label: "AirtelTigo",     color: "blue",    icon: "📱" },
] as const

type ProviderId = typeof PROVIDERS[number]["id"]

const PROVIDER_COLORS: Record<string, string> = {
  yellow: "border-yellow-500 bg-yellow-50",
  red:    "border-red-500 bg-red-50",
  blue:   "border-blue-500 bg-blue-50",
}

export default function PayInvoicePage() {
  const params  = useParams()
  const router  = useRouter()
  const toast   = useToast()
  const invoiceId = (params?.invoiceId as string) || ""

  const [invoice,          setInvoice]          = useState<Invoice | null>(null)
  const [payments,         setPayments]          = useState<InvoicePaymentRow[]>([])
  const [loading,          setLoading]           = useState(true)
  const [error,            setError]             = useState("")
  const [selectedProvider, setSelectedProvider]  = useState<ProviderId | null>(null)
  const [phone,            setPhone]             = useState("")
  const [otp,              setOtp]               = useState("")
  const [paymentRef,       setPaymentRef]        = useState("")
  const [paymentStatus,    setPaymentStatus]     = useState<PaymentStatus>("idle")
  const [displayText,      setDisplayText]       = useState("")
  const [qrCodeUrl,        setQrCodeUrl]         = useState("")
  const [businessCountry,  setBusinessCountry]   = useState<string | null>(null)
  const [manualWalletPayment, setManualWalletPayment] = useState<ManualWalletPayment | null>(null)
  const [paymentFlow, setPaymentFlow] = useState<"manual_wallet" | "mtn_momo_direct" | "paystack_momo">("paystack_momo")
  /** Paystack MoMo: token returned from /charge (same row as poll/verify). MTN: filled from refreshed `payments` after success. */
  const [chargePublicToken, setChargePublicToken] = useState<string | null>(null)
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // ── Load invoice ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (invoiceId) loadInvoice()
  }, [invoiceId])

  // ── Poll for payment confirmation ─────────────────────────────────────────
  useEffect(() => {
    if (paymentStatus === "pending" && paymentRef) {
      pollRef.current = setInterval(pollStatus, 3000)
      return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }
  }, [paymentStatus, paymentRef])

  const loadInvoice = async () => {
    try {
      setLoading(true); setError("")
      const res  = await fetch(`/api/public/invoice/${invoiceId}`)
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || "Invoice not found")
      }
      const data = await res.json()
      if (!data.invoice) throw new Error("Invoice data not available")
      setInvoice(data.invoice)
      setPayments((data.payments || []) as InvoicePaymentRow[])
      setManualWalletPayment(data.manual_wallet_payment ?? null)
      setPaymentFlow(data.invoice_payment_flow ?? "paystack_momo")
      const country = data.invoice.businesses?.address_country || null
      setBusinessCountry(country)
      const payUrl = `${window.location.origin}/pay/${invoiceId}`
      setQrCodeUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(payUrl)}`)
    } catch (err: any) {
      setError(err.message || "Failed to load invoice")
    } finally {
      setLoading(false)
    }
  }

  const pollStatus = async () => {
    if (!paymentRef) return
    try {
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

  const handlePayMtnDirect = async () => {
    if (phone.replace(/\D/g, "").length < 10) return
    setError("")
    setChargePublicToken(null)
    setPaymentStatus("initiating")
    try {
      const res = await fetch("/api/payments/momo/tenant/invoice/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: invoiceId, phone: phone.replace(/\s+/g, "") }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Failed to initiate MTN payment")
      setPaymentRef(data.reference)
      setDisplayText(data.display_text || "")
      setPaymentStatus("pending")
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Payment initiation failed")
      setChargePublicToken(null)
      setPaymentStatus("idle")
    }
  }

  // ── Initiate charge ───────────────────────────────────────────────────────
  const handlePay = async () => {
    if (!selectedProvider || phone.replace(/\D/g, "").length < 10) return
    setError("")
    setChargePublicToken(null)
    setPaymentStatus("initiating")
    try {
      const res  = await fetch("/api/payments/paystack/charge", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: invoiceId,
          provider: selectedProvider,
          phone: phone.replace(/\s+/g, ""),
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Failed to initiate payment")

      setPaymentRef(data.reference)
      setDisplayText(data.display_text || "")
      if (typeof data.public_token === "string" && data.public_token) {
        setChargePublicToken(data.public_token)
      }

      if (data.otp_required) {
        setPaymentStatus("otp")  // Vodafone — OTP step
      } else {
        setPaymentStatus("pending")  // MTN / AirtelTigo — phone push
      }
    } catch (err: any) {
      setError(err.message || "Payment initiation failed")
      setChargePublicToken(null)
      setPaymentStatus("idle")
    }
  }

  // ── Submit Vodafone OTP ───────────────────────────────────────────────────
  const handleSubmitOtp = async () => {
    if (!otp.trim()) return
    setError(""); setPaymentStatus("initiating")
    try {
      const res  = await fetch("/api/payments/paystack/submit-otp", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: otp.trim(), reference: paymentRef }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || "Invalid OTP")
      setPaymentStatus(data.status === "success" ? "success" : "pending")
      if (data.status === "success") setTimeout(loadInvoice, 1000)
    } catch (err: any) {
      setError(err.message)
      setPaymentStatus("otp")
    }
  }

  const formatPhone = (v: string) => {
    const d = v.replace(/\D/g, "")
    if (d.length <= 3)  return d
    if (d.length <= 6)  return `${d.slice(0,3)} ${d.slice(3)}`
    if (d.length <= 10) return `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6)}`
    return `${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6,10)}`
  }

  // ── Loading / error screens ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading invoice…</p>
        </div>
      </div>
    )
  }

  if (error && !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-white p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Invoice Not Found</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button onClick={() => router.push("/")} className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700">
            Go Home
          </button>
        </div>
      </div>
    )
  }

  if (!invoice) return null

  const totalPaid      = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const remaining      = Number(invoice.total) - totalPaid
  const countryCode    = normalizeCountry(businessCountry)
  const isGhana        = countryCode === "GH"

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
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Pay Invoice</h1>
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

            {manualWalletPayment ? (
              <div className="space-y-4">
                <h2 className="text-lg font-bold text-gray-900 mb-1">Pay manually</h2>
                <p className="text-sm text-gray-600">
                  Send your payment using the details below. This invoice will be updated after the business records your
                  payment — there is no automatic confirmation for manual transfers.
                </p>
                {manualWalletPayment.display_label && (
                  <p className="text-sm font-semibold text-gray-800">{manualWalletPayment.display_label}</p>
                )}
                <dl className="space-y-2 text-sm">
                  {manualWalletPayment.network && (
                    <div className="flex justify-between gap-4 border-b border-gray-100 pb-2">
                      <dt className="text-gray-500">Network</dt>
                      <dd className="font-medium text-gray-900 text-right">{manualWalletPayment.network}</dd>
                    </div>
                  )}
                  {manualWalletPayment.account_name && (
                    <div className="flex justify-between gap-4 border-b border-gray-100 pb-2">
                      <dt className="text-gray-500">Account name</dt>
                      <dd className="font-medium text-gray-900 text-right">{manualWalletPayment.account_name}</dd>
                    </div>
                  )}
                  {manualWalletPayment.wallet_number && (
                    <div className="flex justify-between gap-4 border-b border-gray-100 pb-2">
                      <dt className="text-gray-500">Wallet number</dt>
                      <dd className="font-mono font-semibold text-gray-900 text-right">{manualWalletPayment.wallet_number}</dd>
                    </div>
                  )}
                </dl>
                {manualWalletPayment.instructions && (
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm text-gray-700 whitespace-pre-line">
                    {manualWalletPayment.instructions}
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  Amount due: <strong>{formatMoney(remaining, invoice.currency_code)}</strong>
                </p>
              </div>
            ) : paymentFlow === "mtn_momo_direct" ? (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Pay with MTN MoMo (direct)</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Payment is processed through this business&apos;s MTN MoMo collection account. Approve the prompt on your
                  phone; we confirm when MTN reports success.
                </p>
                <div className="mb-5">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Mobile money number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(formatPhone(e.target.value))}
                    placeholder="0XX XXX XXXX"
                    maxLength={14}
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                  />
                </div>
                {phone.replace(/\D/g, "").length >= 10 && (
                  <button
                    type="button"
                    onClick={handlePayMtnDirect}
                    disabled={paymentStatus === "initiating"}
                    className="w-full bg-gradient-to-r from-yellow-500 to-amber-600 text-white py-4 rounded-xl font-bold text-lg shadow-md hover:from-yellow-600 hover:to-amber-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                  >
                    {paymentStatus === "initiating" ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                        Processing…
                      </>
                    ) : (
                      <>Pay {formatMoney(remaining, invoice.currency_code)}</>
                    )}
                  </button>
                )}
              </>
            ) : !isGhana ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                Online payment is currently available for Ghana only. Please contact the business for alternative payment options.
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold text-gray-900 mb-4">Pay with Mobile Money</h2>

                {/* OTP step (Vodafone) */}
                {paymentStatus === "otp" ? (
                  <div className="space-y-4">
                    <p className="text-sm text-gray-600">
                      A confirmation code has been sent to your Vodafone number. Enter it below.
                    </p>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={otp}
                      onChange={e => setOtp(e.target.value.replace(/\D/g, ""))}
                      placeholder="Enter OTP"
                      className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center text-2xl tracking-widest focus:ring-2 focus:ring-red-400 focus:border-red-400"
                    />
                    <button
                      onClick={handleSubmitOtp}
                      disabled={otp.length < 4}
                      className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-40"
                    >
                      Confirm OTP
                    </button>
                    <button onClick={() => { setPaymentStatus("idle"); setOtp("") }} className="w-full text-sm text-gray-500 hover:underline">
                      Back
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Provider selector */}
                    <div className="mb-5">
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Select Provider</label>
                      <div className="grid grid-cols-3 gap-3">
                        {PROVIDERS.map(p => (
                          <button
                            key={p.id}
                            onClick={() => setSelectedProvider(p.id)}
                            className={`p-3 rounded-xl border-2 transition-all text-center ${
                              selectedProvider === p.id
                                ? PROVIDER_COLORS[p.color]
                                : "border-gray-200 hover:border-gray-300 bg-white"
                            }`}
                          >
                            <div className="text-xl mb-1">{p.icon}</div>
                            <div className="text-xs font-semibold text-gray-700 leading-tight">{p.label}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Phone input */}
                    {selectedProvider && (
                      <div className="mb-5">
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          {PROVIDERS.find(p => p.id === selectedProvider)?.label} Number
                        </label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={e => setPhone(formatPhone(e.target.value))}
                          placeholder="0XX XXX XXXX"
                          maxLength={14}
                          className="w-full border border-gray-300 rounded-lg px-4 py-3 text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          {selectedProvider === "vodafone"
                            ? "You will receive an OTP to approve this payment."
                            : "A payment prompt will be sent to your phone."}
                        </p>
                      </div>
                    )}

                    {/* Pay button */}
                    {selectedProvider && phone.replace(/\D/g, "").length >= 10 && (
                      <button
                        onClick={handlePay}
                        disabled={paymentStatus === "initiating"}
                        className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 rounded-xl font-bold text-lg shadow-md hover:from-green-700 hover:to-emerald-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                      >
                        {paymentStatus === "initiating" ? (
                          <>
                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                            Processing…
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            Pay {formatMoney(remaining, invoice.currency_code)}
                          </>
                        )}
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* QR / share link */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Share Payment Link</h3>
          {qrCodeUrl && (
            <div className="flex justify-center mb-3">
              <img src={qrCodeUrl} alt="QR Code" className="border border-gray-200 rounded-lg p-2" width={160} height={160} />
            </div>
          )}
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/pay/${invoiceId}`)
              toast.showToast("Payment link copied!", "success")
            }}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Copy payment link
          </button>
        </div>

      </div>
    </div>
  )
}
