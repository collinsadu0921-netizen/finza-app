"use client"

import { useState, useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import dynamic from "next/dynamic"
import type { SignaturePadHandle } from "@/components/SignaturePad"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"

const SignaturePad = dynamic(() => import("@/components/SignaturePad"), { ssr: false })

const ID_TYPES = [
  { value: "ghana_card", label: "Ghana Card" },
  { value: "national_id", label: "National ID" },
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "voters_id", label: "Voter's ID" },
]

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
  client_name_signed: string | null
  client_id_type: string | null
  client_id_number: string | null
  client_signature: string | null
  signed_at: string | null
  rejected_reason: string | null
  rejected_at: string | null
  customers: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
    tin?: string | null
    whatsapp_phone?: string | null
  } | null
}

type Business = {
  legal_name: string | null
  trading_name: string | null
  address_street: string | null
  address_city: string | null
  address_region: string | null
  phone: string | null
  email: string | null
  website: string | null
  tin: string | null
  logo_url: string | null
}

type Item = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

type PaymentDetailsRow = {
  bank_name?: string | null
  bank_account_name?: string | null
  bank_account_number?: string | null
  momo_provider?: string | null
  momo_name?: string | null
  momo_number?: string | null
}

type ProformaPublicSettings = {
  brand_color?: string | null
  quote_terms_and_conditions?: string | null
  payment_details?: PaymentDetailsRow | null
}

const fmt = (sym: string, n: number) => `${sym}${Number(n ?? 0).toFixed(2)}`

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"

