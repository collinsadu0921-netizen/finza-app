"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { InvoiceDocument } from "@/components/invoices/InvoiceDocument"
import { invoiceCustomerStatusLabel } from "@/lib/invoices/invoiceCustomerPaymentDisplay"
import { formatMoney } from "@/lib/money"

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
  wht_receivable_applicable?: boolean | null
  wht_receivable_rate?: number | null
  wht_receivable_amount?: number | null
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
  bank_branch?: string | null
  bank_swift?: string | null
  bank_iban?: string | null
  bank_account_name: string | null
  bank_account_number: string | null
  momo_provider: string | null
  momo_name: string | null
  momo_number: string | null
  brand_color: string | null
}

type PaymentSummary = {
  balanceDue: number
  statusLabel: string
}

export default function PublicInvoicePage() {
  const params = useParams()
  const token = params.token as string

  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [settings, setSettings] = useState<InvoiceSettings | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummary | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    const enc = encodeURIComponent(token)
    fetch(`/api/invoices/public/${enc}`)
      .then(r => {
        if (!r.ok) throw new Error("Invoice not found")
        return r.json()
      })
      .then(d => {
        setInvoice(d.invoice)
        setBusiness(d.business)
        setSettings(d.settings)
        setItems(d.items || [])
        setPaymentSummary(
          d.paymentSummary?.balanceDue != null && d.paymentSummary?.statusLabel
            ? {
                balanceDue: Number(d.paymentSummary.balanceDue),
                statusLabel: String(d.paymentSummary.statusLabel),
              }
            : null
        )
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => {
    if (!invoice) return
    const issuer = business?.trading_name ?? business?.legal_name ?? "Business"
    document.title = `Invoice ${invoice.invoice_number} — ${issuer}`
  }, [invoice, business])

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
  const isPartial = invoice.status === "partially_paid"
  const isOverdue = invoice.status === "overdue"
  const bizName = business?.trading_name ?? business?.legal_name ?? "Business"
  const brand = settings?.brand_color || "#0f172a"

  const effectiveBalanceDue = paymentSummary?.balanceDue ?? Number(invoice.total ?? 0)
  const badgeLabel =
    paymentSummary?.statusLabel ?? invoiceCustomerStatusLabel(invoice.status)

  // Status banner config
  const bannerClass = isPaid
    ? "bg-emerald-50 border-emerald-200"
    : isOverdue
    ? "bg-rose-50 border-rose-200"
      : isPartial
        ? "bg-amber-50 border-amber-200"
        : "bg-sky-50 border-sky-200"
  const bannerTextClass = isPaid
    ? "text-emerald-800"
    : isOverdue
      ? "text-rose-800"
      : isPartial
        ? "text-amber-900"
        : "text-sky-900"
  const bannerIcon = isPaid ? (
    <svg className="w-5 h-5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : isOverdue ? (
    <svg className="w-5 h-5 text-rose-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : isPartial ? (
    <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ) : (
    <svg className="w-5 h-5 text-sky-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

      <div className="min-h-screen bg-slate-50 py-5 px-4 print:bg-white print:py-0">
        <div className="max-w-3xl mx-auto space-y-3">

          {/* Client toolbar — minimal */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white/90 px-3 py-2.5 shadow-sm">
            <div className="flex items-center gap-2 min-w-0">
              {business?.logo_url ? (
                <img src={business.logo_url} alt="" className="h-8 w-8 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: brand }}>
                  {bizName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Invoice</p>
                <p className="text-sm font-semibold text-slate-800 truncate">{bizName}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
              <a
                href={`/api/invoices/public/${encodeURIComponent(token)}/pdf`}
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
              <button
                type="button"
                onClick={async () => {
                  try {
                    const url = typeof window !== "undefined" ? window.location.href : ""
                    await navigator.clipboard.writeText(url)
                    setLinkCopied(true)
                    setTimeout(() => setLinkCopied(false), 2000)
                  } catch {
                    /* ignore */
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {linkCopied ? "Copied" : "Copy invoice link"}
              </button>
              <a
                href="#invoice-doc"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                View invoice
              </a>
            </div>
          </div>

          {/* ── Status banner ──────────────────────────────── */}
          <div className={`no-print rounded-xl border p-3.5 flex items-center gap-3 ${bannerClass}`}>
            {bannerIcon}
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm ${bannerTextClass}`}>
                {isPaid ? (
                  "This invoice has been paid — thank you."
                ) : (
                  <>
                    <span>{badgeLabel}</span>
                    <span className="font-medium opacity-75"> · </span>
                    <span>invoice {invoice.invoice_number}</span>
                  </>
                )}
              </p>
              {!isPaid && invoice.due_date && (
                <p className={`text-xs mt-0.5 ${bannerTextClass} opacity-70`}>
                  Due {new Date(invoice.due_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-xs ${bannerTextClass} opacity-60`}>{isPaid ? "Amount paid" : "Balance due"}</p>
              <p className={`text-lg font-bold tabular-nums ${bannerTextClass}`}>
                {formatMoney(isPaid ? Number(invoice.total) : effectiveBalanceDue, invoice.currency_code)}
              </p>
            </div>
          </div>

          {/* ── Invoice document ───────────────────────────── */}
          {/* Bank/momo appear below totals; badges use sentence-case labels for customers */}
          <InvoiceDocument
            invoice={invoice}
            business={business}
            items={items}
            settings={settings}
            brandColor={brand}
            className="print:shadow-none print:border-0 print:rounded-none"
            documentDomId="invoice-doc"
            displayStatus={
              invoice.status === "sent" ? "payment_pending" :
              invoice.status === "overdue" ? "overdue" :
              invoice.status === "paid" ? "paid" :
              invoice.status === "partially_paid" ? "partially_paid" :
              undefined
            }
            statusBadgeLabel={badgeLabel}
            balanceDueHighlight={
              !isPaid && effectiveBalanceDue > 0.005
                ? {
                    balanceDue: effectiveBalanceDue,
                    currencyCode: invoice.currency_code,
                    dueDate: invoice.due_date,
                  }
                : undefined
            }
          />

          <p className="no-print text-center text-[11px] text-slate-300 pb-3">Powered by Finza</p>
        </div>
      </div>
    </>
  )
}
