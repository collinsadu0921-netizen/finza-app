"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { normalizeCountry, getAllowedMethods, getMobileMoneyLabel } from "@/lib/payments/eligibility"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { useToast } from "@/components/ui/ToastProvider"
import { formatMoney } from "@/lib/money"

type Bill = {
  id: string
  business_id: string
  supplier_name: string
  supplier_phone: string | null
  supplier_email: string | null
  bill_number: string
  issue_date: string
  due_date: string | null
  status: string
  subtotal: number
  nhil: number
  getfund: number
  covid: number
  vat: number
  total_tax: number
  total: number
  notes: string | null
  attachment_path: string | null
  wht_applicable: boolean
  wht_rate: number | null
  wht_amount: number
  wht_remitted_at: string | null
  wht_remittance_ref: string | null
  // Import bill fields
  bill_type: "standard" | "import"
  import_description: string | null
  cif_value: number | null
  import_duty_rate: number | null
  import_duty_amount: number | null
  ecowas_levy: number | null
  au_levy: number | null
  exim_levy: number | null
  sil_levy: number | null
  examination_fee: number | null
  clearing_agent_fee: number | null
  landed_cost_account_code: string | null
  currency_code?: string | null
  currency_symbol?: string | null
  fx_rate?: number | null
  home_currency_code?: string | null
  home_currency_total?: number | null
}

/** Prefix for amounts stored in document currency vs business home. */
function billAmountCurrencyDisplay(
  b: Pick<
    Bill,
    "fx_rate" | "currency_code" | "currency_symbol" | "home_currency_code"
  >,
  businessHomeCode: string,
  homeDisplay: string
): string {
  const hc = b.home_currency_code || businessHomeCode || ""
  const isDocForeign = !!(
    b.fx_rate &&
    b.currency_code &&
    hc &&
    b.currency_code !== hc
  )
  if (isDocForeign && b.currency_code) {
    return (
      b.currency_symbol ||
      getCurrencySymbol(b.currency_code) ||
      b.currency_code ||
      homeDisplay
    )
  }
  return homeDisplay
}

type BillItem = {
  id: string
  description: string
  qty: number
  unit_price: number
  discount_amount: number
  line_subtotal: number
}

type BillPayment = {
  id: string
  amount: number
  date: string
  method: string
  reference: string | null
  notes: string | null
  settlement_fx_rate?: number | null
}

