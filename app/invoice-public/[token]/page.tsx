"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { useToast } from "@/components/ui/ToastProvider"
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
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [settings, setSettings] = useState<InvoiceSettings | null>(null)
  const [items, setItems] = useState<any[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    loadInvoice()
  }, [token])

  const loadInvoice = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/invoices/public/${token}`)

      if (!response.ok) {
        throw new Error("Invoice not found")
      }

      const data = await response.json()
      setInvoice(data.invoice)
      setBusiness(data.business)
      setSettings(data.settings)
      setItems(data.items || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load invoice")
      setLoading(false)
    }
  }

  const handleDownloadPdf = () => {
    window.print()
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900 mx-auto" />
          <p className="mt-4 text-slate-600">Loading invoice...</p>
        </div>
      </div>
    )
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-rose-600 text-lg">{error || "Invoice not found"}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print {
            .no-print { display: none !important; }
            body { background: #fff; }
            .print\\:max-w-full { max-width: 100% !important; }
            .print\\:shadow-none { box-shadow: none !important; }
            .print\\:p-0 { padding: 0 !important; }
          }`,
        }}
      />
      <div className="min-h-screen bg-gray-50/50 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto space-y-6 print:max-w-full">
          {/* Action bar (no-print): Download PDF + Pay online */}
          <div className="no-print flex flex-wrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded shadow-sm text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download PDF
            </button>
            {invoice.status !== "paid" && (
              <a
                href={`/pay/${invoice.id}`}
                className="inline-flex items-center gap-2 px-6 py-2 bg-slate-900 border border-transparent rounded shadow text-white text-sm font-medium hover:bg-black transition-colors"
              >
                Pay online
              </a>
            )}
          </div>

          {/* Invoice document (shared component — matches create invoice page design) */}
          <InvoiceDocument
            invoice={invoice}
            business={business}
            items={items}
            settings={settings}
            className="print:max-w-full print:shadow-none print:border-0"
          />

          {/* Payment options (no-print): restyled to match create-page card */}
          <div className="no-print bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                Payment Options
              </h3>
            </div>
            <div className="p-6 space-y-6">
              {invoice.status !== "paid" && (
                <>
                  <a
                    href={`/pay/${invoice.id}`}
                    className="inline-flex items-center justify-center gap-2 w-full md:w-auto bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded shadow-sm text-sm font-medium transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Pay with Mobile Money
                  </a>
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                      Scan QR Code to Pay
                    </p>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(typeof window !== "undefined" ? `${window.location.origin}/pay/${invoice.id}` : "")}`}
                      alt="Payment QR Code"
                      className="border border-slate-200 rounded-lg p-2 bg-white inline-block"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const payUrl = typeof window !== "undefined" ? `${window.location.origin}/pay/${invoice.id}` : ""
                        navigator.clipboard.writeText(payUrl)
                        toast.showToast("Payment link copied to clipboard!", "success")
                      }}
                      className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium block mx-auto"
                    >
                      Copy Payment Link
                    </button>
                  </div>
                </>
              )}
              {(settings?.bank_account_number || settings?.momo_number) && (
                <div className="space-y-3 pt-4 border-t border-slate-100 text-sm">
                  {settings.bank_account_number && (
                    <div>
                      <span className="font-medium text-slate-700">Bank Transfer</span>
                      <p className="text-slate-600 mt-0.5">
                        {settings.bank_name && `${settings.bank_name} — `}
                        {settings.bank_account_name && `${settings.bank_account_name} — `}
                        {settings.bank_account_number}
                      </p>
                    </div>
                  )}
                  {settings.momo_number && (
                    <div>
                      <span className="font-medium text-slate-700">Mobile Money</span>
                      <p className="text-slate-600 mt-0.5">
                        {settings.momo_provider && `${settings.momo_provider} — `}
                        {settings.momo_name && `${settings.momo_name} — `}
                        {settings.momo_number}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
