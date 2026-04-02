"use client"

import { useState, useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import dynamic from "next/dynamic"
import type { SignaturePadHandle } from "@/components/SignaturePad"
import { PublicBillToBlock, PublicDocumentMetaRow } from "@/components/documents/PublicBillToBlock"

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

  const reload = async () => {
    const r = await fetch(`/api/public/proforma/${token}`)
    const d = await r.json()
    setProforma(d.proforma)
    setItems(d.items ?? [])
    setBusiness(d.business)
  }

  useEffect(() => {
    fetch(`/api/public/proforma/${token}`)
      .then(r => {
        if (!r.ok) throw new Error("Proforma not found")
        return r.json()
      })
      .then(d => {
        setProforma(d.proforma)
        setItems(d.items ?? [])
        setBusiness(d.business)
        if (d.settings?.brand_color) setBrand(d.settings.brand_color)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  const sym = proforma?.currency_symbol ?? "₵"

  const handleAccept = async () => {
    setAcceptError("")
    if (!fullName.trim()) { setAcceptError("Please enter your full name"); return }
    if (!idType) { setAcceptError("Please select an ID type"); return }
    if (!idNumber.trim()) { setAcceptError("Please enter your ID number"); return }
    if (sigRef.current?.isEmpty()) { setAcceptError("Please draw your signature"); return }

    setAccepting(true)
    try {
      const res = await fetch(`/api/public/proforma/${token}/accept`, {
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
      const res = await fetch(`/api/public/proforma/${token}/reject`, {
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
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-violet-600 mx-auto" />
          <p className="mt-3 text-slate-500 text-sm">Loading proforma…</p>
        </div>
      </div>
    )
  }

  if (error || !proforma) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-rose-600">{error || "Proforma not found"}</p>
      </div>
    )
  }

  const status = proforma.status
  const isOpen = status === "sent"
  const isAccepted = status === "accepted"
  const isRejected = status === "rejected"
  const isConverted = status === "converted"
  const bizName = business?.trading_name ?? business?.legal_name ?? "Business"

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `@media print { .no-print { display: none !important; } }` }} />

      <div className="min-h-screen bg-slate-100 py-8 px-4">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Status banners */}
          {isAccepted && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="font-bold text-emerald-800">You have accepted this proforma</p>
                <p className="text-sm text-emerald-700 mt-0.5">
                  Signed by <strong>{proforma.client_name_signed}</strong> · {formatDate(proforma.signed_at)}
                </p>
              </div>
            </div>
          )}
          {isRejected && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-rose-800">You have declined this proforma</p>
                {proforma.rejected_reason && (
                  <p className="text-sm text-rose-700 mt-0.5">{proforma.rejected_reason}</p>
                )}
              </div>
            </div>
          )}
          {isConverted && (
            <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-semibold text-violet-800">This proforma has been converted to an invoice.</p>
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
                  <p className="text-white/70 text-xs uppercase tracking-wider font-medium">Proforma Invoice</p>
                  <p className="text-2xl font-bold mt-1">{proforma.proforma_number ?? "PRF"}</p>
                  {/* Show a client-friendly status — never show internal "sent" label */}
                  {isAccepted && (
                    <span className="mt-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-400/30 text-emerald-100">
                      Accepted
                    </span>
                  )}
                  {isRejected && (
                    <span className="mt-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-400/30 text-rose-100">
                      Declined
                    </span>
                  )}
                  {isConverted && (
                    <span className="mt-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/20 text-white/80">
                      Converted
                    </span>
                  )}
                  {/* "sent" → awaiting review; no label for draft/cancelled */}
                </div>
              </div>
            </div>

            <PublicDocumentMetaRow
              cells={[
                { label: "Issue Date", value: formatDate(proforma.issue_date) },
                { label: "Valid Until", value: formatDate(proforma.validity_date) },
                { label: "Payment Terms", value: proforma.payment_terms?.trim() || "—" },
                {
                  label: "Currency",
                  value:
                    proforma.currency_code && proforma.currency_symbol
                      ? `${proforma.currency_code} (${proforma.currency_symbol})`
                      : (proforma.currency_code ?? proforma.currency_symbol ?? "—"),
                },
              ]}
            />
            <PublicBillToBlock customer={proforma.customers} />

            {/* Line items — aligned with public invoice table */}
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
                    <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-24">
                      Unit Price
                    </th>
                    <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-24">
                      Discount
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
                      <td className="py-3 text-right text-gray-600 tabular-nums">{item.qty}</td>
                      <td className="py-3 text-right text-gray-600 tabular-nums">{fmt(sym, item.unit_price)}</td>
                      <td className="py-3 text-right text-gray-600 tabular-nums">
                        {Number(item.discount_amount) > 0 ? fmt(sym, item.discount_amount) : "—"}
                      </td>
                      <td className="py-3 text-right text-gray-800 font-medium tabular-nums">
                        {fmt(sym, item.line_subtotal)}
                      </td>
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
                  <span className="tabular-nums font-medium">{fmt(sym, proforma.subtotal)}</span>
                </div>
                {proforma.apply_taxes && proforma.total_tax > 0 && (
                  <>
                    {proforma.nhil > 0 && (
                      <div className="flex justify-between text-gray-500">
                        <span>NHIL (2.5%)</span>
                        <span className="tabular-nums">{fmt(sym, proforma.nhil)}</span>
                      </div>
                    )}
                    {proforma.getfund > 0 && (
                      <div className="flex justify-between text-gray-500">
                        <span>GETFund (2.5%)</span>
                        <span className="tabular-nums">{fmt(sym, proforma.getfund)}</span>
                      </div>
                    )}
                    {proforma.covid > 0 && (
                      <div className="flex justify-between text-gray-500">
                        <span>COVID Levy (1%)</span>
                        <span className="tabular-nums">{fmt(sym, proforma.covid)}</span>
                      </div>
                    )}
                    {proforma.vat > 0 && (
                      <div className="flex justify-between text-gray-500">
                        <span>VAT (15%)</span>
                        <span className="tabular-nums">{fmt(sym, proforma.vat)}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-between items-center pt-2 border-t-2 border-gray-900">
                  <span className="font-bold text-gray-900 text-base">Total</span>
                  <span className="font-bold text-gray-900 text-lg tabular-nums">{fmt(sym, proforma.total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {proforma.notes && (
              <div className="px-8 py-5 border-b border-gray-100 text-sm text-gray-600">
                <p className="font-medium text-gray-800 mb-1">Notes</p>
                <p className="whitespace-pre-line">{proforma.notes}</p>
              </div>
            )}

            {/* Footer message */}
            {proforma.footer_message && (
              <div className="px-8 py-5 border-b border-gray-100 text-sm text-gray-500 italic">
                {proforma.footer_message}
              </div>
            )}

            {isAccepted && proforma.client_signature && (
              <div className="px-8 py-5 border-b border-gray-100">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  Accepted &amp; Signed By
                </p>
                <div className="border border-gray-200 rounded-lg p-3 inline-block bg-gray-50">
                  <img src={proforma.client_signature} alt="Signature" className="h-16 w-auto" />
                </div>
                <p className="text-sm text-gray-600 mt-1">
                  {proforma.client_name_signed} ·{" "}
                  {ID_TYPES.find((t) => t.value === proforma.client_id_type)?.label}: {proforma.client_id_number}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(proforma.signed_at)}</p>
              </div>
            )}
          </div>

          <div className="no-print flex justify-end">
            <a
              href={`/api/public/proforma/${tokenEnc}/pdf`}
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

          {/* Action buttons — only shown when awaiting client response */}
          {isOpen && (
            <div className="no-print">
              <p className="text-center text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Please review the proforma above and choose an option
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setShowAccept(true)}
                  className="flex-1 flex items-center justify-center gap-2 text-white font-bold py-4 px-6 rounded-2xl shadow-sm transition-opacity hover:opacity-90 text-base"
                  style={{ backgroundColor: brand }}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Accept &amp; Sign
                </button>
                <button
                  onClick={() => setShowReject(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-white hover:bg-rose-50 border-2 border-rose-200 text-rose-600 font-semibold py-4 px-6 rounded-2xl shadow-sm transition-colors text-base"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Decline
                </button>
              </div>
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
              <h2 className="text-lg font-bold text-slate-800">Accept &amp; Sign Proforma</h2>
              <button onClick={() => setShowAccept(false)} className="text-slate-400 hover:text-slate-600">
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

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Full name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Enter your full legal name"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  ID type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={idType}
                  onChange={e => setIdType(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
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
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              {acceptError && (
                <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                  {acceptError}
                </p>
              )}

              <p className="text-xs text-slate-500">
                By clicking "Confirm acceptance" you agree to this proforma invoice and confirm that the identity details provided are accurate.
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
              <h2 className="text-lg font-bold text-slate-800">Decline this proforma</h2>
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
