"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { useParams } from "next/navigation"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import { formatMoney } from "@/lib/money"
import { getTaxLinesForDisplay } from "@/lib/taxes/readTaxLines"
import { normalizeCountry } from "@/lib/payments/eligibility"

type InvoiceCustomer = {
  id?: string
  name: string
  email?: string | null
  phone?: string | null
  whatsapp_phone?: string | null
  tin?: string | null
  address?: string | null
}

type InvoiceDoc = {
  id: string
  invoice_number: string
  issue_date?: string | null
  due_date?: string | null
  payment_terms?: string | null
  notes?: string | null
  footer_message?: string | null
  currency_code: string | null
  currency_symbol?: string | null
  subtotal?: number | null
  nhil?: number | null
  getfund?: number | null
  covid?: number | null
  vat?: number | null
  total_tax?: number | null
  total: number
  apply_taxes?: boolean | null
  tax_lines?: unknown | null
  wht_receivable_applicable?: boolean | null
  wht_receivable_rate?: number | null
  wht_receivable_amount?: number | null
  customers: InvoiceCustomer | null
}

type InvoiceItemRow = {
  id: string
  description: string | null
  qty: number
  unit_price: number
  discount_amount?: number | null
  line_subtotal?: number | null
  products_services?: { name?: string | null } | null
}

type Payment = {
  id: string
  amount: number
  wht_amount?: number | null
  date: string
  method: string
  reference: string | null
  notes: string | null
  public_token?: string | null
  invoices: InvoiceDoc | null
}

type Business = {
  legal_name: string | null
  trading_name: string | null
  name?: string | null
  address_street: string | null
  address_city: string | null
  address_region: string | null
  address_country: string | null
  address?: string | null
  phone: string | null
  whatsapp_phone: string | null
  email: string | null
  website: string | null
  tin: string | null
  logo_url: string | null
}

