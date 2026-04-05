"use client"

/**
 * Shared invoice document layout — matches the create invoice page design.
 * Used by the public invoice page (and can be used by preview when fed the same data).
 * Design tokens: slate palette, StatusBadge, same typography and spacing as app/invoices/new.
 */

import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import { StatusBadge } from "@/components/ui/StatusBadge"
import { formatMoney } from "@/lib/money"
import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"

export type InvoiceDocumentInvoice = {
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
  total_tax?: number | null
  total: number
  status: string
  apply_taxes: boolean
  tax_lines?: unknown
  nhil?: number
  getfund?: number
  vat?: number
  customers: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
  } | null
}

export type InvoiceDocumentBusiness = {
  legal_name: string | null
  trading_name: string | null
  address_street?: string | null
  address_city?: string | null
  address_region?: string | null
  address_country?: string | null
  address?: string | null
  phone: string | null
  email: string | null
  website: string | null
  tin: string | null
  logo_url: string | null
}

export type InvoiceDocumentItem = {
  description?: string | null
  qty?: number | null
  unit_price?: number | null
  discount_amount?: number | null
  line_subtotal?: number | null
}

export type InvoiceDocumentSettings = {
  show_tax_breakdown?: boolean
  show_business_tin?: boolean
  bank_name?: string | null
  bank_account_name?: string | null
  bank_account_number?: string | null
  momo_provider?: string | null
  momo_name?: string | null
  momo_number?: string | null
}

