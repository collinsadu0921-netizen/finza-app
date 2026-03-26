"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import type { SignaturePadHandle } from "@/components/SignaturePad"
import { PublicBillToBlock, PublicDocumentMetaRow } from "@/components/documents/PublicBillToBlock"

// Lazy-load signature pad (canvas — SSR-incompatible)
const SignaturePad = dynamic(() => import("@/components/SignaturePad"), { ssr: false })

const ID_TYPES = [
  { value: "ghana_card", label: "Ghana Card" },
  { value: "national_id", label: "National ID" },
  { value: "passport", label: "Passport" },
  { value: "drivers_license", label: "Driver's License" },
  { value: "voters_id", label: "Voter's ID" },
]

type Estimate = {
  id: string
  estimate_number: string
  issue_date: string
  expiry_date: string | null
  notes: string | null
  subtotal: number
  nhil_amount: number
  getfund_amount: number
  covid_amount: number
  vat_amount: number
  total_tax_amount: number
  total_amount: number
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

type Item = { id: string; description: string; quantity: number; price: number; total: number }

const fmt = (sym: string, n: number) =>
  `${sym}${Number(n ?? 0).toFixed(2)}`

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"

export default function QuotePublicPage() {
  const params = useParams()
  const router = useRouter()
  const token = typeof params.token === "string" ? decodeURIComponent(params.token) : ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [business, setBusiness] = useState<Business | null>(null)
  const [brand, setBrand] = useState("#0f172a")
  const [quoteTerms, setQuoteTerms] = useState<string | null>(null)

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

  useEffect(() => {
    if (!token) {
      setError("Invalid link")
      setLoading(false)
      return
    }
    let cancelled = false
    const enc = encodeURIComponent(token)
    ;(async () => {
      try {
        const quoteRes = await fetch(`/api/public/quote/${enc}`, { cache: "no-store" })
        if (quoteRes.ok) {
          const d = await quoteRes.json()
          if (cancelled) return
          setEstimate(d.estimate)
          setItems(d.items ?? [])
          setBusiness(d.business)
          if (d.settings?.brand_color) setBrand(d.settings.brand_color)
          if (d.settings?.quote_terms_and_conditions) setQuoteTerms(d.settings.quote_terms_and_conditions)
          return
        }
        // Same opaque token may be a proforma (client links use /proforma-public/…)
        const proformaRes = await fetch(`/api/public/proforma/${enc}`, { cache: "no-store" })
        if (proformaRes.ok && !cancelled) {
          router.replace(`/proforma-public/${enc}`)
          return
        }
        if (!cancelled) setError("Quote not found")
      } catch {
        if (!cancelled) setError("Quote not found")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, router])

  const sym = estimate?.currency_symbol ?? "₵"
  const quoteTokenEnc = token ? encodeURIComponent(token) : ""

  const handleAccept = async () => {
    setAcceptError("")
    if (!fullName.trim()) { setAcceptError("Please enter your full name"); return }
    if (!idType) { setAcceptError("Please select an ID type"); return }
    if (!idNumber.trim()) { setAcceptError("Please enter your ID number"); return }
    if (sigRef.current?.isEmpty()) { setAcceptError("Please draw your signature"); return }

    setAccepting(true)
    try {
      const res = await fetch(`/api/public/quote/${quoteTokenEnc}/accept`, {
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
      // Reload
      const r2 = await fetch(`/api/public/quote/${token}`)
      const d2 = await r2.json()
      setEstimate(d2.estimate)
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
      const res = await fetch(`/api/public/quote/${quoteTokenEnc}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      })
      const data = await res.json()
      if (!res.ok) { setRejectError(data.error ?? "Failed to decline"); return }
      setShowReject(false)
      const r2 = await fetch(`/api/public/quote/${quoteTokenEnc}`)
      const d2 = await r2.json()
      setEstimate(d2.estimate)
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
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto" />
          <p className="mt-3 text-slate-500 text-sm">Loading quote…</p>
        </div>
      </div>
    )
  }

  if (error || !estimate) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-rose-600">{error || "Quote not found"}</p>
      </div>
    )
  }

  const status = estimate.status
  const isOpen = status === "sent"
  const isAccepted = status === "accepted"
  const isRejected = status === "rejected"
  const bizName = business?.trading_name ?? business?.legal_name ?? "Business"

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `@media print { .no-print { display: none !important; } }` }} />

      <div className="min-h-screen bg-slate-100 py-8 px-4">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Status banner */}
          {isAccepted && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-emerald-800">Quote accepted</p>
                <p className="text-sm text-emerald-700 mt-0.5">
                  Signed by <strong>{estimate.client_name_signed}</strong> on {formatDate(estimate.signed_at)}
                  {estimate.client_id_type && (
                    <> · {ID_TYPES.find(t => t.value === estimate.client_id_type)?.label}: <strong>{estimate.client_id_number}</strong></>
                  )}
                </p>
              </div>
            </div>
          )}
          {isRejected && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-rose-800">Quote declined</p>
                {estimate.rejected_reason && (
                  <p className="text-sm text-rose-700 mt-0.5">Reason: {estimate.rejected_reason}</p>
                )}
              </div>
            </div>
          )}

          {/* Document card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Header — brand colour */}
            <div className="px-6 py-5 text-white" style={{ backgroundColor: brand }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  {business?.logo_url ? (
                    <img src={business.logo_url} alt="" className="h-10 w-auto mb-3 rounded" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold text-lg mb-3">
                      {bizName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <h1 className="text-xl font-bold">{bizName}</h1>
                  <p className="text-white/70 text-sm mt-0.5">
                    {[business?.address_street, business?.address_city, business?.address_region].filter(Boolean).join(", ")}
                  </p>
                  {business?.phone && <p className="text-white/70 text-sm">{business.phone}</p>}
                  {business?.email && <p className="text-white/70 text-sm">{business.email}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-white/70 text-xs uppercase tracking-wider font-medium">Quotation</p>
                  <p className="text-2xl font-bold mt-1">{estimate.estimate_number ?? "DRAFT"}</p>
                  <span className={`mt-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    isAccepted ? "bg-emerald-400/30 text-emerald-100" :
                    isRejected ? "bg-rose-400/30 text-rose-100" :
                    isOpen ? "bg-white/20 text-white" : "bg-white/10 text-white/70"
                  }`}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </span>
                </div>
              </div>
            </div>

            <PublicDocumentMetaRow
              cells={[
                { label: "Issue Date", value: formatDate(estimate.issue_date) },
                { label: "Valid Until", value: formatDate(estimate.expiry_date) },
                { label: "Payment Terms", value: "—" },
                {
                  label: "Currency",
                  value: estimate.currency_code && estimate.currency_symbol
                    ? `${estimate.currency_code} (${estimate.currency_symbol})`
                    : (estimate.currency_code ?? estimate.currency_symbol ?? "—"),
                },
              ]}
            />
            <PublicBillToBlock customer={estimate.customers} />

            {/* Line items — table styling aligned with public invoice view */}
            <div className="px-8 py-5 border-b border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3">
                      Description
                    </th>
                    <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-16">
                      Qty
                    </th>
                    <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-28">
                      Unit Price
                    </th>
                    <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-28">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 text-gray-800 font-medium">{item.description}</td>
                      <td className="py-3 text-right text-gray-600 tabular-nums">{item.quantity}</td>
                      <td className="py-3 text-right text-gray-600 tabular-nums">{fmt(sym, item.price)}</td>
                      <td className="py-3 text-right text-gray-800 font-medium tabular-nums">{fmt(sym, item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="px-8 py-5 border-b border-gray-100">
              <div className="max-w-xs ml-auto space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span className="tabular-nums font-medium">{fmt(sym, estimate.subtotal)}</span>
                  </div>
                  {estimate.apply_taxes && estimate.total_tax_amount > 0 && (
                    <>
                      {estimate.nhil_amount > 0 && (
                        <div className="flex justify-between text-gray-500">
                          <span>NHIL (2.5%)</span>
                          <span className="tabular-nums">{fmt(sym, estimate.nhil_amount)}</span>
                        </div>
                      )}
                      {estimate.getfund_amount > 0 && (
                        <div className="flex justify-between text-gray-500">
                          <span>GETFund (2.5%)</span>
                          <span className="tabular-nums">{fmt(sym, estimate.getfund_amount)}</span>
                        </div>
                      )}
                      {estimate.covid_amount > 0 && (
                        <div className="flex justify-between text-gray-500">
                          <span>COVID Levy (1%)</span>
                          <span className="tabular-nums">{fmt(sym, estimate.covid_amount)}</span>
                        </div>
                      )}
                      {estimate.vat_amount > 0 && (
                        <div className="flex justify-between text-gray-500">
                          <span>VAT (15%)</span>
                          <span className="tabular-nums">{fmt(sym, estimate.vat_amount)}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between items-center pt-2 border-t-2 border-gray-900">
                    <span className="font-bold text-gray-900 text-base">Total</span>
                    <span className="font-bold text-gray-900 text-lg tabular-nums">{fmt(sym, estimate.total_amount)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {estimate.notes && (
                <div className="px-8 py-5 border-b border-gray-100 text-sm text-gray-600">
                  <p className="font-medium text-gray-800 mb-1">Notes</p>
                  <p className="whitespace-pre-line">{estimate.notes}</p>
                </div>
              )}

              {/* Terms & Conditions — from invoice settings, auto-applied to every quote */}
              {quoteTerms && (
                <div className="px-8 py-5 border-b border-gray-100">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                    Terms &amp; Conditions
                  </p>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-xs text-gray-600 whitespace-pre-line leading-relaxed max-h-48 overflow-y-auto">
                    {quoteTerms}
                  </div>
                  {isOpen && (
                    <p className="text-xs text-gray-400 mt-2 italic">
                      By accepting this quote, you agree to the terms and conditions above.
                    </p>
                  )}
                </div>
              )}

              {/* Accepted signature block */}
              {isAccepted && estimate.client_signature && (
                <div className="px-8 py-5 border-b border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    Accepted &amp; Signed By
                  </p>
                  <div className="border border-gray-200 rounded-lg p-3 inline-block bg-gray-50">
                    <img src={estimate.client_signature} alt="Signature" className="h-16 w-auto" />
                  </div>
                  <p className="text-sm text-gray-600 mt-1">
                    {estimate.client_name_signed} ·{" "}
                    {ID_TYPES.find((t) => t.value === estimate.client_id_type)?.label}: {estimate.client_id_number}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(estimate.signed_at)}</p>
                </div>
              )}
          </div>

          <div className="no-print flex justify-end">
            <a
              href={`/api/public/quote/${quoteTokenEnc}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm hover:bg-slate-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16v-8m0 8l-3-3m3 3l3-3M5 20h14" />
              </svg>
              Download / Print PDF
            </a>
          </div>

          {/* Action buttons — only when status is 'sent' */}
          {isOpen && (
            <div className="no-print flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setShowAccept(true)}
                className="flex-1 flex items-center justify-center gap-2 text-white font-semibold py-3.5 px-6 rounded-xl shadow-sm transition-opacity hover:opacity-90"
                style={{ backgroundColor: brand }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Accept &amp; Sign
              </button>
              <button
                onClick={() => setShowReject(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-rose-50 border border-rose-300 text-rose-600 font-semibold py-3.5 px-6 rounded-xl shadow-sm transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Decline
              </button>
            </div>
          )}

          <div className="flex items-center justify-center gap-1.5 pb-4">
            <svg className="w-3.5 h-3.5 text-slate-300" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <p className="text-xs text-slate-400">Powered by <span className="font-semibold text-slate-500">Finza</span></p>
          </div>
        </div>
      </div>

      {/* ── ACCEPT MODAL ─────────────────────────────────────────── */}
      {showAccept && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Accept &amp; Sign Quote</h2>
              <button onClick={() => setShowAccept(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-5">
              {/* Signature canvas */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Draw your signature <span className="text-rose-500">*</span>
                </label>
                <div className="border-2 border-dashed border-slate-300 rounded-xl overflow-hidden bg-slate-50">
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
                  className="mt-1.5 text-xs text-slate-500 hover:text-slate-700 underline"
                >
                  Clear signature
                </button>
              </div>

              {/* Full name */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Full name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Enter your full legal name"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* ID type */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  ID type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={idType}
                  onChange={e => setIdType(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Select ID type…</option>
                  {ID_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* ID number */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  ID number <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={idNumber}
                  onChange={e => setIdNumber(e.target.value)}
                  placeholder="e.g. GHA-000000000-0"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {acceptError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {acceptError}
                </p>
              )}

              <p className="text-xs text-slate-500">
                By clicking "Confirm acceptance" you agree to this quote and confirm that the identity details provided are accurate.
              </p>

              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowAccept(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Decline this quote</h2>
              <button onClick={() => setShowReject(false)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Reason (optional)
                </label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Tell us why you're declining…"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 resize-none"
                />
              </div>
              {rejectError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {rejectError}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowReject(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReject}
                  disabled={rejecting}
                  className="flex-1 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors"
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