export default function PublicReceiptPage() {
  const params = useParams()
  const token = params.token as string
  const [loading, setLoading] = useState(true)
  const [payment, setPayment] = useState<Payment | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [remainingBalance, setRemainingBalance] = useState(0)
  const [totalPaid, setTotalPaid] = useState(0)
  const [totalCredits, setTotalCredits] = useState(0)
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItemRow[]>([])
  const [error, setError] = useState("")
  const [savePdfIntent, setSavePdfIntent] = useState(false)
  const savePdfPrintDone = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    setSavePdfIntent(new URLSearchParams(window.location.search).get("savePdf") === "1")
  }, [])

  useEffect(() => {
    loadReceipt()
  }, [token])

  /** Open system print dialog (user chooses “Save as PDF”) — triggered from ?savePdf=1 after data loads. */
  useEffect(() => {
    if (!savePdfIntent || loading || error || !payment || savePdfPrintDone.current) return
    savePdfPrintDone.current = true
    const t = window.setTimeout(() => {
      window.print()
    }, 450)
    return () => window.clearTimeout(t)
  }, [savePdfIntent, loading, error, payment])

  /** Print/PDF: scoped global rules so layout + type actually apply (Tailwind print: alone was easy to miss in PDF). */
  useEffect(() => {
    const STYLE_ID = "finza-public-receipt-print"
    const css = `
@media print {
  /* 210mm − 10mm left − 10mm right = 190mm printable column */
  @page { size: A4; margin: 8mm 10mm; }
  html.finza-receipt-print-root,
  html.finza-receipt-print-root body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    width: 100% !important;
  }
  html.finza-receipt-print-root .receipt-root {
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    min-height: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    align-items: center !important;
    justify-content: flex-start !important;
    font-size: 13.25px !important;
    line-height: 1.4 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  html.finza-receipt-print-root .receipt-print-wrap {
    width: 190mm !important;
    max-width: 190mm !important;
    margin-left: auto !important;
    margin-right: auto !important;
    padding: 0 !important;
    box-sizing: border-box !important;
  }
  html.finza-receipt-print-root .receipt-print-sheet {
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    border-radius: 2px !important;
    box-shadow: none !important;
  }
  html.finza-receipt-print-root .receipt-print-table {
    font-size: 12px !important;
    line-height: 1.38 !important;
  }
  html.finza-receipt-print-root .receipt-avoid-break {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`
    document.documentElement.classList.add("finza-receipt-print-root")
    const existing = document.getElementById(STYLE_ID)
    if (existing) existing.remove()
    const el = document.createElement("style")
    el.id = STYLE_ID
    el.textContent = css
    document.head.appendChild(el)
    return () => {
      document.documentElement.classList.remove("finza-receipt-print-root")
      document.getElementById(STYLE_ID)?.remove()
    }
  }, [])

  const loadReceipt = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/receipts/public/${token}`)

      if (!response.ok) {
        throw new Error("Receipt not found")
      }

      const data = await response.json()
      setPayment(data.payment)
      setBusiness(data.business)
      setRemainingBalance(data.remainingBalance || 0)
      setTotalPaid(typeof data.totalPaid === "number" ? data.totalPaid : 0)
      setTotalCredits(typeof data.totalCredits === "number" ? data.totalCredits : 0)
      setInvoiceItems(Array.isArray(data.invoiceItems) ? data.invoiceItems : [])
      setLoading(false)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load receipt")
      setLoading(false)
    }
  }

  const invoice = payment?.invoices ?? null
  const currencyCode = invoice?.currency_code || null

  const businessCountry = business?.address_country ?? null
  const countryCode = normalizeCountry(businessCountry)

  const lineItemsDiscountTotal = useMemo(
    () => invoiceItems.reduce((s, item) => s + Number(item.discount_amount || 0), 0),
    [invoiceItems]
  )
  const lineItemsGross = useMemo(
    () => invoiceItems.reduce((s, item) => s + Number(item.qty) * Number(item.unit_price), 0),
    [invoiceItems]
  )
  const showLineDiscountSummary = lineItemsDiscountTotal > 0.005

  const taxDisplayLines = useMemo(() => {
    if (!invoice?.apply_taxes) return []
    let lines = getTaxLinesForDisplay(invoice.tax_lines)
    if (lines.length === 0 && !invoice.tax_lines) {
      const legacy = { NHIL: invoice.nhil, GETFUND: invoice.getfund, VAT: invoice.vat }
      lines = Object.entries(legacy)
        .filter(([, v]) => Number(v) > 0)
        .map(([code, amount]) => ({ code, amount: Number(amount) }))
    }
    const isGhana = countryCode === "GH"
    return isGhana ? lines : lines.filter((l) => l.code === "VAT")
  }, [invoice, countryCode])

  const formatMethod = (method: string) => {
    const methods: Record<string, string> = {
      cash: "Cash",
      bank: "Bank Transfer",
      momo: "Mobile Money",
      card: "Card Payment",
      cheque: "Cheque",
      paystack: "Paystack",
      customer_credit: "Customer credit",
      other: "Other",
    }
    return methods[method] || method
  }

  const receiptRefLabel = payment?.public_token
    ? `${String(payment.public_token).slice(0, 8)}…${String(payment.public_token).slice(-5)}`
    : "—"

  const paidInFull = remainingBalance <= 0.005

  const whtThisPayment = payment ? Math.max(0, Number(payment.wht_amount ?? 0)) : 0
  const showWhtOnReceipt = whtThisPayment > 0.005
  const cashReceivedThisPayment = payment ? Number(payment.amount) - whtThisPayment : 0
  const whtWithheldLabel =
    invoice?.wht_receivable_applicable && Number(invoice.wht_receivable_rate ?? 0) > 0
      ? `Less WHT (${(Number(invoice.wht_receivable_rate) * 100).toFixed(0)}% withheld by customer)`
      : "Less WHT withheld"

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center print:bg-white">
        <div className="text-center text-sm text-slate-600">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-800 mx-auto" />
          <p className="mt-2">Loading receipt…</p>
        </div>
      </div>
    )
  }

  if (error || !payment || !invoice) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center print:bg-white">
        <div className="text-center px-4 text-sm">
          <p className="text-red-600">{error || "Receipt not found"}</p>
        </div>
      </div>
    )
  }

  const businessName = business?.trading_name || business?.legal_name || business?.name || "Supplier"
  const businessAddress =
    [business?.address_street, business?.address_city, business?.address_region, business?.address_country]
      .filter(Boolean)
      .join(", ") ||
    business?.address ||
    ""

  return (
    <>
      <div className="receipt-root flex min-h-screen w-full flex-col items-center bg-slate-100 py-4 px-3 sm:py-6 sm:px-5 print:min-h-0 print:flex print:flex-col print:items-center print:justify-start print:py-0 print:px-0 print:bg-white text-[13px] leading-snug sm:text-sm sm:leading-normal">
        <div className="receipt-print-wrap w-full max-w-6xl print:w-[190mm] print:max-w-[190mm] print:mx-auto print:px-0 print:pb-0">
          <div className="mb-2 flex w-full flex-col items-end gap-2 print:hidden">
            {savePdfIntent ? (
              <p className="max-w-md text-right text-[11px] text-slate-600 leading-snug">
                To download: when the print dialog opens, choose <span className="font-semibold text-slate-800">Save as PDF</span>{" "}
                (or your browser&apos;s equivalent) as the destination.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => window.print()}
              className="text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded px-3 py-1.5 hover:bg-slate-50 shadow-sm"
            >
              Print / Save as PDF
            </button>
          </div>

          <article className="receipt-print-sheet w-full bg-white shadow-md border border-slate-200 print:mx-0 print:w-full print:max-w-none print:shadow-none print:rounded-md print:border print:border-slate-300 receipt-avoid-break">
          {/* Compact header: supplier | customer | refs + status */}
          <header className="border-b border-slate-200 px-3 pt-2 pb-1.5 sm:px-4 print:px-6 print:pt-3 print:pb-2.5 receipt-avoid-break">
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-12 lg:gap-x-2 lg:gap-y-0 items-start print:gap-x-3 print:gap-y-2.5">
              {/* self-start + h-fit: never stretch to match taller right columns */}
              <div className="lg:col-span-5 flex items-start gap-1.5 min-w-0 self-start h-fit">
                <BusinessLogoDisplay
                  logoUrl={business?.logo_url}
                  businessName={businessName}
                  variant="compact"
                  rounded="lg"
                  brandingResolved
                />
                <div className="min-w-0 pt-0.5">
                  <p className="text-[8px] font-bold uppercase tracking-wider text-emerald-800 leading-none print:text-[9px] print:tracking-wide">
                    Payment receipt
                  </p>
                  <h1 className="text-sm sm:text-base print:text-lg font-bold text-slate-900 leading-snug mt-0.5 print:mt-1">
                    {businessName}
                  </h1>
                  {businessAddress ? (
                    <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-2 print:line-clamp-none leading-snug print:text-[11px] print:mt-1">
                      {businessAddress}
                    </p>
                  ) : null}
                  <dl className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0 text-[9px] text-slate-600 leading-tight print:text-[10px] print:mt-1 print:gap-x-2.5">
                    {business?.tin ? (
                      <div>
                        <span className="text-slate-500">TIN </span>
                        <span className="font-medium text-slate-800">{business.tin}</span>
                      </div>
                    ) : null}
                    {business?.phone ? (
                      <div>
                        <span className="text-slate-500">Tel </span>
                        <span className="font-medium text-slate-800">{business.phone}</span>
                      </div>
                    ) : null}
                    {business?.email ? (
                      <div className="min-w-0 max-w-full truncate" title={business.email}>
                        <span className="text-slate-500">Email </span>
                        <span className="font-medium text-slate-800">{business.email}</span>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </div>

              <div className="lg:col-span-3 rounded border border-slate-200 bg-slate-50/80 px-2 py-1 self-start h-fit leading-tight print:px-2.5 print:py-1.5">
                <p className="text-[8px] font-bold uppercase text-slate-500 leading-none print:text-[9px]">Bill to</p>
                <p className="text-xs font-semibold text-slate-900 leading-tight mt-0.5 print:text-sm print:mt-1">
                  {invoice.customers?.name || "Customer"}
                </p>
                {invoice.customers?.tin ? (
                  <p className="text-[9px] text-slate-600 mt-0.5 leading-tight print:text-[10px] print:mt-1">
                    <span className="text-slate-500">TIN</span> {invoice.customers.tin}
                  </p>
                ) : null}
                {invoice.customers?.address ? (
                  <p className="text-[9px] text-slate-600 mt-0.5 line-clamp-2 leading-snug print:text-[10px] print:mt-1">
                    {invoice.customers.address}
                  </p>
                ) : null}
                <div className="mt-0.5 text-[9px] text-slate-600 space-y-0 leading-tight print:text-[10px] print:mt-1 print:space-y-0.5">
                  {invoice.customers?.email ? <p className="truncate">{invoice.customers.email}</p> : null}
                  {invoice.customers?.phone ? <p>{invoice.customers.phone}</p> : null}
                </div>
              </div>

              <div className="lg:col-span-4 grid grid-cols-2 gap-1.5 sm:grid-cols-1 self-start h-fit items-start print:gap-2">
                <div className="rounded border border-slate-200 px-2 py-1 col-span-2 sm:col-span-1 leading-tight print:px-2.5 print:py-1.5">
                  <p className="text-[8px] font-semibold uppercase text-slate-500 leading-none print:text-[9px]">Invoice</p>
                  <p className="text-xs font-bold text-slate-900 mt-0.5 print:text-sm print:mt-1">#{invoice.invoice_number}</p>
                  <p
                    className="text-[8px] text-slate-500 mt-0.5 font-mono break-all leading-tight print:text-[9px] print:mt-1"
                    title={payment.public_token || undefined}
                  >
                    Ref {receiptRefLabel}
                  </p>
                  {invoice.issue_date ? (
                    <p className="text-[9px] text-slate-500 mt-0.5 leading-tight print:text-[10px] print:mt-1">
                      Dated {new Date(invoice.issue_date).toLocaleDateString("en-GH")}
                    </p>
                  ) : null}
                  {invoice.due_date ? (
                    <p className="text-[9px] text-slate-500 leading-tight print:text-[10px] print:mt-0.5">
                      Due {new Date(invoice.due_date).toLocaleDateString("en-GH")}
                    </p>
                  ) : null}
                </div>
                <div
                  className={`rounded border border-slate-200 bg-slate-50/90 px-2 py-1 flex flex-col justify-start col-span-2 sm:col-span-1 leading-tight print:px-2.5 print:py-1.5 border-l-[3px] ${
                    paidInFull ? "border-l-emerald-700" : "border-l-amber-600"
                  }`}
                >
                  <p className="text-[8px] font-bold uppercase text-slate-600 leading-none print:text-[9px]">Status</p>
                  <p
                    className={`text-[11px] font-bold leading-tight mt-0.5 print:text-xs print:mt-1 ${paidInFull ? "text-emerald-800" : "text-amber-800"}`}
                  >
                    {paidInFull ? "PAID IN FULL" : "PARTIAL PAYMENT"}
                  </p>
                  {!paidInFull ? (
                    <p className="text-[9px] font-semibold text-slate-800 mt-0.5 leading-tight print:text-[10px] print:mt-1">
                      Balance {formatMoney(remainingBalance, currencyCode)}
                    </p>
                  ) : (
                    <p className="text-[9px] text-slate-600 mt-0.5 leading-tight print:text-[10px] print:mt-1">No balance due.</p>
                  )}
                </div>
              </div>
            </div>
          </header>

          <div className="px-3 py-2 space-y-2 sm:px-4 sm:py-2.5 print:px-6 print:py-2.5 print:space-y-2">
            {/* Payment summary strip */}
            <section className="receipt-avoid-break rounded border border-slate-200 bg-white px-2 py-1.5 print:px-3 print:py-2 border-l-[3px] border-l-emerald-800/85">
              <p className="text-[9px] font-bold uppercase text-slate-800 mb-1 print:text-[10px] print:mb-1.5 print:tracking-wide">
                Payment confirmation
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-2 gap-y-1 text-[11px] print:gap-x-2.5 print:gap-y-1.5 print:text-xs">
                <div className="flex flex-col min-w-0">
                  <span className="text-slate-500 truncate">
                    {showWhtOnReceipt ? "Settlement this payment" : "This payment"}
                  </span>
                  <span className="font-bold text-slate-900 tabular-nums">{formatMoney(Number(payment.amount), currencyCode)}</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-slate-500 truncate">Total paid</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(totalPaid, currencyCode)}</span>
                </div>
                {totalCredits > 0 ? (
                  <div className="flex flex-col min-w-0">
                    <span className="text-slate-500 truncate">Credits</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(totalCredits, currencyCode)}</span>
                  </div>
                ) : null}
                <div className="flex flex-col min-w-0">
                  <span className="text-slate-500 truncate">Invoice total</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{formatMoney(Number(invoice.total), currencyCode)}</span>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-slate-500 truncate">Outstanding</span>
                  <span className="font-bold text-slate-900 tabular-nums">{formatMoney(remainingBalance, currencyCode)}</span>
                </div>
                <div className="flex flex-col min-w-0 col-span-2 sm:col-span-1 lg:col-span-1">
                  <span className="text-slate-500 truncate">Date / method</span>
                  <span className="font-medium text-slate-900 text-[10px] leading-tight print:text-[11px]">
                    {new Date(payment.date).toLocaleDateString("en-GH")} · {formatMethod(payment.method)}
                  </span>
                  {payment.reference ? (
                    <span
                      className="font-mono text-[9px] text-slate-700 break-all mt-0.5 print:text-[10px] print:mt-1"
                      title={payment.reference}
                    >
                      {payment.reference}
                    </span>
                  ) : null}
                </div>
              </div>
              {showWhtOnReceipt ? (
                <div className="mt-1.5 space-y-1 border-t border-slate-200/90 pt-1.5 text-[11px] print:mt-2 print:space-y-1 print:border-slate-200 print:pt-2 print:text-xs receipt-avoid-break">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="text-slate-600">{whtWithheldLabel}</span>
                    <span className="font-semibold text-amber-900 tabular-nums">−{formatMoney(whtThisPayment, currencyCode)}</span>
                  </div>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-medium text-slate-800">Cash received</span>
                    <span className="font-bold text-slate-900 tabular-nums">{formatMoney(cashReceivedThisPayment, currencyCode)}</span>
                  </div>
                </div>
              ) : null}
              {payment.method === "momo" ? (
                <p className="text-[9px] text-slate-600 mt-1 leading-tight print:text-[10px] print:mt-1.5 border-t border-slate-200/80 pt-1.5 print:pt-2">
                  E-Levy (1.5%) may apply to mobile money per network rules.
                </p>
              ) : null}
            </section>

            {/* Line items + taxes (same data, denser table) */}
            <section className="receipt-avoid-break">
              <div className="flex items-baseline justify-between border-b border-slate-200 pb-1 mb-1 print:pb-1.5 print:mb-1.5">
                <h2 className="text-[10px] font-bold text-slate-600 uppercase tracking-wide print:text-[11px] print:tracking-wider">
                  Invoice detail
                </h2>
                {invoice.payment_terms ? (
                  <span className="text-[9px] text-slate-500 truncate max-w-[50%] print:text-[10px]">{invoice.payment_terms}</span>
                ) : null}
              </div>

              <div className="overflow-x-auto rounded border border-slate-200 print:rounded-md">
                <table className="receipt-print-table w-full text-[11px] print:text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium print:px-2.5 print:py-2">Description</th>
                      <th className="px-1 py-1.5 text-center font-medium w-12 print:px-1.5 print:py-2">Qty</th>
                      <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap print:px-2.5 print:py-2">Unit</th>
                      <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap print:px-2.5 print:py-2">Disc.</th>
                      <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap print:px-2.5 print:py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoiceItems.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-2 py-2 text-center text-slate-500 print:py-2.5">
                          No line items on file.
                        </td>
                      </tr>
                    ) : (
                      invoiceItems.map((item) => {
                        const productName = item.products_services?.name
                        const lineTotal =
                          item.line_subtotal != null
                            ? Number(item.line_subtotal)
                            : Number(item.qty) * Number(item.unit_price) - Number(item.discount_amount || 0)
                        return (
                          <tr key={item.id} className="align-top">
                            <td className="px-2 py-1 text-slate-900 print:px-2.5 print:py-1.5">
                              <div className="font-medium leading-tight print:leading-snug">{productName || item.description || "Item"}</div>
                              {productName && item.description && item.description !== productName ? (
                                <div className="text-[10px] text-slate-500 leading-tight print:text-[11px] print:mt-0.5">
                                  {item.description}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-1 py-1 text-center text-slate-700 tabular-nums print:px-1.5 print:py-1.5">
                              {item.qty}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-700 tabular-nums whitespace-nowrap print:px-2.5 print:py-1.5">
                              {formatMoney(Number(item.unit_price), currencyCode)}
                            </td>
                            <td className="px-2 py-1 text-right text-slate-700 tabular-nums whitespace-nowrap print:px-2.5 print:py-1.5">
                              {Number(item.discount_amount) > 0 ? formatMoney(Number(item.discount_amount), currencyCode) : "—"}
                            </td>
                            <td className="px-2 py-1 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap print:px-2.5 print:py-1.5">
                              {formatMoney(lineTotal, currencyCode)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                  <tfoot className="bg-slate-50/90 border-t border-slate-200">
                    {invoice.apply_taxes ? (
                      <>
                        {showLineDiscountSummary ? (
                          <>
                            <tr>
                              <td
                                colSpan={4}
                                className="px-2 pt-1.5 text-right text-[10px] uppercase font-medium text-slate-500 print:pt-2 print:text-[11px]"
                              >
                                Gross
                              </td>
                              <td className="px-2 pt-1.5 text-right font-medium text-slate-900 tabular-nums print:pt-2">
                                {formatMoney(lineItemsGross, currencyCode)}
                              </td>
                            </tr>
                            <tr>
                              <td
                                colSpan={4}
                                className="px-2 py-0.5 text-right text-[10px] uppercase font-medium text-slate-500 print:py-1 print:text-[11px]"
                              >
                                Discount
                              </td>
                              <td className="px-2 py-0.5 text-right font-medium text-rose-600 tabular-nums print:py-1">
                                −{formatMoney(lineItemsDiscountTotal, currencyCode)}
                              </td>
                            </tr>
                          </>
                        ) : null}
                        <tr>
                          <td
                            colSpan={4}
                            className={`px-2 ${showLineDiscountSummary ? "py-0.5 print:py-1" : "pt-1.5 print:pt-2"} text-right text-[10px] uppercase font-medium text-slate-500 print:text-[11px]`}
                          >
                            {showLineDiscountSummary ? "Subtotal (excl. tax)" : "Subtotal"}
                          </td>
                          <td
                            className={`px-2 ${showLineDiscountSummary ? "py-0.5 print:py-1" : "pt-1.5 print:pt-2"} text-right font-semibold text-slate-900 tabular-nums`}
                          >
                            {formatMoney(Number(invoice.subtotal ?? invoice.total), currencyCode)}
                          </td>
                        </tr>
                        {taxDisplayLines.map((tax) => (
                          <tr key={tax.code}>
                            <td
                              colSpan={4}
                              className="px-2 py-0.5 text-right text-[10px] uppercase font-medium text-slate-500 print:py-1 print:text-[11px]"
                            >
                              {tax.code}
                            </td>
                            <td className="px-2 py-0.5 text-right text-slate-800 tabular-nums print:py-1">
                              {formatMoney(Number(tax.amount), currencyCode)}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td
                            colSpan={4}
                            className="px-2 py-1.5 text-right text-[11px] font-bold text-slate-900 uppercase print:py-2 print:text-xs print:tracking-wide"
                          >
                            Invoice total
                          </td>
                          <td className="px-2 py-1.5 text-right text-sm font-bold border-t border-slate-200 tabular-nums print:py-2 print:text-base">
                            {formatMoney(Number(invoice.total), currencyCode)}
                          </td>
                        </tr>
                      </>
                    ) : (
                      <>
                        {showLineDiscountSummary ? (
                          <>
                            <tr>
                              <td
                                colSpan={4}
                                className="px-2 pt-1.5 text-right text-[10px] uppercase font-medium text-slate-500 print:pt-2 print:text-[11px]"
                              >
                                Gross
                              </td>
                              <td className="px-2 pt-1.5 text-right font-medium text-slate-900 tabular-nums print:pt-2">
                                {formatMoney(lineItemsGross, currencyCode)}
                              </td>
                            </tr>
                            <tr>
                              <td
                                colSpan={4}
                                className="px-2 py-0.5 text-right text-[10px] uppercase font-medium text-slate-500 print:py-1 print:text-[11px]"
                              >
                                Discount
                              </td>
                              <td className="px-2 py-0.5 text-right font-medium text-rose-600 tabular-nums print:py-1">
                                −{formatMoney(lineItemsDiscountTotal, currencyCode)}
                              </td>
                            </tr>
                          </>
                        ) : null}
                        <tr>
                          <td
                            colSpan={4}
                            className="px-2 py-1.5 text-right text-[11px] font-bold text-slate-900 uppercase print:py-2 print:text-xs print:tracking-wide"
                          >
                            Invoice total
                          </td>
                          <td className="px-2 py-1.5 text-right text-sm font-bold border-t border-slate-200 tabular-nums print:py-2 print:text-base">
                            {formatMoney(Number(invoice.total), currencyCode)}
                          </td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                </table>
              </div>
            </section>

            {payment.notes ? (
              <section className="rounded border border-slate-200 bg-slate-50/60 px-2 py-1 print:px-2.5 print:py-1.5">
                <h3 className="text-[9px] font-bold uppercase text-slate-500 print:text-[10px]">Payment notes</h3>
                <p className="text-[11px] text-slate-800 whitespace-pre-wrap leading-snug print:text-xs print:mt-1 print:leading-snug">
                  {payment.notes}
                </p>
              </section>
            ) : null}

            {invoice.notes ? (
              <section className="rounded border border-slate-100 px-2 py-1 print:px-2.5 print:py-1.5">
                <h3 className="text-[9px] font-bold uppercase text-slate-500 print:text-[10px]">Invoice notes</h3>
                <p className="text-[11px] text-slate-700 whitespace-pre-wrap leading-snug print:text-xs print:mt-1 print:leading-snug">
                  {invoice.notes}
                </p>
              </section>
            ) : null}

            <footer className="border-t border-slate-200 pt-2 text-center text-[10px] text-slate-600 print:pt-2.5 print:pb-0.5 print:text-[11px]">
              {invoice.footer_message ? (
                <p className="whitespace-pre-wrap mb-1 text-slate-700 leading-snug print:mb-1.5 print:text-[11px] print:leading-snug">
                  {invoice.footer_message}
                </p>
              ) : null}
              <p className="leading-tight">
                Payment receipt for invoice #{invoice.invoice_number}. Not a new tax invoice.
              </p>
            </footer>
          </div>
        </article>
        </div>
      </div>
    </>
  )
}