export type InvoiceDocumentProps = {
  invoice: InvoiceDocumentInvoice
  business: InvoiceDocumentBusiness | null
  items: InvoiceDocumentItem[]
  settings?: InvoiceDocumentSettings | null
  /** Optional class for the root container (e.g. print overrides) */
  className?: string
  /**
   * Override the status shown in the badge.
   * Use this on client-facing pages to show a friendlier label
   * (e.g. "awaiting_payment" instead of the internal "sent").
   */
  displayStatus?: string
  /**
   * Brand colour from invoice settings — renders a top accent strip.
   * Defaults to slate-900 (#0f172a).
   */
  brandColor?: string
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function InvoiceDocument({
  invoice,
  business,
  items,
  settings,
  className = "",
  displayStatus,
  brandColor = "#0f172a",
}: InvoiceDocumentProps) {
  const businessName = business?.trading_name || business?.legal_name || "Business"
  const businessAddress =
    business?.address ||
    [business?.address_street, business?.address_city, business?.address_region, business?.address_country]
      .filter(Boolean)
      .join(", ")

  const legacyTaxAmounts = invoice.tax_lines
    ? getGhanaLegacyView(invoice.tax_lines as any)
    : {
        nhil: invoice.nhil ?? 0,
        getfund: invoice.getfund ?? 0,
        vat: invoice.vat ?? 0,
      }
  const totalTax =
    invoice.total_tax ?? (invoice.tax_lines ? sumTaxLines(invoice.tax_lines as any) : 0)
  const showTaxBreakdown =
    invoice.apply_taxes && (settings?.show_tax_breakdown !== false) && totalTax > 0

  const lineItemsGross = items.reduce(
    (s, item) => s + Number(item.qty ?? 0) * Number(item.unit_price ?? 0),
    0
  )
  const lineItemsDiscountTotal = items.reduce(
    (s, item) => s + Number(item.discount_amount ?? 0),
    0
  )
  const showLineDiscountSummary = lineItemsDiscountTotal > 0.005

  const hasBank = !!(settings?.bank_account_number)
  const hasMomo = !!(settings?.momo_number)
  const hasPaymentDetails = hasBank || hasMomo

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden ${className}`}>
      {/* Brand accent strip */}
      <div className="h-1.5 w-full" style={{ backgroundColor: brandColor }} />

      {/* Header: logo + business info (left) | invoice number + status (right) */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start gap-4">
          <div className="flex items-start gap-3">
            <BusinessLogoDisplay
              logoUrl={business?.logo_url}
              businessName={businessName}
              size="lg"
              rounded="lg"
            />
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">{businessName}</h1>
              <p className="text-xs text-slate-400 mb-1">Invoice</p>
              {businessAddress && (
                <p className="text-xs text-slate-500">{businessAddress}</p>
              )}
              <div className="mt-1 space-y-0.5 text-xs text-slate-400">
                {business?.phone && <p>T: {business.phone}</p>}
                {business?.email && <p>E: {business.email}</p>}
                {business?.website && (
                  <a href={business.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                    {business.website}
                  </a>
                )}
                {settings?.show_business_tin && business?.tin && <p>TIN: {business.tin}</p>}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Invoice Number</span>
            <div className="text-sm font-mono text-slate-700 bg-slate-50 px-3 py-1 rounded border border-slate-200">
              #{invoice.invoice_number}
            </div>
            <StatusBadge status={displayStatus ?? invoice.status} />
          </div>
        </div>
      </div>

      {/* Bill to + dates — compact 2-col */}
      <div className="px-6 py-4 grid grid-cols-2 gap-6 border-b border-slate-200">
        {/* Bill To */}
        <div>
          <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Bill To</label>
          <p className="text-sm font-semibold text-slate-900">{invoice.customers?.name || "—"}</p>
          {invoice.customers?.address && <p className="text-xs text-slate-500 mt-0.5">{invoice.customers.address}</p>}
          {invoice.customers?.email && <p className="text-xs text-slate-500">{invoice.customers.email}</p>}
          {invoice.customers?.phone && <p className="text-xs text-slate-500">{invoice.customers.phone}</p>}
        </div>
        {/* Dates + terms */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 content-start">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Issue Date</label>
            <p className="text-xs text-slate-800">{formatDate(invoice.issue_date)}</p>
          </div>
          {invoice.due_date && (
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Due Date</label>
              <p className="text-xs text-slate-800">{formatDate(invoice.due_date)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Line items table — tighter rows */}
      <div className="border-b border-slate-200">
        <table className="w-full text-xs text-left">
          <thead className="bg-slate-50 text-slate-400 uppercase border-b border-slate-200">
            <tr>
              <th className="px-6 py-2.5 font-semibold w-[42%] tracking-wide">Item Description</th>
              <th className="px-4 py-2.5 font-semibold text-center w-14 tracking-wide">Qty</th>
              <th className="px-4 py-2.5 font-semibold text-right w-24 tracking-wide">Price</th>
              <th className="px-4 py-2.5 font-semibold text-right w-24 tracking-wide">Discount</th>
              <th className="px-6 py-2.5 font-semibold text-right w-24 tracking-wide">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-6 text-center text-slate-400 italic text-sm">
                  No line items
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={index} className="hover:bg-slate-50/50">
                  <td className="px-6 py-2.5 text-slate-900 text-sm">{item.description || "—"}</td>
                  <td className="px-4 py-2.5 text-center text-slate-600 tabular-nums">{Number(item.qty ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">
                    {formatMoney(Number(item.unit_price ?? 0), invoice.currency_code)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">
                    {Number(item.discount_amount) > 0
                      ? formatMoney(Number(item.discount_amount), invoice.currency_code)
                      : "—"}
                  </td>
                  <td className="px-6 py-2.5 text-right font-medium text-slate-900 tabular-nums">
                    {formatMoney(
                      item.line_subtotal != null
                        ? Number(item.line_subtotal)
                        : Number(item.qty ?? 0) * Number(item.unit_price ?? 0) -
                            Number(item.discount_amount ?? 0),
                      invoice.currency_code
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Totals — right-aligned (gross + discount match staff view / PDF template) */}
      <div className="px-6 py-5 flex justify-end border-b border-slate-100">
        <div className="w-64 space-y-2.5">
          {showLineDiscountSummary && (
            <>
              <div className="flex justify-between items-center text-sm text-slate-500">
                <span>Gross amount</span>
                <span className="font-medium text-slate-700 tabular-nums">
                  {formatMoney(lineItemsGross, invoice.currency_code)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm text-slate-500">
                <span>Discount</span>
                <span className="font-medium text-rose-600 tabular-nums">
                  −{formatMoney(lineItemsDiscountTotal, invoice.currency_code)}
                </span>
              </div>
            </>
          )}
          {(!showLineDiscountSummary || showTaxBreakdown) && (
            <div className="flex justify-between items-center text-sm text-slate-500">
              <span>{showLineDiscountSummary && showTaxBreakdown ? "Subtotal (excl. tax)" : "Subtotal"}</span>
              <span className="font-medium text-slate-700 tabular-nums">
                {formatMoney(Number(invoice.subtotal ?? 0), invoice.currency_code)}
              </span>
            </div>
          )}
          {showTaxBreakdown && (
            <>
              {legacyTaxAmounts.nhil > 0 && (
                <div className="flex justify-between items-center text-xs text-slate-400">
                  <span>NHIL (2.5%)</span>
                  <span>{formatMoney(legacyTaxAmounts.nhil, invoice.currency_code)}</span>
                </div>
              )}
              {legacyTaxAmounts.getfund > 0 && (
                <div className="flex justify-between items-center text-xs text-slate-400">
                  <span>GETFund (2.5%)</span>
                  <span>{formatMoney(legacyTaxAmounts.getfund, invoice.currency_code)}</span>
                </div>
              )}
              {legacyTaxAmounts.vat > 0 && (
                <div className="flex justify-between items-center text-xs text-slate-400">
                  <span>VAT (15%)</span>
                  <span>{formatMoney(legacyTaxAmounts.vat, invoice.currency_code)}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-100">
                <span className="text-slate-500">Total Tax</span>
                <span className="font-medium text-slate-700">{formatMoney(totalTax, invoice.currency_code)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center pt-2.5 border-t-2 border-slate-800">
            <span className="text-base font-bold text-slate-900">Total</span>
            <span className="text-xl font-bold text-slate-900">
              {formatMoney(Number(invoice.total ?? 0), invoice.currency_code)}
            </span>
          </div>
        </div>
      </div>

      {/* Notes — above payment instructions (matches PDF order) */}
      {invoice.notes?.trim() && (
        <div className="px-6 py-3 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Notes</h3>
          <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{invoice.notes}</p>
        </div>
      )}

      {/* Payment Details — full width below totals */}
      {hasPaymentDetails && (
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
            How to Pay
          </h3>
          <div className={`grid gap-4 ${hasBank && hasMomo ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 max-w-xs"}`}>
            {hasBank && (
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Bank Transfer</span>
                </div>
                <div className="space-y-1 text-sm">
                  {settings?.bank_name && (
                    <p className="font-semibold text-slate-800">{settings.bank_name}</p>
                  )}
                  {settings?.bank_account_name && (
                    <p className="text-slate-500 text-xs">Account name: <span className="text-slate-700 font-medium">{settings.bank_account_name}</span></p>
                  )}
                  <p className="font-mono text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 inline-block mt-1.5 text-sm tracking-widest font-bold">
                    {settings?.bank_account_number}
                  </p>
                </div>
              </div>
            )}
            {hasMomo && (
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
                    {settings?.momo_provider ? `${settings.momo_provider} MoMo` : "Mobile Money"}
                  </span>
                </div>
                <div className="space-y-1 text-sm">
                  {settings?.momo_name && (
                    <p className="text-slate-500 text-xs">Name: <span className="text-slate-700 font-medium">{settings.momo_name}</span></p>
                  )}
                  <p className="font-mono text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 inline-block mt-1.5 text-sm tracking-widest font-bold">
                    {settings?.momo_number}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {invoice.payment_terms?.trim() && (
        <div className="px-6 py-3 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">Payment terms</h3>
          <p className="text-xs text-slate-700 leading-relaxed">{invoice.payment_terms}</p>
        </div>
      )}

      {invoice.footer_message?.trim() && (
        <div className="px-6 py-3 text-center text-[11px] leading-snug text-slate-400">
          {invoice.footer_message}
        </div>
      )}
    </div>
  )
}