export default function BillViewPage() {
  const toast = useToast()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [bill, setBill] = useState<Bill | null>(null)
  const [items, setItems] = useState<BillItem[]>([])
  const [payments, setPayments] = useState<BillPayment[]>([])
  const [totalPaid, setTotalPaid] = useState(0)
  const [balance, setBalance] = useState(0)
  const [error, setError] = useState("")
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [editingPayment, setEditingPayment] = useState<BillPayment | null>(null)
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>("")
  const [currencyCode, setCurrencyCode] = useState<string>("")

  useEffect(() => {
    loadBill()
  }, [id])

  const loadBill = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/bills/${id}`)

      if (!response.ok) {
        throw new Error("Failed to load bill")
      }

      const data = await response.json()
      setBill(data.bill)
      setItems(data.items || [])
      setPayments(data.payments || [])
      setTotalPaid(data.total_paid || 0)
      setBalance(data.balance || 0)

      // Load business country and currency
      if (data.bill?.business_id) {
        const { data: business } = await supabase
          .from("businesses")
          .select("address_country, default_currency")
          .eq("id", data.bill.business_id)
          .single()
        setBusinessCountry(business?.address_country || null)

        // CRITICAL: Get currency symbol from business currency code
        if (business?.default_currency) {
          setCurrencyCode(business.default_currency)
          const symbol = getCurrencySymbol(business.default_currency)
          if (symbol) {
            setCurrencySymbol(symbol)
          } else {
            setError("Currency symbol not available. Please set your business currency in Business Profile settings.")
          }
        } else {
          setError("Business currency is required. Please set your business currency in Business Profile settings.")
        }
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load bill")
      setLoading(false)
    }
  }

  const handlePaymentAdded = () => {
    setShowPaymentModal(false)
    setEditingPayment(null)
    loadBill()
  }

  const sendViaWhatsApp = () => {
    if (!bill || !bill.supplier_phone) {
      toast.showToast("Supplier phone number not available", "warning")
      return
    }

    const message = `Hello,

Our record for bill ${bill.bill_number} is ready for your review.

For confirmation or clarifications, please reply here.

Thank you.`
    const result = buildWhatsAppLink(bill.supplier_phone, message)
    if (!result.ok) {
      toast.showToast(result.error, "error")
      return
    }
    window.open(result.whatsappUrl, "_blank", "noopener,noreferrer")
  }

  const formatMethod = (method: string) => {
    const methods: Record<string, string> = {
      cash: "Cash",
      bank: "Bank Transfer",
      momo: "Mobile Money",
      cheque: "Cheque",
      card: "Card",
      paystack: "Paystack",
      other: "Other",
    }
    return methods[method] || method
  }

  const getStatusBadge = (status: string) => {
    const dots: Record<string, string> = {
      draft: "bg-slate-400",
      open: "bg-blue-500",
      partially_paid: "bg-amber-500",
      paid: "bg-emerald-500",
      overdue: "bg-red-500",
    }
    const labels: Record<string, string> = {
      draft: "Draft",
      open: "Open",
      partially_paid: "Partially Paid",
      paid: "Paid",
      overdue: "Overdue",
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dots[status] ?? "bg-slate-400"}`} />
        {labels[status] ?? status}
      </span>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
    )
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm max-w-md w-full">
          {error || "Bill not found"}
        </div>
      </div>
    )
  }

  const homeCurrencyDisplay = resolveCurrencyDisplay({
    currency_symbol: currencySymbol,
    currency_code: currencyCode,
  })
  const docCurrencyDisplay = billAmountCurrencyDisplay(
    bill,
    currencyCode,
    homeCurrencyDisplay
  )
  const totalDiscount = (items || []).reduce((sum, item) => sum + Number(item.discount_amount || 0), 0)
  const homeCodeForBill = bill.home_currency_code || currencyCode || ""
  const billIsForeign = !!(
    bill.fx_rate &&
    bill.currency_code &&
    homeCodeForBill &&
    bill.currency_code !== homeCodeForBill
  )
  const homeSymbolForBooked =
    getCurrencySymbol(homeCodeForBill) || homeCodeForBill || homeCurrencyDisplay

  return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <button
            onClick={() => router.back()}
            className="text-slate-500 hover:text-slate-800 mb-4 flex items-center gap-2 transition-colors export-hide print-hide"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          {/* Header card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-center justify-between gap-4 mb-6 export-hide print-hide">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Bill #{bill.bill_number}</h1>
              <div className="flex items-center gap-2 mt-1">
                {getStatusBadge(bill.status)}
                {bill.bill_type === "import" && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Import Bill
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-0.5">Supplier bill details and payment tracking</p>
            </div>
            <button
              onClick={() => router.push(`/bills/${id}/edit`)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </button>
          </div>

          {/* Summary stat cards */}
          <div className={`grid grid-cols-1 gap-4 mb-6 export-hide print-hide ${bill.wht_applicable ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Gross Total</p>
              <p className="text-2xl font-bold text-slate-900">
                {docCurrencyDisplay}
                {Number(bill.total).toFixed(2)}
              </p>
              {billIsForeign && bill.home_currency_total != null && (
                <p className="text-xs text-slate-500 mt-1">
                  Booked in {homeCodeForBill}: {homeSymbolForBooked}
                  {Number(bill.home_currency_total).toFixed(2)} (rate{" "}
                  {Number(bill.fx_rate).toFixed(4)})
                </p>
              )}
            </div>
            {bill.wht_applicable && (
              <div className={`rounded-xl border shadow-sm p-4 ${bill.wht_remitted_at ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">WHT ({((bill.wht_rate ?? 0) * 100).toFixed(0)}%)</p>
                <p className={`text-2xl font-bold ${bill.wht_remitted_at ? 'text-emerald-700' : 'text-amber-700'}`}>{docCurrencyDisplay}{Number(bill.wht_amount).toFixed(2)}</p>
                <p className={`text-xs mt-1 ${bill.wht_remitted_at ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {bill.wht_remitted_at ? '✓ Remitted to GRA' : 'Pending remittance'}
                </p>
              </div>
            )}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Total Paid</p>
              <p className="text-2xl font-bold text-emerald-600">{docCurrencyDisplay}{totalPaid.toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
                {bill.wht_applicable && Number(bill.wht_amount) > 0 ? "Remaining (to supplier)" : "Remaining"}
              </p>
              <p className={`text-2xl font-bold ${balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{docCurrencyDisplay}{balance.toFixed(2)}</p>
              {bill.wht_applicable && Number(bill.wht_amount) > 0 && (
                <p className="text-xs text-slate-500 mt-1">Net of WHT — supplier cash portion only.</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Bill Details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Supplier & Bill Info */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Bill Information</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-500">Supplier</label>
                    <p className="text-sm font-semibold text-slate-800 mt-1">{bill.supplier_name}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">Issue Date</label>
                    <p className="text-sm font-semibold text-slate-800 mt-1">
                      {new Date(bill.issue_date).toLocaleDateString("en-GH")}
                    </p>
                  </div>
                  {bill.supplier_phone && (
                    <div>
                      <label className="text-xs text-slate-500">Phone</label>
                      <p className="text-sm text-slate-700 mt-1">{bill.supplier_phone}</p>
                    </div>
                  )}
                  {bill.supplier_email && (
                    <div>
                      <label className="text-xs text-slate-500">Email</label>
                      <p className="text-sm text-slate-700 mt-1">{bill.supplier_email}</p>
                    </div>
                  )}
                  {bill.due_date && (
                    <div>
                      <label className="text-xs text-slate-500">Due Date</label>
                      <p className="text-sm text-slate-700 mt-1">
                        {new Date(bill.due_date).toLocaleDateString("en-GH")}
                      </p>
                    </div>
                  )}
                </div>
                {bill.notes && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <label className="text-xs text-slate-500">Notes</label>
                    <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap">{bill.notes}</p>
                  </div>
                )}
              </div>

              {/* Line Items / Import Breakdown */}
              {bill.bill_type === "import" ? (
                /* Import duty breakdown */
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Import / Customs Entry</h2>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                      📦 Import Bill
                    </span>
                  </div>

                  {bill.import_description && (
                    <p className="text-sm text-slate-600 mb-5 italic">{bill.import_description}</p>
                  )}

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">CIF Value <span className="text-xs">(Cost + Insurance + Freight)</span></span>
                      <span className="font-semibold text-slate-800">{docCurrencyDisplay}{Number(bill.cif_value ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-slate-100">
                      <span className="text-slate-600">
                        Import Duty <span className="text-xs">({((Number(bill.import_duty_rate ?? 0)) * 100).toFixed(0)}% ECOWAS CET)</span>
                      </span>
                      <span className="font-medium text-slate-800">{docCurrencyDisplay}{Number(bill.import_duty_amount ?? 0).toFixed(2)}</span>
                    </div>

                    {/* Port levies */}
                    {Number(bill.ecowas_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-slate-400">
                        <span>ECOWAS Levy (0.5%)</span>
                        <span>{docCurrencyDisplay}{Number(bill.ecowas_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.au_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-slate-400">
                        <span>AU Levy (0.2%)</span>
                        <span>{docCurrencyDisplay}{Number(bill.au_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.exim_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-slate-400">
                        <span>EXIM Levy (0.75%)</span>
                        <span>{docCurrencyDisplay}{Number(bill.exim_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.sil_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-slate-400">
                        <span>SIL (2%)</span>
                        <span>{docCurrencyDisplay}{Number(bill.sil_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.examination_fee) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-slate-400">
                        <span>Examination Fee (1%)</span>
                        <span>{docCurrencyDisplay}{Number(bill.examination_fee).toFixed(2)}</span>
                      </div>
                    )}

                    {/* VAT base */}
                    {(() => {
                      const vatBase = Number(bill.cif_value ?? 0)
                        + Number(bill.import_duty_amount ?? 0)
                        + Number(bill.ecowas_levy ?? 0)
                        + Number(bill.au_levy ?? 0)
                        + Number(bill.exim_levy ?? 0)
                        + Number(bill.sil_levy ?? 0)
                        + Number(bill.examination_fee ?? 0)
                      return (
                        <div className="flex justify-between py-2 border-t border-indigo-200 mt-1">
                          <span className="font-semibold text-indigo-800">VAT Base (landed cost)</span>
                          <span className="font-bold text-indigo-800">{docCurrencyDisplay}{vatBase.toFixed(2)}</span>
                        </div>
                      )
                    })()}

                    {Number(bill.clearing_agent_fee) > 0 && (
                      <div className="flex justify-between py-2 border-t border-dashed border-slate-200 text-xs text-slate-400">
                        <span>Clearing Agent Fee (posted to 5220)</span>
                        <span>{docCurrencyDisplay}{Number(bill.clearing_agent_fee).toFixed(2)}</span>
                      </div>
                    )}

                    {bill.landed_cost_account_code && (
                      <div className="mt-3 pt-2 border-t border-slate-100">
                        <span className="text-xs text-slate-400">
                          Landed cost posted to account {bill.landed_cost_account_code}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Standard line items */
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Line Items</h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Qty</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Unit Price</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Discount</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-3 text-sm text-slate-800">{item.description}</td>
                            <td className="px-4 py-3 text-sm text-center text-slate-600">{Number(item.qty)}</td>
                            <td className="px-4 py-3 text-sm text-right text-slate-600">
                              {docCurrencyDisplay}{Number(item.unit_price).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-slate-600 tabular-nums">
                              {Number(item.discount_amount || 0) > 0 ? `${docCurrencyDisplay}${Number(item.discount_amount).toFixed(2)}` : "—"}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-slate-800">
                              {docCurrencyDisplay}{Number(item.line_subtotal).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tax Breakdown */}
              {(bill.nhil > 0 || bill.vat > 0) && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Tax Breakdown</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500">Subtotal:</span>
                      <span className="font-semibold text-slate-800">{docCurrencyDisplay}{Number(bill.subtotal).toFixed(2)}</span>
                    </div>
                    {totalDiscount > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Discounts:</span>
                        <span className="font-semibold text-rose-600">−{docCurrencyDisplay}{totalDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {(() => {
                        const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
                        const isGhana = countryCode === "GH"

                        // CRITICAL: Only show Ghana tax labels for GH businesses
                        if (isGhana) {
                          return (
                            <>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">NHIL (2.5%):</span>
                                <span className="text-slate-800">{docCurrencyDisplay}{Number(bill.nhil || 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">GETFund (2.5%):</span>
                                <span className="text-slate-800">{docCurrencyDisplay}{Number(bill.getfund || 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-500">VAT (15%):</span>
                                <span className="text-slate-800">{docCurrencyDisplay}{Number(bill.vat || 0).toFixed(2)}</span>
                              </div>
                            </>
                          )
                        } else {
                          // Non-GH: Show generic VAT only
                          return (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-slate-500">VAT:</span>
                              <span className="text-slate-800">{docCurrencyDisplay}{Number(bill.vat || 0).toFixed(2)}</span>
                            </div>
                          )
                        }
                      })()}
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t-2 border-slate-800">
                      <span className="text-slate-800 font-bold text-lg">
                        {bill.wht_applicable ? 'Gross Total:' : 'Total:'}
                      </span>
                      <span className="font-bold text-slate-900 text-xl">{docCurrencyDisplay}{Number(bill.total).toFixed(2)}</span>
                    </div>
                    {bill.wht_applicable && bill.wht_amount > 0 && (
                      <>
                        <div className="flex justify-between items-center text-sm pt-2 border-t border-amber-200">
                          <span className="text-amber-700 font-medium">
                            WHT Deduction ({((bill.wht_rate ?? 0) * 100).toFixed(0)}%):
                          </span>
                          <span className="text-amber-700 font-semibold">
                            − {docCurrencyDisplay}{Number(bill.wht_amount).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t-2 border-amber-300">
                          <span className="text-amber-800 font-bold text-lg">Net to Supplier:</span>
                          <span className="font-bold text-amber-700 text-xl">
                            {docCurrencyDisplay}{(Number(bill.total) - Number(bill.wht_amount)).toFixed(2)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Payments & Actions - hidden in print/export */}
            <div className="lg:col-span-1 space-y-6 export-hide print-hide">
              {/* Payments */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Payments</h2>
                  {bill.status !== "paid" && (
                    <button
                      onClick={() => setShowPaymentModal(true)}
                      className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 font-medium text-sm transition-all flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Payment
                    </button>
                  )}
                </div>

                {payments.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-4">No payments recorded</p>
                ) : (
                  <div className="space-y-3">
                    {payments.map((payment) => (
                      <div key={payment.id} className="border border-slate-100 rounded-lg p-3">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-semibold text-slate-800">{docCurrencyDisplay}{Number(payment.amount).toFixed(2)}</p>
                            <p className="text-xs text-slate-500">
                              {formatMethod(payment.method)} • {new Date(payment.date).toLocaleDateString("en-GH")}
                            </p>
                            {payment.settlement_fx_rate != null &&
                              payment.settlement_fx_rate > 0 &&
                              billIsForeign && (
                              <p className="text-xs text-slate-500">
                                Settlement: 1 {bill.currency_code} ={" "}
                                {Number(payment.settlement_fx_rate).toFixed(4)}{" "}
                                {homeCodeForBill}
                              </p>
                            )}
                            {payment.reference && (
                              <p className="text-xs text-slate-500">Ref: {payment.reference}</p>
                            )}
                          </div>
                          <button
                            onClick={() => setEditingPayment(payment)}
                            className="text-slate-400 hover:text-slate-600 p-1"
                            title="Edit payment"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="pt-3 border-t border-slate-100">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-500">Total Paid:</span>
                        <span className="font-semibold text-slate-800">{docCurrencyDisplay}{totalPaid.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span className="text-slate-500">
                          {bill.wht_applicable && Number(bill.wht_amount) > 0 ? "Remaining (to supplier):" : "Remaining:"}
                        </span>
                        <span className={`font-semibold ${balance > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {docCurrencyDisplay}{balance.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* WHT Remittance Card */}
              {bill.wht_applicable && bill.wht_amount > 0 && (
                <div className={`rounded-xl p-6 border ${bill.wht_remitted_at ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Withholding Tax</h2>
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">WHT Amount:</span>
                      <span className="font-semibold text-slate-800">{docCurrencyDisplay}{Number(bill.wht_amount).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Status:</span>
                      <span className={`font-semibold ${bill.wht_remitted_at ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {bill.wht_remitted_at ? 'Remitted to GRA' : 'Pending remittance'}
                      </span>
                    </div>
                    {bill.wht_remitted_at && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Remitted on:</span>
                        <span className="text-slate-800">
                          {new Date(bill.wht_remitted_at).toLocaleDateString("en-GB")}
                        </span>
                      </div>
                    )}
                    {bill.wht_remittance_ref && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">GRA Ref:</span>
                        <span className="text-slate-800">{bill.wht_remittance_ref}</span>
                      </div>
                    )}
                  </div>
                  {!bill.wht_remitted_at && (
                    <a
                      href="/service/accounting/wht"
                      className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 font-medium text-sm transition-all w-full block text-center"
                    >
                      Remit to GRA →
                    </a>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Actions</h2>
                <div className="space-y-3">
                  {bill.supplier_phone && (
                    <button
                      onClick={sendViaWhatsApp}
                      className="bg-[#25D366] text-white px-4 py-2.5 rounded-lg hover:bg-[#1ebe5d] font-medium text-sm transition-colors flex items-center justify-center gap-2 w-full"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                      </svg>
                      Send via WhatsApp
                    </button>
                  )}
                  {bill.attachment_path && (
                    <button
                      onClick={() => window.open(bill.attachment_path || "", "_blank")}
                      className="bg-white text-slate-700 px-4 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 font-medium text-sm transition-colors flex items-center justify-center gap-2 w-full"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      View Attachment
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Add Payment Modal */}
        {showPaymentModal && bill && (
          <AddPaymentModal
            key={editingPayment?.id ?? "new-bill-payment"}
            billId={id}
            businessId={bill.business_id}
            balance={balance}
            currencySymbol={docCurrencyDisplay}
            onClose={() => setShowPaymentModal(false)}
            onSuccess={handlePaymentAdded}
            editingPayment={editingPayment}
            businessCountry={businessCountry}
            whtApplicable={bill.wht_applicable}
            whtAmount={Number(bill.wht_amount) || 0}
            billFxRate={bill.fx_rate ?? null}
            billCurrencyCode={bill.currency_code ?? null}
            homeCurrencyCode={currencyCode || null}
          />
        )}
      </div>
  )
}

// Add Payment Modal Component
function AddPaymentModal({
  billId,
  businessId,
  balance,
  currencySymbol = "$",
  onClose,
  onSuccess,
  editingPayment,
  businessCountry,
  whtApplicable = false,
  whtAmount = 0,
  billFxRate = null,
  billCurrencyCode = null,
  homeCurrencyCode = null,
}: {
  billId: string
  businessId: string
  balance: number
  currencySymbol?: string
  onClose: () => void
  onSuccess: () => void
  editingPayment: BillPayment | null
  businessCountry?: string | null
  whtApplicable?: boolean
  whtAmount?: number
  billFxRate?: number | null
  billCurrencyCode?: string | null
  homeCurrencyCode?: string | null
}) {
  // Get allowed payment methods based on country
  const countryCode = normalizeCountry(businessCountry)
  const allowedMethods = getAllowedMethods(countryCode)
  const mobileMoneyLabel = getMobileMoneyLabel(countryCode)

  // Map eligibility methods to legacy method names
  const canUseCash = allowedMethods.includes("cash")
  const canUseMobileMoney = allowedMethods.includes("mobile_money")
  const canUseCard = allowedMethods.includes("card")
  const canUseBank = allowedMethods.includes("bank_transfer")
  const canUsePaystack = allowedMethods.includes("paystack")

  // Determine default method (first available, or bank if available)
  const defaultMethod = canUseBank ? "bank" : (canUseCash ? "cash" : (canUseMobileMoney ? "momo" : (canUseCard ? "card" : "bank")))

  // balance from API is already net to supplier when WHT applies
  const supplierRemaining = balance
  const [amount, setAmount] = useState(editingPayment ? editingPayment.amount.toString() : "")
  const [date, setDate] = useState(editingPayment ? editingPayment.date : new Date().toISOString().split("T")[0])
  const [method, setMethod] = useState(editingPayment ? editingPayment.method : defaultMethod)
  const [reference, setReference] = useState(editingPayment ? editingPayment.reference || "" : "")
  const [notes, setNotes] = useState(editingPayment ? editingPayment.notes || "" : "")
  const [settlementFxRate, setSettlementFxRate] = useState(
    editingPayment?.settlement_fx_rate != null
      ? String(editingPayment.settlement_fx_rate)
      : ""
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const hasNoAllowedMethods = allowedMethods.length === 0

  const isFxBill = !!(
    billFxRate &&
    billCurrencyCode &&
    homeCurrencyCode &&
    billCurrencyCode !== homeCurrencyCode
  )
  const parsedSettlementRate = parseFloat(settlementFxRate) || 0
  const amountNum = Number(amount) || 0
  const apClearHome =
    isFxBill && billFxRate && amountNum > 0
      ? Math.round(amountNum * billFxRate * 100) / 100
      : null
  const cashOutHome =
    isFxBill && parsedSettlementRate > 0 && amountNum > 0
      ? Math.round(amountNum * parsedSettlementRate * 100) / 100
      : null
  const fxDiff =
    apClearHome != null && cashOutHome != null
      ? Math.round((apClearHome - cashOutHome) * 100) / 100
      : null
  const originalRate = billFxRate ?? 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!amount || Number(amount) <= 0) {
      setError("Please enter a valid amount")
      return
    }

    if (isFxBill && parsedSettlementRate <= 0) {
      setError(
        `Settlement rate is required for ${billCurrencyCode} bills. Enter today's exchange rate.`
      )
      return
    }

    if (Number(amount) > supplierRemaining && !editingPayment) {
      setError(`Payment amount cannot exceed amount owed to supplier (${currencySymbol}${supplierRemaining.toFixed(2)})`)
      return
    }

    try {
      setLoading(true)

      const url = editingPayment
        ? `/api/bills/${billId}/payments/${editingPayment.id}`
        : `/api/bills/${billId}/payments`
      const httpMethod = editingPayment ? "PUT" : "POST"

      const response = await fetch(url, {
        method: httpMethod,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          amount: Number(amount),
          date,
          method: method, // Payment method (cash, bank, momo, etc.)
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          settlement_fx_rate: isFxBill ? parsedSettlementRate : null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Failed to save payment")
        setLoading(false)
        return
      }

      onSuccess()
    } catch (err: any) {
      setError(err.message || "Failed to save payment")
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
        {/* Header - Fixed */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-slate-900">
            {editingPayment ? "Edit Payment" : "Add Payment"}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} id="bill-payment-form" className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Amount *</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={(e) => e.target.select()}
              required
              placeholder={editingPayment ? "" : currencySymbol + supplierRemaining.toFixed(2)}
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400"
            />
            {!editingPayment && whtApplicable && whtAmount > 0 ? (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-amber-600 font-medium">
                  Max payment to supplier: {currencySymbol}{supplierRemaining.toFixed(2)} (WHT {currencySymbol}{whtAmount.toFixed(2)} is a separate GRA liability)
                </p>
              </div>
            ) : !editingPayment ? (
              <p className="text-xs text-slate-500 mt-1">Balance: {currencySymbol}{balance.toFixed(2)}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400"
            />
          </div>

          {/* Blocking banner if no methods allowed */}
          {hasNoAllowedMethods && (
            <div className="bg-red-50 border-2 border-red-200 text-red-800 px-4 py-3 rounded-xl mb-4">
              <p className="font-semibold mb-2">No payment methods available</p>
              <p className="text-sm mb-2">
                Please set your business country in <a href="/settings/business-profile" className="underline font-semibold">Business Profile</a> to enable payment methods.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Payment Method *</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              required
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400"
              disabled={hasNoAllowedMethods}
            >
              {canUseCash && <option value="cash">Cash</option>}
              {canUseBank && <option value="bank">Bank Transfer</option>}
              {canUseMobileMoney && <option value="momo">{mobileMoneyLabel}</option>}
              {canUseCard && <option value="card">Card</option>}
              {canUsePaystack && <option value="paystack">Paystack</option>}
              {/* Legacy methods always available for backward compatibility */}
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>

          {isFxBill && billCurrencyCode && homeCurrencyCode && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Settlement rate <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-sm">
                  1 {billCurrencyCode} =
                </div>
                <input
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  required
                  value={settlementFxRate}
                  onChange={(e) => setSettlementFxRate(e.target.value)}
                  className="w-full pl-[5.5rem] pr-16 py-2.5 rounded-lg border border-slate-200 focus:border-slate-400 focus:ring-2 focus:ring-slate-100 focus:outline-none bg-white tabular-nums text-sm"
                  placeholder="e.g. 15.20"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400 text-sm">
                  {homeCurrencyCode}
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Bill booked at 1 {billCurrencyCode} = {originalRate.toFixed(4)}{" "}
                {homeCurrencyCode}
              </p>
              {parsedSettlementRate > 0 && fxDiff !== null && (
                <div
                  className={`text-xs font-semibold px-3 py-2 rounded-lg ${
                    fxDiff > 0
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : fxDiff < 0
                        ? "bg-red-50 text-red-700 border border-red-200"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {fxDiff > 0
                    ? `FX gain: +${formatMoney(fxDiff, homeCurrencyCode)}`
                    : fxDiff < 0
                      ? `FX loss: ${formatMoney(fxDiff, homeCurrencyCode)}`
                      : "No FX difference"}
                </div>
              )}
              <p className="text-xs text-slate-600">
                Cash out (approx.):{" "}
                {cashOutHome != null
                  ? formatMoney(cashOutHome, homeCurrencyCode)
                  : "—"}{" "}
                · AP reduction:{" "}
                {apClearHome != null
                  ? formatMoney(apClearHome, homeCurrencyCode)
                  : "—"}
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Reference</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400"
              placeholder="Transaction reference"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-slate-100 focus:border-slate-400"
              placeholder="Additional notes"
            />
          </div>
          </form>
        </div>

        {/* Sticky Footer - Fixed */}
        <div className="sticky bottom-0 bg-slate-50 border-t border-slate-100 p-4 flex gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-700 px-4 py-2.5 rounded-lg hover:bg-slate-100 font-medium text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="bill-payment-form"
            disabled={loading || hasNoAllowedMethods}
            className="flex-1 bg-emerald-600 text-white px-4 py-2.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-semibold text-sm transition-colors"
          >
            {loading ? "Saving..." : editingPayment ? "Update Payment" : "Add Payment"}
          </button>
        </div>
      </div>
    </div>
  )
}

