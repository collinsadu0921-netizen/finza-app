"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { supabase } from "@/lib/supabaseClient"
import { normalizeCountry, getAllowedMethods, getMobileMoneyLabel } from "@/lib/payments/eligibility"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { useToast } from "@/components/ui/ToastProvider"

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

  const currency = resolveCurrencyDisplay({ currency_symbol: currencySymbol, currency_code: currencyCode })

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

    const message = `Hello, here is our record of your bill ${bill.bill_number}.\n\nTotal: ${currency}${bill.total.toFixed(2)}.\nOutstanding: ${currency}${balance.toFixed(2)}.\n\nFor confirmation or clarifications, please reply here.`
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
      other: "Other",
    }
    return methods[method] || method
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
      open: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      partially_paid: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      overdue: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    }
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status] || styles.draft}`}>
        {status.charAt(0).toUpperCase() + status.slice(1).replace("_", " ")}
      </span>
    )
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  if (error || !bill) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error || "Bill not found"}
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8 export-hide print-hide">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-2">
                  Bill #{bill.bill_number}
                </h1>
                <p className="text-gray-600 dark:text-gray-400">Supplier bill details and payment tracking</p>
              </div>
              <div className="flex items-center gap-3">
                {getStatusBadge(bill.status)}
                <button
                  onClick={() => router.push(`/bills/${id}/edit`)}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-2 rounded-lg hover:from-purple-700 hover:to-pink-700 font-medium shadow-lg transition-all"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>

          {/* Bill Summary Cards - hidden in print/export */}
          <div className={`grid grid-cols-1 gap-4 mb-6 export-hide print-hide ${bill.wht_applicable ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border border-purple-200 dark:border-purple-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-purple-900 dark:text-purple-300 font-semibold">Gross Total:</span>
                <span className="text-purple-900 dark:text-purple-300 font-bold text-xl">{currency}{Number(bill.total).toFixed(2)}</span>
              </div>
            </div>
            {bill.wht_applicable && (
              <div className={`bg-gradient-to-br rounded-xl p-4 border ${bill.wht_remitted_at ? 'from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-700' : 'from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-700'}`}>
                <div className="flex items-center justify-between">
                  <span className={`${bill.wht_remitted_at ? 'text-green-900 dark:text-green-300' : 'text-orange-900 dark:text-orange-300'} font-semibold text-sm`}>
                    WHT ({((bill.wht_rate ?? 0) * 100).toFixed(0)}%):
                  </span>
                  <span className={`${bill.wht_remitted_at ? 'text-green-900 dark:text-green-300' : 'text-orange-900 dark:text-orange-300'} font-bold text-xl`}>
                    {currency}{Number(bill.wht_amount).toFixed(2)}
                  </span>
                </div>
                <p className={`text-xs mt-1 ${bill.wht_remitted_at ? 'text-green-700 dark:text-green-400' : 'text-orange-700 dark:text-orange-400'}`}>
                  {bill.wht_remitted_at ? '✓ Remitted to GRA' : 'Pending remittance to GRA'}
                </p>
              </div>
            )}
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-green-900 dark:text-green-300 font-semibold">Total Paid:</span>
                <span className="text-green-900 dark:text-green-300 font-bold text-xl">{currency}{totalPaid.toFixed(2)}</span>
              </div>
            </div>
            <div className={`bg-gradient-to-br ${balance > 0 ? 'from-orange-50 to-orange-100 dark:from-orange-900/20 dark:to-orange-800/20 border-orange-200 dark:border-orange-700' : 'from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-green-200 dark:border-green-700'} rounded-xl p-4`}>
              <div className="flex items-center justify-between">
                <span className={`${balance > 0 ? 'text-orange-900 dark:text-orange-300' : 'text-green-900 dark:text-green-300'} font-semibold`}>Remaining:</span>
                <span className={`${balance > 0 ? 'text-orange-900 dark:text-orange-300' : 'text-green-900 dark:text-green-300'} font-bold text-xl`}>{currency}{balance.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Bill Details */}
            <div className="lg:col-span-2 space-y-6">
              {/* Supplier & Bill Info */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Bill Information</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Supplier</label>
                    <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">{bill.supplier_name}</p>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Issue Date</label>
                    <p className="text-lg font-medium text-gray-900 dark:text-white mt-1">
                      {new Date(bill.issue_date).toLocaleDateString("en-GH")}
                    </p>
                  </div>
                  {bill.supplier_phone && (
                    <div>
                      <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Phone</label>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{bill.supplier_phone}</p>
                    </div>
                  )}
                  {bill.supplier_email && (
                    <div>
                      <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Email</label>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{bill.supplier_email}</p>
                    </div>
                  )}
                  {bill.due_date && (
                    <div>
                      <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Due Date</label>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                        {new Date(bill.due_date).toLocaleDateString("en-GH")}
                      </p>
                    </div>
                  )}
                </div>
                {bill.notes && (
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    <label className="text-sm font-semibold text-gray-500 dark:text-gray-400">Notes</label>
                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">{bill.notes}</p>
                  </div>
                )}
              </div>

              {/* Line Items / Import Breakdown */}
              {bill.bill_type === "import" ? (
                /* Import duty breakdown */
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">Import / Customs Entry</h2>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                      📦 Import Bill
                    </span>
                  </div>

                  {bill.import_description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-5 italic">{bill.import_description}</p>
                  )}

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                      <span className="text-gray-600 dark:text-gray-400">CIF Value <span className="text-xs">(Cost + Insurance + Freight)</span></span>
                      <span className="font-semibold text-gray-900 dark:text-white">{currency}{Number(bill.cif_value ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-100 dark:border-gray-700">
                      <span className="text-gray-600 dark:text-gray-400">
                        Import Duty <span className="text-xs">({((Number(bill.import_duty_rate ?? 0)) * 100).toFixed(0)}% ECOWAS CET)</span>
                      </span>
                      <span className="font-medium text-gray-900 dark:text-white">{currency}{Number(bill.import_duty_amount ?? 0).toFixed(2)}</span>
                    </div>

                    {/* Port levies */}
                    {Number(bill.ecowas_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>ECOWAS Levy (0.5%)</span>
                        <span>{currency}{Number(bill.ecowas_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.au_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>AU Levy (0.2%)</span>
                        <span>{currency}{Number(bill.au_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.exim_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>EXIM Levy (0.75%)</span>
                        <span>{currency}{Number(bill.exim_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.sil_levy) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>SIL (2%)</span>
                        <span>{currency}{Number(bill.sil_levy).toFixed(2)}</span>
                      </div>
                    )}
                    {Number(bill.examination_fee) > 0 && (
                      <div className="flex justify-between py-1.5 pl-4 text-xs text-gray-500 dark:text-gray-400">
                        <span>Examination Fee (1%)</span>
                        <span>{currency}{Number(bill.examination_fee).toFixed(2)}</span>
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
                        <div className="flex justify-between py-2 border-t border-indigo-200 dark:border-indigo-700 mt-1">
                          <span className="font-semibold text-indigo-900 dark:text-indigo-200">VAT Base (landed cost)</span>
                          <span className="font-bold text-indigo-900 dark:text-indigo-200">{currency}{vatBase.toFixed(2)}</span>
                        </div>
                      )
                    })()}

                    {Number(bill.clearing_agent_fee) > 0 && (
                      <div className="flex justify-between py-2 border-t border-dashed border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                        <span>Clearing Agent Fee (posted to 5220)</span>
                        <span>{currency}{Number(bill.clearing_agent_fee).toFixed(2)}</span>
                      </div>
                    )}

                    {bill.landed_cost_account_code && (
                      <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700">
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          Landed cost posted to account {bill.landed_cost_account_code}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Standard line items */
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Line Items</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Description</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Qty</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Unit Price</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{item.description}</td>
                            <td className="px-4 py-3 text-sm text-center text-gray-700 dark:text-gray-300">{Number(item.qty)}</td>
                            <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                              {currency}{Number(item.unit_price).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-gray-900 dark:text-white">
                              {currency}{Number(item.line_subtotal).toFixed(2)}
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
                <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Tax Breakdown</h2>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">{currency}{Number(bill.subtotal).toFixed(2)}</span>
                    </div>
                    <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                      {(() => {
                        const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
                        const isGhana = countryCode === "GH"
                        
                        // CRITICAL: Only show Ghana tax labels for GH businesses
                        if (isGhana) {
                          return (
                            <>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-600 dark:text-gray-400">NHIL (2.5%):</span>
                                <span className="text-gray-900 dark:text-white">{currency}{Number(bill.nhil || 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-600 dark:text-gray-400">GETFund (2.5%):</span>
                                <span className="text-gray-900 dark:text-white">{currency}{Number(bill.getfund || 0).toFixed(2)}</span>
                              </div>
                              <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-600 dark:text-gray-400">VAT (15%):</span>
                                <span className="text-gray-900 dark:text-white">{currency}{Number(bill.vat || 0).toFixed(2)}</span>
                              </div>
                            </>
                          )
                        } else {
                          // Non-GH: Show generic VAT only
                          return (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-600 dark:text-gray-400">VAT:</span>
                              <span className="text-gray-900 dark:text-white">{currency}{Number(bill.vat || 0).toFixed(2)}</span>
                            </div>
                          )
                        }
                      })()}
                    </div>
                    <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300 dark:border-gray-600">
                      <span className="text-gray-900 dark:text-white font-bold text-lg">
                        {bill.wht_applicable ? 'Gross Total:' : 'Total:'}
                      </span>
                      <span className="font-bold text-purple-600 dark:text-purple-400 text-xl">{currency}{Number(bill.total).toFixed(2)}</span>
                    </div>
                    {bill.wht_applicable && bill.wht_amount > 0 && (
                      <>
                        <div className="flex justify-between items-center text-sm pt-2 border-t border-orange-200 dark:border-orange-700">
                          <span className="text-orange-700 dark:text-orange-400 font-medium">
                            WHT Deduction ({((bill.wht_rate ?? 0) * 100).toFixed(0)}%):
                          </span>
                          <span className="text-orange-700 dark:text-orange-400 font-semibold">
                            − {currency}{Number(bill.wht_amount).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t-2 border-orange-300 dark:border-orange-600">
                          <span className="text-orange-900 dark:text-orange-200 font-bold text-lg">Net to Supplier:</span>
                          <span className="font-bold text-orange-600 dark:text-orange-400 text-xl">
                            {currency}{(Number(bill.total) - Number(bill.wht_amount)).toFixed(2)}
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
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Payments</h2>
                  {bill.status !== "paid" && (
                    <button
                      onClick={() => setShowPaymentModal(true)}
                      className="bg-gradient-to-r from-green-600 to-green-700 text-white px-4 py-2 rounded-lg hover:from-green-700 hover:to-green-800 font-medium text-sm shadow-lg transition-all flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Payment
                    </button>
                  )}
                </div>

                {payments.length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4">No payments recorded</p>
                ) : (
                  <div className="space-y-3">
                    {payments.map((payment) => (
                      <div key={payment.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <p className="font-semibold text-gray-900 dark:text-white">{currency}{Number(payment.amount).toFixed(2)}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              {formatMethod(payment.method)} • {new Date(payment.date).toLocaleDateString("en-GH")}
                            </p>
                            {payment.reference && (
                              <p className="text-xs text-gray-500 dark:text-gray-400">Ref: {payment.reference}</p>
                            )}
                          </div>
                          <button
                            onClick={() => setEditingPayment(payment)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 p-1"
                            title="Edit payment"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Total Paid:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{currency}{totalPaid.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm mt-1">
                        <span className="text-gray-600 dark:text-gray-400">Remaining:</span>
                        <span className={`font-semibold ${balance > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'}`}>
                          {currency}{balance.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* WHT Remittance Card */}
              {bill.wht_applicable && bill.wht_amount > 0 && (
                <div className={`rounded-2xl shadow-lg p-6 border ${bill.wht_remitted_at ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700'}`}>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Withholding Tax</h2>
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">WHT Amount:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">{currency}{Number(bill.wht_amount).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Status:</span>
                      <span className={`font-semibold ${bill.wht_remitted_at ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        {bill.wht_remitted_at ? 'Remitted to GRA' : 'Pending remittance'}
                      </span>
                    </div>
                    {bill.wht_remitted_at && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Remitted on:</span>
                        <span className="text-gray-900 dark:text-white">
                          {new Date(bill.wht_remitted_at).toLocaleDateString("en-GB")}
                        </span>
                      </div>
                    )}
                    {bill.wht_remittance_ref && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">GRA Ref:</span>
                        <span className="text-gray-900 dark:text-white">{bill.wht_remittance_ref}</span>
                      </div>
                    )}
                  </div>
                  {!bill.wht_remitted_at && (
                    <a
                      href="/service/accounting/wht"
                      className="w-full block text-center bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 font-medium text-sm shadow transition-all"
                    >
                      Remit to GRA →
                    </a>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Actions</h2>
                <div className="space-y-3">
                  {bill.supplier_phone && (
                    <button
                      onClick={sendViaWhatsApp}
                      className="w-full bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
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
                      className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
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
            billId={id}
            businessId={bill.business_id}
            balance={balance}
            currencySymbol={currency}
            onClose={() => setShowPaymentModal(false)}
            onSuccess={handlePaymentAdded}
            editingPayment={editingPayment}
            businessCountry={businessCountry}
            whtApplicable={bill.wht_applicable}
            whtAmount={Number(bill.wht_amount) || 0}
          />
        )}
      </div>
    </ProtectedLayout>
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
  
  // Determine default method (first available, or bank if available)
  const defaultMethod = canUseBank ? "bank" : (canUseCash ? "cash" : (canUseMobileMoney ? "momo" : (canUseCard ? "card" : "bank")))
  
  // Net amount the supplier should receive (excludes WHT which goes to GRA)
  const netBalance = whtApplicable && whtAmount > 0 ? balance - whtAmount : balance
  const [amount, setAmount] = useState(editingPayment ? editingPayment.amount.toString() : "")
  const [date, setDate] = useState(editingPayment ? editingPayment.date : new Date().toISOString().split("T")[0])
  const [method, setMethod] = useState(editingPayment ? editingPayment.method : defaultMethod)
  const [reference, setReference] = useState(editingPayment ? editingPayment.reference || "" : "")
  const [notes, setNotes] = useState(editingPayment ? editingPayment.notes || "" : "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const hasNoAllowedMethods = allowedMethods.length === 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!amount || Number(amount) <= 0) {
      setError("Please enter a valid amount")
      return
    }

    if (Number(amount) > netBalance && !editingPayment) {
      setError(`Payment amount cannot exceed net payable (${currencySymbol}${netBalance.toFixed(2)})`)
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
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
        {/* Header - Fixed */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {editingPayment ? "Edit Payment" : "Add Payment"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1 p-6">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} id="bill-payment-form" className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Amount *</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onFocus={(e) => e.target.select()}
              required
              placeholder={editingPayment ? "" : currencySymbol + netBalance.toFixed(2)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
            />
            {!editingPayment && whtApplicable && whtAmount > 0 ? (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                  Net to supplier: {currencySymbol}{netBalance.toFixed(2)} (WHT of {currencySymbol}{whtAmount.toFixed(2)} remitted separately to GRA)
                </p>
              </div>
            ) : !editingPayment ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Balance: {currencySymbol}{balance.toFixed(2)}</p>
            ) : null}
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Date *</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Blocking banner if no methods allowed */}
          {hasNoAllowedMethods && (
            <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 text-red-800 dark:text-red-300 px-4 py-3 rounded mb-4">
              <p className="font-semibold mb-2">No payment methods available</p>
              <p className="text-sm mb-2">
                Please set your business country in <a href="/settings/business-profile" className="underline font-semibold">Business Profile</a> to enable payment methods.
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Payment Method *</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
              disabled={hasNoAllowedMethods}
            >
              {canUseCash && <option value="cash">Cash</option>}
              {canUseBank && <option value="bank">Bank Transfer</option>}
              {canUseMobileMoney && <option value="momo">{mobileMoneyLabel}</option>}
              {canUseCard && <option value="card">Card</option>}
              {/* Legacy methods always available for backward compatibility */}
              <option value="cheque">Cheque</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Reference</label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
              placeholder="Transaction reference"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 dark:bg-gray-700 dark:text-white"
              placeholder="Additional notes"
            />
          </div>
          </form>
        </div>

        {/* Sticky Footer - Fixed */}
        <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 flex gap-4 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="bill-payment-form"
            disabled={loading || hasNoAllowedMethods}
            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white px-4 py-3 rounded-lg hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 font-medium shadow-lg transition-all"
          >
            {loading ? "Saving..." : editingPayment ? "Update Payment" : "Add Payment"}
          </button>
        </div>
      </div>
    </div>
  )
}

