"use client"

/**
 * Shared invoice document layout — matches the create invoice page design.
 * Used by the public invoice page (and can be used by preview when fed the same data).
 * Design tokens: slate palette, StatusBadge, same typography and spacing as app/invoices/new.
 */

import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import { StatusBadge } from "@/components/ui/StatusBadge"
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
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatMoney(amount: number, symbol: string) {
  return `${symbol}${Number(amount).toFixed(2)}`
}

export function InvoiceDocument({
  invoice,
  business,
  items,
  settings,
  className = "",
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

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden ${className}`}>
      {/* Header: logo + business + doc number + status */}
      <div className="p-8 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start gap-8">
          <div className="flex items-start gap-4">
            <BusinessLogoDisplay
              logoUrl={business?.logo_url}
              businessName={businessName}
              size="xl"
              rounded="lg"
            />
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">{businessName}</h1>
              <p className="text-sm text-slate-500">Invoice</p>
              {businessAddress && (
                <p className="text-sm text-slate-600 mt-1">{businessAddress}</p>
              )}
              <div className="mt-2 space-y-0.5 text-sm text-slate-500">
                {business?.phone && <p>Phone: {business.phone}</p>}
                {business?.email && <p>Email: {business.email}</p>}
                {business?.website && (
                  <p>
                    <a
                      href={business.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {business.website}
                    </a>
                  </p>
                )}
                {settings?.show_business_tin && business?.tin && <p>TIN: {business.tin}</p>}
              </div>
            </div>
          </div>
          <div className="w-full md:w-auto flex flex-col items-end gap-2">
            <span className="block text-xs uppercase font-bold text-slate-400 tracking-wider">
              Invoice Number
            </span>
            <div className="text-sm font-mono text-slate-600 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
              #{invoice.invoice_number}
            </div>
            <StatusBadge status={invoice.status} />
          </div>
        </div>
      </div>

      {/* Bill to + meta grid */}
      <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 border-b border-slate-200">
        <div className="space-y-4">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
            Bill To
          </label>
          <p className="text-slate-900 font-medium">
            {invoice.customers?.name || "—"}
          </p>
          {invoice.customers?.address && (
            <p className="text-sm text-slate-600">{invoice.customers.address}</p>
          )}
          {invoice.customers?.email && (
            <p className="text-sm text-slate-600">{invoice.customers.email}</p>
          )}
          {invoice.customers?.phone && (
            <p className="text-sm text-slate-600">{invoice.customers.phone}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Issue Date
            </label>
            <p className="text-sm text-slate-900">{formatDate(invoice.issue_date)}</p>
          </div>
          {invoice.due_date && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Due Date
              </label>
              <p className="text-sm text-slate-900">{formatDate(invoice.due_date)}</p>
            </div>
          )}
          {invoice.payment_terms && (
            <div className="col-span-2 pt-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Payment Terms
              </label>
              <p className="text-sm text-slate-700">{invoice.payment_terms}</p>
            </div>
          )}
        </div>
      </div>

      {/* Line items table */}
      <div className="border-b border-slate-200">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-xs text-slate-500 uppercase border-b border-slate-200">
            <tr>
              <th className="px-6 py-3 font-semibold w-1/2">Item Description</th>
              <th className="px-4 py-3 font-semibold text-center w-24">Qty</th>
              <th className="px-4 py-3 font-semibold text-right w-32">Price</th>
              <th className="px-6 py-3 font-semibold text-right w-32">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-slate-400 italic">
                  No line items
                </td>
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={index} className="hover:bg-slate-50/50">
                  <td className="px-6 py-3 text-slate-900">
                    {item.description || "—"}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-700 tabular-nums">
                    {Number(item.qty ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                    {formatMoney(Number(item.unit_price ?? 0), invoice.currency_symbol)}
                  </td>
                  <td className="px-6 py-3 text-right font-medium text-slate-900 tabular-nums">
                    {formatMoney(Number(item.line_subtotal ?? 0), invoice.currency_symbol)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="p-8 border-t border-slate-200">
        <div className="flex justify-end">
          <div className="w-full md:w-80 space-y-3">
            <div className="flex justify-between items-center text-sm text-slate-600">
              <span>Subtotal</span>
              <span className="font-medium">
                {formatMoney(Number(invoice.subtotal ?? 0), invoice.currency_symbol)}
              </span>
            </div>
            {showTaxBreakdown && (
              <>
                {legacyTaxAmounts.nhil > 0 && (
                  <div className="flex justify-between items-center text-xs text-slate-500">
                    <span>NHIL</span>
                    <span>{formatMoney(legacyTaxAmounts.nhil, invoice.currency_symbol)}</span>
                  </div>
                )}
                {legacyTaxAmounts.getfund > 0 && (
                  <div className="flex justify-between items-center text-xs text-slate-500">
                    <span>GETFund</span>
                    <span>{formatMoney(legacyTaxAmounts.getfund, invoice.currency_symbol)}</span>
                  </div>
                )}
                {legacyTaxAmounts.vat > 0 && (
                  <div className="flex justify-between items-center text-xs text-slate-500">
                    <span>VAT</span>
                    <span>{formatMoney(legacyTaxAmounts.vat, invoice.currency_symbol)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-100">
                  <span className="text-slate-600">Total Tax</span>
                  <span className="font-medium text-slate-900">
                    {formatMoney(totalTax, invoice.currency_symbol)}
                  </span>
                </div>
              </>
            )}
            <div className="flex justify-between items-center pt-2 border-t-2 border-slate-200">
              <span className="text-base font-bold text-slate-900">Total</span>
              <span className="text-xl font-bold text-slate-900">
                {formatMoney(Number(invoice.total ?? 0), invoice.currency_symbol)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes / footer */}
      {(invoice.notes || invoice.footer_message) && (
        <div className="p-8 border-t border-slate-200 bg-slate-50/30">
          {invoice.notes && (
            <div className="mb-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Notes
              </h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
          {invoice.footer_message && (
            <p className="text-sm text-slate-500 text-center">{invoice.footer_message}</p>
          )}
        </div>
      )}
    </div>
  )
}
