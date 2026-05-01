"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { StatusBadge } from "@/components/ui/StatusBadge"
import { formatMoney } from "@/lib/money"
import {
  ManualInvoicePaymentDetails,
  type InvoiceManualPaymentDetailsProps,
} from "@/components/invoices/ManualInvoicePaymentDetails"

type Business = {
  id: string
  name: string
  address_country: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
}

type Customer = {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
}

type Invoice = {
  id: string
  public_token?: string | null
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
  tax_lines: any
  wht_receivable_applicable?: boolean | null
  wht_receivable_rate?: number | null
  wht_receivable_amount?: number | null
  customers: Customer | null
  businesses: Business | null
}

type LineItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

type Payment = {
  id: string
  amount: number
  wht_amount?: number | null
  date: string
  method: string
  notes: string | null
  reference: string | null
}

type ManualWalletPayment = {
  provider_type: "manual_wallet"
  network: string | null
  account_name: string | null
  wallet_number: string | null
  instructions: string | null
  display_label: string | null
}

const PAY_LINK_UNAVAILABLE =
  "This payment link is no longer available. Please use the invoice link sent by the business."

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "Mobile Money",
  card: "Card",
  bank: "Bank Transfer",
  cheque: "Cheque",
  paystack: "Paystack",
  other: "Other",
}

function fmtDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