export default function ProformaPublicPage() {
  const params = useParams()
  const token = params.token as string
  const tokenEnc = encodeURIComponent(token || "")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [proforma, setProforma] = useState<ProformaInvoice | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [brand, setBrand] = useState("#0f172a")
  const [quoteTermsClient, setQuoteTermsClient] = useState<string | null>(null)
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetailsRow | null>(null)

  // Accept modal
  const [showAccept, setShowAccept] = useState(false)
  const [sigEmpty, setSigEmpty] = useState(true)
  const [fullName, setFullName] = useState("")
  const [idType, setIdType] = useState("")
  const [idNumber, setIdNumber] = useState("")
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState("")
  const sigRef = useRef<SignaturePadHandle>(null)

  // Reject modal
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const [rejectError, setRejectError] = useState("")

  const applyPayload = (d: {
    proforma: ProformaInvoice
    items?: Item[]
    business: Business | null
    settings?: ProformaPublicSettings | null
  }) => {
    setProforma(d.proforma)
    setItems(d.items ?? [])
    setBusiness(d.business)
    const s = d.settings
    if (s?.brand_color) setBrand(s.brand_color)
    setQuoteTermsClient(s?.quote_terms_and_conditions?.trim() ? s.quote_terms_and_conditions : null)
    setPaymentDetails(s?.payment_details ?? null)
  }

  const reload = async () => {
    const enc = encodeURIComponent(token || "")
    const r = await fetch(`/api/public/proforma/${enc}`)
    const d = await r.json()
    applyPayload(d)
  }

  useEffect(() => {
    const enc = encodeURIComponent(token || "")
    fetch(`/api/public/proforma/${enc}`)
      .then(r => {
        if (!r.ok) throw new Error("Proforma not found")
        return r.json()
      })
      .then(d => {
        applyPayload(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!proforma || !business) return
    const issuer = business.trading_name ?? business.legal_name ?? "Business"
    const num = proforma.proforma_number ?? "Proforma"
    document.title = `Proforma Invoice ${num} — ${issuer}`
  }, [proforma, business])

  const sym = proforma?.currency_symbol ?? "₵"

  const handleAccept = async () => {
    setAcceptError("")
    if (!fullName.trim()) { setAcceptError("Please enter your full name"); return }
    if (!idType) { setAcceptError("Please select an ID type"); return }
    if (!idNumber.trim()) { setAcceptError("Please enter your ID number"); return }
    if (sigRef.current?.isEmpty()) { setAcceptError("Please draw your signature"); return }

    setAccepting(true)
    try {
      const res = await fetch(`/api/public/proforma/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name_signed: fullName,
          client_id_type: idType,
          client_id_number: idNumber,
          client_signature: sigRef.current?.toDataURL() ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setAcceptError(data.error ?? "Failed to accept"); return }
      setShowAccept(false)
      await reload()
    } catch {
      setAcceptError("Network error — please try again")
    } finally {
      setAccepting(false)
    }
  }

  const handleReject = async () => {
    setRejectError("")
    setRejecting(true)
    try {
      const res = await fetch(`/api/public/proforma/${encodeURIComponent(token)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      })
      const data = await res.json()
      if (!res.ok) { setRejectError(data.error ?? "Failed to decline"); return }
      setShowReject(false)
      await reload()
    } catch {
      setRejectError("Network error — please try again")
    } finally {
      setRejecting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-slate-200 border-t-slate-600 mx-auto" />
          <p className="mt-3 text-slate-400 text-sm font-medium">Loading proforma…</p>
        </div>
      </div>
    )
  }

  if (error || !proforma) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-slate-700 font-semibold">{error || "Proforma not found"}</p>
          <p className="text-slate-400 text-sm mt-1">This link may be invalid or the proforma has been removed.</p>
        </div>
      </div>
    )
  }

  const status = proforma.status
  const isOpen = status === "sent"
  const isAccepted = status === "accepted"
  const isRejected = status === "rejected"
  const isConverted = status === "converted"
  const bizName = business?.trading_name ?? business?.legal_name ?? "Business"
  const bizAddress = [business?.address_street, business?.address_city, business?.address_region]
    .filter(Boolean).join(", ")

  const hasDiscounts = items.some(item => Number(item.discount_amount || 0) > 0)
  const hasBankPay = !!(paymentDetails?.bank_account_number?.trim())
  const hasMomoPay = !!(paymentDetails?.momo_number?.trim())
  const hasPaymentDetails = hasBankPay || hasMomoPay

  // Build tax lines: prefer new tax_lines JSONB, fall back to legacy fields
  const taxLinesToShow: { key: string; label: string; amount: number }[] = []
  if (proforma.apply_taxes && proforma.total_tax > 0) {
    const parsedLines = Array.isArray(proforma.tax_lines)
      ? proforma.tax_lines
      : typeof proforma.tax_lines === "string"
      ? (() => { try { return JSON.parse(proforma.tax_lines) } catch { return null } })()
      : null

    if (parsedLines && parsedLines.length > 0) {
      parsedLines
        .filter((l: any) => Number(l.amount) > 0 && String(l.code).toUpperCase() !== "COVID")
        .forEach((l: any) =>
          taxLinesToShow.push({ key: l.code, label: l.name || l.code, amount: Number(l.amount) })
        )
    } else {
      if (proforma.nhil > 0) taxLinesToShow.push({ key: "nhil", label: "NHIL (2.5%)", amount: proforma.nhil })
      if (proforma.getfund > 0) taxLinesToShow.push({ key: "getfund", label: "GETFund (2.5%)", amount: proforma.getfund })
      if (proforma.covid > 0) taxLinesToShow.push({ key: "covid", label: "COVID Levy (1%)", amount: proforma.covid })
      if (proforma.vat > 0) taxLinesToShow.push({ key: "vat", label: "VAT (15%)", amount: proforma.vat })
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `@media print { .no-print { display: none !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }` }} />

      {/* Top toolbar — client document */}
      <div className="no-print sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur px-4 py-2.5">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <BusinessLogoDisplay
              logoUrl={business?.logo_url}
              businessName={bizName}
              variant="toolbar"
              rounded="lg"
              brandingResolved
            />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Proforma Invoice</p>
              <p className="text-sm font-semibold text-slate-800 truncate">{bizName}</p>
              <p className="text-xs text-slate-400 truncate tabular-nums">{proforma.proforma_number ?? "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/api/public/proforma/${tokenEnc}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-8m0 8l-3-3m3 3l3-3M5 20h14" />
              </svg>
              Download PDF
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-screen bg-slate-50 py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-4">

          {/* ── Status banners ───────────────────────────────────────── */}
          {isOpen && (
            <div className="no-print bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${brand}18` }}>
                <svg className="w-4.5 h-4.5" style={{ color: brand }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">Proforma invoice awaiting your review</p>
                <p className="text-xs text-slate-500 mt-0.5">Please review the details below and accept or decline.</p>
              </div>
            </div>
          )}

          {isAccepted && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-emerald-800 text-sm">Proforma invoice accepted</p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Signed by <strong>{proforma.client_name_signed}</strong> · {formatDate(proforma.signed_at)}
                </p>
              </div>
            </div>
          )}

          {isRejected && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-rose-800 text-sm">Proforma invoice declined</p>
                {proforma.rejected_reason && (
                  <p className="text-xs text-rose-700 mt-0.5">{proforma.rejected_reason}</p>
                )}
              </div>
            </div>
          )}

          {isConverted && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-semibold text-violet-800 text-sm">This proforma invoice has been converted to an invoice.</p>
            </div>
          )}

          {/* ── Document card ───────────────────────────────────────── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">

            {/* Document header — brand colour */}
            <div className="px-8 py-8 text-white" style={{ backgroundColor: brand }}>
              <div className="flex items-start justify-between gap-6">
                {/* Business identity */}
                <div className="flex-1 min-w-0">
                  <div className="mb-4">
                    <BusinessLogoDisplay
                      logoUrl={business?.logo_url}
                      businessName={bizName}
                      variant="hero"
                      rounded="lg"
                      brandingResolved
                      className="max-w-[220px]"
                    />
                  </div>
                  <h1 className="text-lg font-bold text-white leading-tight">{bizName}</h1>
                  {bizAddress && <p className="text-white/60 text-xs mt-1">{bizAddress}</p>}
                  {business?.phone && <p className="text-white/60 text-xs mt-0.5">{business.phone}</p>}
                  {business?.email && <p className="text-white/60 text-xs mt-0.5">{business.email}</p>}
                  {business?.tin && <p className="text-white/50 text-xs mt-1.5">TIN: {business.tin}</p>}
                </div>

                {/* Document identity */}
                <div className="text-right shrink-0">
                  <p className="text-white/50 text-xs uppercase tracking-widest font-semibold mb-1.5">Proforma Invoice</p>
                  <p className="text-3xl font-bold text-white tabular-nums">{proforma.proforma_number ?? "PRF"}</p>
                  {/* Only show badge for terminal states — never "Sent" to the client */}
                  {isAccepted && (
                    <span className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-400/25 text-emerald-100">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      Accepted
                    </span>
                  )}
                  {isRejected && (
                    <span className="mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-rose-400/25 text-rose-100">
                      Declined
                    </span>
                  )}
                  {isConverted && (
                    <span className="mt-3 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-white/15 text-white/80">
                      Converted
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Meta strip */}
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/60">
              <div className="px-6 py-4">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">Issue Date</p>
                <p className="text-sm font-semibold text-slate-800">{formatDate(proforma.issue_date)}</p>
              </div>
              <div className="px-6 py-4">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">Valid Until</p>
                <p className="text-sm font-semibold text-slate-800">{formatDate(proforma.validity_date)}</p>
              </div>
              <div className="px-6 py-4">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">Currency</p>
                <p className="text-sm font-semibold text-slate-800">
                  {proforma.currency_code && proforma.currency_symbol
                    ? `${proforma.currency_code} (${proforma.currency_symbol})`
                    : proforma.currency_code ?? proforma.currency_symbol ?? "—"}
                </p>
              </div>
            </div>

            {/* Prepared for */}
            <div className="px-8 py-5 border-b border-slate-100">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2.5">Prepared For</p>
              {proforma.customers ? (
                <div className="text-sm space-y-0.5">
                  <p className="text-base font-bold text-slate-900">{proforma.customers.name}</p>
                  {proforma.customers.address && (
                    <p className="text-slate-500 whitespace-pre-line">{proforma.customers.address}</p>
                  )}
                  {proforma.customers.email && <p className="text-slate-500">{proforma.customers.email}</p>}
                  {proforma.customers.phone && <p className="text-slate-500">{proforma.customers.phone}</p>}
                  {proforma.customers.whatsapp_phone &&
                    proforma.customers.whatsapp_phone.trim() !== (proforma.customers.phone ?? "").trim() && (
                      <p className="text-slate-500">WhatsApp: {proforma.customers.whatsapp_phone}</p>
                    )}
                  {proforma.customers.tin && (
                    <p className="text-slate-400 text-xs pt-0.5">TIN: {proforma.customers.tin}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">No customer specified</p>
              )}
            </div>

            {/* Line items */}
            <div className="px-8 py-5 border-b border-slate-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Description
                    </th>
                    <th className="text-right py-2 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 w-14">
                      Qty
                    </th>
                    <th className="text-right py-2 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 w-28">
                      Unit Price
                    </th>
                    {hasDiscounts && (
                      <th className="text-right py-2 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 w-24">
                        Discount
                      </th>
                    )}
                    <th className="text-right py-2 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 w-28">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3.5 text-slate-800 font-medium leading-snug">{item.description}</td>
                      <td className="py-3.5 text-right text-slate-500 tabular-nums">{item.qty}</td>
                      <td className="py-3.5 text-right text-slate-500 tabular-nums">{fmt(sym, item.unit_price)}</td>
                      {hasDiscounts && (
                        <td className="py-3.5 text-right tabular-nums text-rose-500">
                          {Number(item.discount_amount) > 0
                            ? `−${fmt(sym, item.discount_amount)}`
                            : <span className="text-slate-300">—</span>}
                        </td>
                      )}
                      <td className="py-3.5 text-right text-slate-800 font-semibold tabular-nums">
                        {fmt(sym, item.line_subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/40">
              <div className="max-w-xs ml-auto space-y-2 text-sm">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span className="tabular-nums font-medium text-slate-700">{fmt(sym, proforma.subtotal)}</span>
                </div>
                {taxLinesToShow.map((line) => (
                  <div key={line.key} className="flex justify-between text-slate-500">
                    <span>{line.label}</span>
                    <span className="tabular-nums">{fmt(sym, line.amount)}</span>
                  </div>
                ))}
                {taxLinesToShow.length > 1 && (
                  <div className="flex justify-between text-slate-500">
                    <span>Total Tax</span>
                    <span className="tabular-nums">{fmt(sym, proforma.total_tax)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-3 mt-1 border-t-2 border-slate-900">
                  <span className="font-bold text-slate-900 text-base">Total</span>
                  <span className="font-bold text-slate-900 text-xl tabular-nums">{fmt(sym, proforma.total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {proforma.notes && (
              <div className="px-8 py-5 border-b border-slate-100">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2.5">Notes</p>
                <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{proforma.notes}</p>
              </div>
            )}

            {/* How to pay — aligned with PDF */}
            {hasPaymentDetails && (
              <div className="px-8 py-5 border-b border-slate-100 bg-slate-50/50">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">How to pay</p>
                <div className={`grid gap-3 ${hasBankPay && hasMomoPay ? "sm:grid-cols-2" : ""}`}>
                  {hasBankPay && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Bank transfer</p>
                      {paymentDetails?.bank_name && (
                        <p className="font-semibold text-slate-800">{paymentDetails.bank_name}</p>
                      )}
                      {paymentDetails?.bank_account_name && (
                        <p className="text-xs text-slate-500 mt-1">
                          Account name: <span className="font-medium text-slate-700">{paymentDetails.bank_account_name}</span>
                        </p>
                      )}
                      <p className="font-mono text-sm font-bold text-slate-900 mt-2 tracking-wide">
                        {paymentDetails?.bank_account_number}
                      </p>
                    </div>
                  )}
                  {hasMomoPay && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                        {paymentDetails?.momo_provider ? `${paymentDetails.momo_provider} MoMo` : "Mobile money"}
                      </p>
                      {paymentDetails?.momo_name && (
                        <p className="text-xs text-slate-500">
                          Name: <span className="font-medium text-slate-700">{paymentDetails.momo_name}</span>
                        </p>
                      )}
                      <p className="font-mono text-sm font-bold text-slate-900 mt-2 tracking-wide">
                        {paymentDetails?.momo_number}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {proforma.payment_terms?.trim() && (
              <div className="px-8 py-5 border-b border-slate-100">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2.5">Payment terms</p>
                <p className="text-sm text-slate-600 whitespace-pre-line leading-relaxed">{proforma.payment_terms}</p>
              </div>
            )}

            {quoteTermsClient && (
              <div className="px-8 py-5 border-b border-slate-100">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-2.5">
                  Terms &amp; conditions
                </p>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-xs text-slate-600 whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto">
                  {quoteTermsClient}
                </div>
              </div>
            )}

            {/* Footer message */}
            {proforma.footer_message && (
              <div className="px-8 py-4 border-b border-slate-100">
                <p className="text-xs text-slate-400 text-center leading-relaxed whitespace-pre-line">{proforma.footer_message}</p>
              </div>
            )}

            {/* Accepted signature block */}
            {isAccepted && proforma.client_signature && (
              <div className="px-8 py-6">
                <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-3">
                  Accepted &amp; Signed
                </p>
                <div className="flex items-start gap-5">
                  <div className="border border-slate-200 rounded-xl p-3 bg-white shadow-sm inline-block">
                    <img src={proforma.client_signature} alt="Signature" className="h-16 w-auto" />
                  </div>
                  <div className="pt-1">
                    <p className="font-semibold text-slate-800">{proforma.client_name_signed}</p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {ID_TYPES.find(t => t.value === proforma.client_id_type)?.label}: {proforma.client_id_number}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">{formatDate(proforma.signed_at)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Action buttons ──────────────────────────────────────── */}
          {isOpen && (
            <div className="no-print space-y-3">
              <p className="text-center text-xs font-semibold text-slate-400 uppercase tracking-widest">
                Your response
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowAccept(true)}
                  className="flex-1 flex items-center justify-center gap-2.5 text-white font-bold py-4 px-8 rounded-2xl shadow-sm transition-opacity hover:opacity-90 text-base"
                  style={{ backgroundColor: brand }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Accept &amp; Sign
                </button>
                <button
                  onClick={() => setShowReject(true)}
                  className="sm:w-auto flex items-center justify-center gap-2 border border-slate-200 hover:border-rose-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50 font-medium py-4 px-6 rounded-2xl transition-colors text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Decline
                </button>
              </div>
            </div>
          )}

          <p className="no-print text-center text-[11px] text-slate-300 pb-5">Powered by Finza</p>

        </div>
      </div>

      {/* ── ACCEPT MODAL ─────────────────────────────────────────── */}
      {showAccept && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-800">Accept &amp; Sign Proforma</h2>
                <p className="text-xs text-slate-400 mt-0.5">Your signature confirms acceptance of this proforma</p>
              </div>
              <button onClick={() => setShowAccept(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Draw your signature <span className="text-rose-500">*</span>
                </label>
                <div className="border-2 border-dashed border-slate-200 rounded-xl overflow-hidden bg-slate-50 hover:border-slate-300 transition-colors">
                  <SignaturePad
                    ref={sigRef}
                    height={150}
                    className="w-full"
                    onChange={empty => setSigEmpty(empty)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => { sigRef.current?.clear(); setSigEmpty(true) }}
                  className="mt-1.5 text-xs text-slate-400 hover:text-slate-600 underline"
                >
                  Clear signature
                </button>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Full legal name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Enter your full legal name"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-shadow"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  ID type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={idType}
                  onChange={e => setIdType(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent bg-white transition-shadow"
                >
                  <option value="">Select ID type…</option>
                  {ID_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  ID number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={idNumber}
                  onChange={e => setIdNumber(e.target.value)}
                  placeholder="e.g. GHA-000000000-0"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent transition-shadow"
                />
              </div>

              {acceptError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
                  {acceptError}
                </p>
              )}

              <p className="text-xs text-slate-400 leading-relaxed">
                By clicking "Confirm acceptance" you agree to this proforma invoice and confirm that the identity details provided are accurate and belong to you.
              </p>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowAccept(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {accepting ? "Saving…" : "Confirm acceptance"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECT MODAL ─────────────────────────────────────────── */}
      {showReject && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-800">Decline this proforma</h2>
                <p className="text-xs text-slate-400 mt-0.5">Let the sender know why you're declining</p>
              </div>
              <button onClick={() => setShowReject(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Reason <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Let the sender know why you're declining…"
                  className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-400 focus:border-transparent resize-none"
                />
              </div>
              {rejectError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
                  {rejectError}
                </p>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowReject(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejecting}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                >
                  {rejecting ? "Saving…" : "Confirm decline"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
