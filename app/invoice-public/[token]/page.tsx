"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument"

type Invoice = {
  id: string
  invoice_number: string
  issue_date: string
  due_date: string | null
  payment_terms: string | null
  notes: string | null
  footer_message: string | null
  currency_code: string
  currency_symbol: string
  subtotal: number
  nhil?: number
  getfund?: number
  covid?: number
  vat?: number
  total_tax?: number | null
  total: number
  status: string
  apply_taxes: boolean
  tax_lines?: unknown
  customers: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
  } | null
}

type Business = {
  legal_name: string | null
  trading_name: string | null
  address_street: string | null
  address_city: string | null
  address_region: string | null
  address_country: string | null
  phone: string | null
  whatsapp_phone: string | null
  email: string | null
  website: string | null
  tin: string | null
  logo_url: string | null
}

type InvoiceSettings = {
  show_tax_breakdown: boolean
  show_business_tin: boolean
  bank_name: string | null
  bank_account_name: string | null
  bank_account_number: string | null
  momo_provider: string | null
  momo_name: string | null
  momo_number: string | null
}

export default function PublicInvoicePage() {
  const params = useParams()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [settings, setSettings] = useState<InvoiceSettings | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch(`/api/invoices/public/${token}`)
      .then(r => {
        if (!r.ok) throw new Error("Invoice not found")
        return r.json()
      })
      .then(d => {
        setInvoice(d.invoice)
        setBusiness(d.business)
        setSettings(d.settings)
        setItems(d.items || [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  const handleCopyPayLink = () => {
    if (!invoice) return
    const url = `${window.location.origin}/pay/${invoice.id}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-slate-700 mx-auto" />
          <p className="mt-3 text-slate-500 text-sm">Loading invoice…</p>
        </div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-slate-700 font-medium">{error || "Invoice not found"}</p>
          <p className="text-slate-400 text-sm mt-1">This link may be invalid or the invoice has been removed.</p>
        </div>
      </div>
    )
  }

  const isPaid = invoice.status === "paid"
  const isOverdue = invoice.status === "overdue"
  const bizName = business?.trading_name ?? business?.legal_name ?? "Business"

  // Status banner config
  const bannerClass = isPaid
    ? "bg-emerald-50 border-emerald-200"
    : isOverdue
    ? "bg-rose-50 border-rose-200"
    : "bg-blue-50 border-blue-200"
  const bannerTextClass = isPaid ? "text-emerald-800" : isOverdue ? "text-rose-800" : "text-blue-800"
  const bannerIcon = isPaid ? (
    <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : isOverdue ? (
    <svg className="w-5 h-5 text-rose-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
        }
      ` }} />

      <div className="min-h-screen bg-slate-100 py-6 px-4">
        <div className="max-w-3xl mx-auto space-y-4">

          {/* ── Top bar ─────────────────────────────────────── */}
          <div className="no-print flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {business?.logo_url ? (
                <img src={business.logo_url} alt="" className="h-6 w-6 rounded object-cover" />
              ) : (
                <div className="w-6 h-6 rounded bg-slate-800 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              )}
              <span className="font-semibold text-slate-700 text-sm">{bizName}</span>
            </div>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print / Save PDF
            </button>
          </div>

          {/* ── Status banner ──────────────────────────────── */}
          <div className={`no-print rounded-2xl border p-4 flex items-center gap-3 ${bannerClass}`}>
            {bannerIcon}
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm ${bannerTextClass}`}>
                {isPaid
                  ? "This invoice has been paid — thank you!"
                  : isOverdue
                  ? `Invoice #${invoice.invoice_number} is overdue`
                  : `Invoice #${invoice.invoice_number} is awaiting payment`}
              </p>
              {!isPaid && invoice.due_date && (
                <p className={`text-xs mt-0.5 ${bannerTextClass} opacity-70`}>
                  Due {new Date(invoice.due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-xs ${bannerTextClass} opacity-60`}>{isPaid ? "Amount paid" : "Amount due"}</p>
              <p className={`text-lg font-bold tabular-nums ${bannerTextClass}`}>
                {invoice.currency_symbol}{Number(invoice.total).toFixed(2)}
              </p>
            </div>
          </div>

          {/* ── Invoice document ───────────────────────────── */}
          {/* Bank/momo details appear inside this component at the bottom.
              displayStatus converts internal "sent" → "Awaiting Payment" for the client. */}
          <InvoiceDocument
            invoice={invoice}
            business={business}
            items={items}
            settings={settings}
            className="print:shadow-none print:border-0 print:rounded-none"
            displayStatus={
              invoice.status === "sent" ? "awaiting_payment" :
              invoice.status === "overdue" ? "overdue" :
              invoice.status === "paid" ? "paid" :
              invoice.status === "partially_paid" ? "partially_paid" :
              undefined
            }
          />

          {/* ── Pay online (no-print, only if unpaid) ──────── */}
          {!isPaid && (
            <div className="no-print bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Pay Online</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Secure payment via mobile money</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  isOverdue ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700"
                }`}>
                  {invoice.currency_symbol}{Number(invoice.total).toFixed(2)} due
                </span>
              </div>
              <div className="p-5 flex flex-col sm:flex-row items-center gap-6">
                {/* QR */}
                <div className="shrink-0 flex flex-col items-center gap-1.5">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=4&data=${encodeURIComponent(typeof window !== "undefined" ? `${window.location.origin}/pay/${invoice.id}` : "")}`}
                    alt="QR code"
                    className="w-28 h-28 rounded-xl border border-slate-100 bg-white"
                  />
                  <p className="text-xs text-slate-400">Scan to pay</p>
                </div>

                {/* Buttons */}
                <div className="flex-1 w-full space-y-2.5">
                  <a
                    href={`/pay/${invoice.id}`}
                    className="flex items-center justify-center gap-2 w-full bg-slate-900 hover:bg-black text-white font-semibold py-3 px-5 rounded-xl transition-colors text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Pay with Mobile Money
                  </a>
                  <button
                    onClick={handleCopyPayLink}
                    className="flex items-center justify-center gap-2 w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 font-medium py-2.5 px-5 rounded-xl transition-colors text-sm"
                  >
                    {copied ? (
                      <>
                        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Link copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Copy payment link
                      </>
                    )}
                  </button>
                  {(settings?.bank_account_number || settings?.momo_number) && (
                    <p className="text-xs text-slate-400 text-center pt-1">
                      Or pay via bank/mobile money details shown on the invoice above
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <p className="no-print text-center text-xs text-slate-400 pb-4">Powered by Finza</p>
        </div>
      </div>
    </>
  )
}