export default function InvoiceViewPage() {
  const params    = useParams()
  const router    = useRouter()
  const searchParams = useSearchParams()
  const invoiceId = (params?.invoiceId as string) || ""
  const publicToken = (searchParams.get("token") ?? "").trim()

  const [invoice,  setInvoice]  = useState<Invoice | null>(null)
  const [items,    setItems]    = useState<LineItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [remaining, setRemaining] = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [linkUnavailable, setLinkUnavailable] = useState(false)
  const [manualWalletPayment, setManualWalletPayment] = useState<ManualWalletPayment | null>(null)
  const [tenantOnlinePay, setTenantOnlinePay] = useState(false)
  const [invoiceSettingsPublic, setInvoiceSettingsPublic] = useState<InvoiceManualPaymentDetailsProps | null>(null)

  useEffect(() => {
    if (!invoiceId) return
    if (!publicToken) {
      setLinkUnavailable(false)
      return
    }

    let cancelled = false
    const run = async () => {
      setLoading(true)
      setLinkUnavailable(false)
      try {
        const r = await fetch(
          `/api/public/invoice/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(publicToken)}`
        )
        if (!r.ok || cancelled) {
          if (!cancelled) {
            setInvoice(null)
            setLinkUnavailable(true)
          }
          return
        }
        const data = await r.json()
        if (cancelled) return
        if (!data.invoice) {
          setInvoice(null)
          setLinkUnavailable(true)
          return
        }

        if (data.tenant_invoice_online_payments_enabled !== true) {
          router.replace(`/invoice-public/${encodeURIComponent(publicToken)}`)
          return
        }

        setInvoice(data.invoice)
        setItems(data.items || [])
        setPayments(data.payments || [])
        setRemaining(data.remaining ?? Number(data.invoice?.total ?? 0))
        setManualWalletPayment(data.manual_wallet_payment ?? null)
        setTenantOnlinePay(data.tenant_invoice_online_payments_enabled === true)
        setInvoiceSettingsPublic(data.invoice_settings_public ?? null)
      } catch {
        if (!cancelled) {
          setInvoice(null)
          setLinkUnavailable(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [invoiceId, publicToken, router])

  if (loading && publicToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  if (!publicToken || linkUnavailable) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <p className="text-gray-800 text-sm leading-relaxed">{PAY_LINK_UNAVAILABLE}</p>
        </div>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
          <p className="text-gray-800 text-sm leading-relaxed">{PAY_LINK_UNAVAILABLE}</p>
        </div>
      </div>
    )
  }

  const business = invoice.businesses
  const customer = invoice.customers
  const isPaid   = invoice.status === "paid"
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)

  const whtApplicable = Boolean(invoice.wht_receivable_applicable)
  const whtAmount = Number(invoice.wht_receivable_amount || 0)
  const whtRate = Number(invoice.wht_receivable_rate || 0)
  const showWhtSummary = whtApplicable && whtAmount > 0
  const invoiceTotal = Number(invoice.total)
  const netPayable = showWhtSummary ? Math.round((invoiceTotal - whtAmount) * 100) / 100 : invoiceTotal
  const whtLineLabel =
    whtRate > 0
      ? `Less WHT (${(whtRate * 100).toFixed(0)}% withheld by customer)`
      : "Less WHT (withheld by customer)"

  // Tax breakdown lines (new tax engine)
  const taxLines: { name: string; amount: number }[] = []
  if (invoice.apply_taxes && invoice.tax_lines?.lines) {
    invoice.tax_lines.lines.forEach((l: any) => {
      if (l.amount > 0) taxLines.push({ name: l.name || l.code, amount: l.amount })
    })
  } else if (invoice.apply_taxes) {
    // Legacy Ghana tax columns
    if (Number(invoice.nhil)    > 0) taxLines.push({ name: "NHIL (2.5%)",      amount: invoice.nhil })
    if (Number(invoice.getfund) > 0) taxLines.push({ name: "GETFund (2.5%)",   amount: invoice.getfund })
    if (Number(invoice.covid)   > 0) taxLines.push({ name: "COVID-19 (1%)",    amount: invoice.covid })
    if (Number(invoice.vat)     > 0) taxLines.push({ name: "VAT (15%)",        amount: invoice.vat })
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 print:bg-white print:py-0">
      <div className="max-w-3xl mx-auto">

        {/* Top action bar — hidden when printing */}
        <div className="flex items-center justify-between mb-5 print:hidden">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-gray-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>
            {!isPaid && remaining > 0 && invoice.public_token && (
              <a
                href={`/invoice-public/${encodeURIComponent(invoice.public_token)}`}
                className="flex items-center gap-1.5 text-sm border border-slate-300 bg-white rounded-lg px-4 py-1.5 hover:bg-slate-50 font-medium text-slate-800"
              >
                Open full invoice
              </a>
            )}
          </div>
        </div>

        {/* Invoice document */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden print:shadow-none print:border-none print:rounded-none">

          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-gray-100">
            <div className="flex items-start justify-between">
              {/* Business */}
              <div>
                {business?.logo_url && (
                  <img src={business.logo_url} alt={business.name} className="h-12 object-contain mb-3" />
                )}
                <h2 className="text-xl font-bold text-gray-900">{business?.name || "—"}</h2>
                {business?.address && <p className="text-sm text-gray-500 mt-0.5">{business.address}</p>}
                {business?.phone   && <p className="text-sm text-gray-500">{business.phone}</p>}
                {business?.email   && <p className="text-sm text-gray-500">{business.email}</p>}
              </div>
              {/* Invoice title + status */}
              <div className="text-right">
                <p className="text-3xl font-extrabold text-gray-900 tracking-tight">INVOICE</p>
                <p className="text-lg font-semibold text-gray-600 mt-0.5">#{invoice.invoice_number}</p>
                <div className="mt-2 flex justify-end">
                  <StatusBadge status={invoice.status as any} />
                </div>
              </div>
            </div>
          </div>

          {/* Meta row */}
          <div className="px-8 py-5 bg-gray-50 border-b border-gray-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500 uppercase text-xs tracking-wide font-medium mb-0.5">Issue Date</p>
              <p className="font-semibold text-gray-800">{fmtDate(invoice.issue_date)}</p>
            </div>
            <div>
              <p className="text-gray-500 uppercase text-xs tracking-wide font-medium mb-0.5">Due Date</p>
              <p className={`font-semibold ${!isPaid && invoice.due_date && new Date(invoice.due_date) < new Date() ? "text-red-600" : "text-gray-800"}`}>
                {fmtDate(invoice.due_date)}
              </p>
            </div>
            <div>
              <p className="text-gray-500 uppercase text-xs tracking-wide font-medium mb-0.5">Terms</p>
              <p className="font-semibold text-gray-800">{invoice.payment_terms || "—"}</p>
            </div>
            <div>
              <p className="text-gray-500 uppercase text-xs tracking-wide font-medium mb-0.5">Currency</p>
              <p className="font-semibold text-gray-800">{invoice.currency_code}</p>
            </div>
          </div>

          {/* Bill to */}
          <div className="px-8 py-5 border-b border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Bill To</p>
            {customer ? (
              <div className="text-sm">
                <p className="font-semibold text-gray-900 text-base">{customer.name}</p>
                {customer.address && <p className="text-gray-500 mt-0.5">{customer.address}</p>}
                {customer.email   && <p className="text-gray-500">{customer.email}</p>}
                {customer.phone   && <p className="text-gray-500">{customer.phone}</p>}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">No customer</p>
            )}
          </div>

          {/* Line items */}
          <div className="px-8 py-5 border-b border-gray-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3">Description</th>
                  <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-16">Qty</th>
                  <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-24">Unit Price</th>
                  <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-24">Discount</th>
                  <th className="text-right py-2 text-xs font-semibold uppercase tracking-wide text-gray-400 pb-3 w-28">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id}>
                    <td className="py-3 text-gray-800 font-medium">{item.description}</td>
                    <td className="py-3 text-right text-gray-600 tabular-nums">{Number(item.qty)}</td>
                    <td className="py-3 text-right text-gray-600 tabular-nums">{formatMoney(item.unit_price, invoice.currency_code)}</td>
                    <td className="py-3 text-right text-gray-600 tabular-nums">
                      {Number(item.discount_amount) > 0 ? formatMoney(item.discount_amount, invoice.currency_code) : "—"}
                    </td>
                    <td className="py-3 text-right text-gray-800 font-medium tabular-nums">
                      {formatMoney(item.line_subtotal ?? (item.qty * item.unit_price - (item.discount_amount || 0)), invoice.currency_code)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="px-8 py-5 border-b border-gray-100">
            <div className="max-w-xs ml-auto space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span className="tabular-nums font-medium">{formatMoney(invoice.subtotal, invoice.currency_code)}</span>
              </div>

              {taxLines.map((t, i) => (
                <div key={i} className="flex justify-between text-gray-500">
                  <span>{t.name}</span>
                  <span className="tabular-nums">{formatMoney(t.amount, invoice.currency_code)}</span>
                </div>
              ))}

              {invoice.apply_taxes && Number(invoice.total_tax) > 0 && taxLines.length > 1 && (
                <div className="flex justify-between text-gray-500 pt-1 border-t border-gray-100">
                  <span className="font-medium">Total Tax</span>
                  <span className="tabular-nums font-medium">{formatMoney(invoice.total_tax, invoice.currency_code)}</span>
                </div>
              )}

              {showWhtSummary ? (
                <>
                  <div className="flex justify-between items-center pt-2 border-t-2 border-gray-900">
                    <span className="font-bold text-gray-900 text-base">Total</span>
                    <span className="font-bold text-gray-900 text-lg tabular-nums">
                      {formatMoney(invoiceTotal, invoice.currency_code)}
                    </span>
                  </div>
                  <div className="flex justify-between text-amber-900 text-sm">
                    <span>{whtLineLabel}</span>
                    <span className="tabular-nums font-medium">({formatMoney(whtAmount, invoice.currency_code)})</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t-2 border-blue-900/70 text-blue-950">
                    <span className="font-bold text-base">Net payable to us</span>
                    <span className="font-bold text-lg tabular-nums">{formatMoney(netPayable, invoice.currency_code)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between items-center pt-2 border-t-2 border-gray-900">
                  <span className="font-bold text-gray-900 text-base">Total</span>
                  <span className="font-bold text-gray-900 text-lg tabular-nums">
                    {formatMoney(invoice.total, invoice.currency_code)}
                  </span>
                </div>
              )}

              {totalPaid > 0 && (
                <>
                  <div className="flex justify-between text-emerald-600">
                    <span>Amount Paid</span>
                    <span className="tabular-nums font-medium">− {formatMoney(totalPaid, invoice.currency_code)}</span>
                  </div>
                  <div className="flex justify-between items-center font-semibold text-gray-900">
                    <span>Balance Due</span>
                    <span className={`tabular-nums ${remaining > 0 ? "text-orange-600" : "text-emerald-600"}`}>
                      {remaining > 0 ? formatMoney(remaining, invoice.currency_code) : "Paid in Full"}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Payment history */}
          {payments.length > 0 && (
            <div className="px-8 py-5 border-b border-gray-100 bg-gray-50/60">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Payment History</p>
              <div className="space-y-2">
                {payments.map((p) => {
                  const wht = Number(p.wht_amount ?? 0) || 0
                  const applied = Number(p.amount ?? 0)
                  const cashReceived = Math.round((applied - wht) * 100) / 100
                  const showWhtBreakdown = wht > 0
                  return (
                    <div key={p.id} className="flex items-start justify-between gap-4 text-sm border-b border-gray-100 last:border-0 pb-3 last:pb-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-1.5" />
                        <div>
                          <span className="font-medium text-gray-800">{METHOD_LABELS[p.method] || p.method}</span>
                          {p.reference && <span className="text-gray-400 ml-2 text-xs">ref: {p.reference}</span>}
                          {p.notes && <p className="text-gray-400 text-xs">{p.notes}</p>}
                          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(p.date)}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        {showWhtBreakdown ? (
                          <>
                            <p className="text-xs text-gray-500">Applied to invoice</p>
                            <p className="font-semibold text-gray-900 tabular-nums">{formatMoney(applied, invoice.currency_code)}</p>
                            <p className="text-xs text-gray-500 pt-1">WHT withheld</p>
                            <p className="font-medium text-amber-700 tabular-nums">({formatMoney(wht, invoice.currency_code)})</p>
                            <p className="text-xs text-gray-500 pt-1">Cash / transfer received</p>
                            <p className="font-semibold text-emerald-600 tabular-nums">{formatMoney(cashReceived, invoice.currency_code)}</p>
                          </>
                        ) : (
                          <>
                            <p className="font-semibold text-emerald-600 tabular-nums">{formatMoney(applied, invoice.currency_code)}</p>
                            <p className="text-xs text-gray-400">{fmtDate(p.date)}</p>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bank / MoMo / manual wallet (public-safe) */}
          {!isPaid && remaining > 0 && (
            <div className="px-8 py-5 border-b border-gray-100 bg-white">
              <ManualInvoicePaymentDetails
                details={invoiceSettingsPublic}
                manualWallet={manualWalletPayment}
                showPayFallbackBanner={!tenantOnlinePay}
                payFallbackSubtitle={
                  !tenantOnlinePay
                    ? "Online payment is currently unavailable for this invoice. Please use the payment details provided by the business."
                    : ""
                }
                className="max-w-xl"
              />
            </div>
          )}

          {/* Notes */}
          {(invoice.notes || invoice.footer_message) && (
            <div className="px-8 py-5 space-y-3">
              {invoice.notes && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes</p>
                  <p className="text-sm text-gray-600 whitespace-pre-line">{invoice.notes}</p>
                </div>
              )}
              {invoice.footer_message && (
                <p className="text-xs text-gray-400 text-center pt-2 border-t border-gray-100">{invoice.footer_message}</p>
              )}
            </div>
          )}

        </div>

        {!isPaid && remaining > 0 && tenantOnlinePay && (
          <div className="mt-5 print:hidden">
            <a
              href={`/pay/${encodeURIComponent(invoiceId)}?token=${encodeURIComponent(publicToken)}`}
              className="flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Open payment page
            </a>
          </div>
        )}

        {isPaid && (
          <div className="mt-5 bg-emerald-50 border border-emerald-200 rounded-xl px-6 py-4 text-center text-emerald-800 font-medium text-sm print:hidden">
            ✓ This invoice has been paid in full
          </div>
        )}

        <p className="text-center text-xs text-gray-400 mt-6 print:hidden">
          Powered by <span className="font-semibold text-gray-500">Finza</span>
        </p>

      </div>
    </div>
  )
}
