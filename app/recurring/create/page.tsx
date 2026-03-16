"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { getTaxEngineCode } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { normalizeCountry } from "@/lib/payments/eligibility"

type Customer = {
  id: string
  name: string
}

type LineItem = {
  id: string
  product_service_id: string | null
  description: string
  qty: number
  unit_price: number
  discount_amount: number
}

export default function CreateRecurringInvoicePage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("")
  const [frequency, setFrequency] = useState<"weekly" | "biweekly" | "monthly" | "quarterly" | "yearly">("monthly")
  const [nextRunDate, setNextRunDate] = useState<string>("")
  const [autoSend, setAutoSend] = useState(false)
  const [autoWhatsApp, setAutoWhatsApp] = useState(true)
  const [items, setItems] = useState<LineItem[]>([])
  const [notes, setNotes] = useState("")
  const [paymentTerms, setPaymentTerms] = useState("")
  const [applyTaxes, setApplyTaxes] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [businessCountry, setBusinessCountry] = useState<string>("GH")

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    // Set default next run date based on frequency
    if (frequency && !nextRunDate) {
      const today = new Date()
      let nextDate = new Date(today)

      switch (frequency) {
        case "weekly":
          nextDate.setDate(today.getDate() + 7)
          break
        case "biweekly":
          nextDate.setDate(today.getDate() + 14)
          break
        case "monthly":
          nextDate.setMonth(today.getMonth() + 1)
          break
        case "quarterly":
          nextDate.setMonth(today.getMonth() + 3)
          break
        case "yearly":
          nextDate.setFullYear(today.getFullYear() + 1)
          break
      }

      setNextRunDate(nextDate.toISOString().split("T")[0])
    }
  }, [frequency])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)
      const country = normalizeCountry((business as any).address_country)
      setBusinessCountry(country && country !== "__UNSUPPORTED__" ? country : "GH")

      // Load customers
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])

      // Load products/services
      const { data: productsData } = await supabase
        .from("products_services")
        .select("id, name, default_price, default_apply_taxes")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setProducts(productsData || [])

      // Load invoice settings for defaults
      const { data: invoiceSettings } = await supabase
        .from("invoice_settings")
        .select("*")
        .eq("business_id", business.id)
        .maybeSingle()

      if (invoiceSettings) {
        setPaymentTerms(invoiceSettings.default_payment_terms || "")
      }
    } catch (err: any) {
      console.error("Error loading data:", err)
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        product_service_id: null,
        description: "",
        qty: 1,
        unit_price: 0,
        discount_amount: 0,
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof LineItem, value: any) => {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          if (field === "product_service_id" && value) {
            const product = products.find((p) => p.id === value)
            return {
              ...item,
              product_service_id: value,
              description: product?.name || item.description,
              unit_price: product?.default_price || item.unit_price,
            }
          }
          return { ...item, [field]: value }
        }
        return item
      })
    )
  }

  // Calculate totals
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
    const discount = Number(item.discount_amount) || 0
    return sum + lineTotal - discount
  }, 0)

  const effectiveDate = new Date().toISOString().split("T")[0]
  const taxResult = applyTaxes
    ? getCanonicalTaxResultFromLineItems(
        items.map((item) => ({
          quantity: Number(item.qty) || 0,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: Number(item.discount_amount) || 0,
        })),
        {
          jurisdiction: businessCountry,
          effectiveDate,
          taxInclusive: true,
        }
      )
    : null
  const displaySubtotal = applyTaxes && taxResult ? taxResult.base_amount : subtotal
  const displayTotalTax = applyTaxes && taxResult ? taxResult.total_tax : 0
  const displayTotal = applyTaxes && taxResult ? taxResult.total_amount : subtotal

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!selectedCustomerId) {
      setError("Please select a customer")
      return
    }

    if (items.length === 0) {
      setError("Please add at least one line item")
      return
    }

    if (!nextRunDate) {
      setError("Please set the next run date")
      return
    }

    try {
      setLoading(true)

      const effectiveDateForTemplate = new Date().toISOString().split("T")[0]
      const jurisdiction = businessCountry
      const taxResultForTemplate =
        applyTaxes &&
        getCanonicalTaxResultFromLineItems(
          items.map((item) => ({
            quantity: Number(item.qty) || 0,
            unit_price: Number(item.unit_price) || 0,
            discount_amount: Number(item.discount_amount) || 0,
          })),
          { jurisdiction, effectiveDate: effectiveDateForTemplate, taxInclusive: true }
        )

      const invoiceTemplateData: Record<string, unknown> = {
        line_items: items.map((item) => ({
          product_service_id: item.product_service_id,
          description: item.description,
          qty: item.qty,
          unit_price: item.unit_price,
          discount_amount: item.discount_amount,
        })),
        notes: notes || null,
        payment_terms: paymentTerms || null,
        apply_taxes: applyTaxes,
      }
      if (applyTaxes && taxResultForTemplate) {
        invoiceTemplateData.tax_lines = toTaxLinesJsonb(taxResultForTemplate)
        invoiceTemplateData.tax_engine_code = getTaxEngineCode(jurisdiction)
        invoiceTemplateData.tax_engine_effective_from = effectiveDateForTemplate
        invoiceTemplateData.tax_jurisdiction = jurisdiction
        invoiceTemplateData.subtotal = Math.round(taxResultForTemplate.base_amount * 100) / 100
        invoiceTemplateData.total_tax = Math.round(taxResultForTemplate.total_tax * 100) / 100
        invoiceTemplateData.total = Math.round(taxResultForTemplate.total_amount * 100) / 100
      }

      const response = await fetch("/api/recurring-invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          customer_id: selectedCustomerId,
          frequency,
          next_run_date: nextRunDate,
          auto_send: autoSend,
          auto_whatsapp: autoWhatsApp,
          invoice_template_data: invoiceTemplateData,
          status: "active",
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setError(errorData.error || "Failed to create recurring invoice")
        setLoading(false)
        return
      }

      const { recurringInvoice } = await response.json()
      router.push(`/recurring/${recurringInvoice.id}/view`)
    } catch (err: any) {
      setError(err.message || "Failed to create recurring invoice")
      setLoading(false)
    }
  }

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <button
              onClick={() => router.back()}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white mb-4 flex items-center gap-2 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
              Create Recurring Invoice
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-lg">Set up automated recurring billing</p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Settings */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Recurring Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Customer *
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Frequency *
                  </label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as any)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Bi-weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Next Run Date *
                  </label>
                  <input
                    type="date"
                    value={nextRunDate}
                    onChange={(e) => setNextRunDate(e.target.value)}
                    required
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoSend}
                    onChange={(e) => setAutoSend(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    Auto-send invoice when generated
                  </span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoWhatsApp}
                    onChange={(e) => setAutoWhatsApp(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    Auto-send via WhatsApp (recommended)
                  </span>
                </label>
              </div>
            </div>

            {/* Invoice Template */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">Invoice Template</h2>
                <button
                  type="button"
                  onClick={addItem}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium text-sm transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Item
                </button>
              </div>

              {items.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">No items added yet</p>
              ) : (
                <div className="space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="grid grid-cols-12 gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="col-span-12 md:col-span-4">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Product/Service</label>
                        <select
                          value={item.product_service_id || ""}
                          onChange={(e) => updateItem(item.id, "product_service_id", e.target.value)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">Select or type description</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-12 md:col-span-4">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Description</label>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateItem(item.id, "description", e.target.value)}
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                          placeholder="Item description"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Qty</label>
                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) => updateItem(item.id, "qty", Number(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-2">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Unit Price</label>
                        <input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => updateItem(item.id, "unit_price", Number(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Discount</label>
                        <input
                          type="number"
                          value={item.discount_amount}
                          onChange={(e) => updateItem(item.id, "discount_amount", Number(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                        />
                      </div>
                      <div className="col-span-12 md:col-span-1 flex items-end">
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 p-2"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tax Toggle */}
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <label className="flex items-center cursor-pointer">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-900">
                        Apply Ghana Taxes
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        Include NHIL, GETFund, and VAT
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={applyTaxes}
                      onClick={() => setApplyTaxes(!applyTaxes)}
                      className={`
                        relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                        ${applyTaxes ? 'bg-blue-600' : 'bg-gray-200'}
                      `}
                    >
                      <span
                        className={`
                          pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                          transition duration-200 ease-in-out
                          ${applyTaxes ? 'translate-x-5' : 'translate-x-0'}
                        `}
                      />
                    </button>
                  </div>
                </label>
              </div>

              {/* Totals Preview */}
              <div className="mt-6 pt-6 border-t-2 border-gray-300 dark:border-gray-600">
                <div className="flex justify-end">
                  <div className="w-72 space-y-3 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-600 rounded-lg p-5 border border-gray-200 dark:border-gray-600">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-700 dark:text-gray-300 font-medium">
                        {applyTaxes ? "Subtotal (before tax):" : "Subtotal:"}
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white text-lg">₵{displaySubtotal.toFixed(2)}</span>
                    </div>
                    {applyTaxes && taxResult && taxResult.lines.length > 0 && (
                      <>
                        <div className="space-y-1 pt-2 border-t border-gray-200 dark:border-gray-500">
                          {taxResult.lines
                            .filter((line) => line.amount !== 0)
                            .map((line) => (
                              <div key={line.code} className="flex justify-between items-center text-sm">
                                <span className="text-gray-600 dark:text-gray-400">
                                  {line.name || line.code}
                                  {line.rate != null ? ` (${(line.rate * 100).toFixed(1)}%)` : ""}:
                                </span>
                                <span className="text-gray-700 dark:text-gray-300">₵{line.amount.toFixed(2)}</span>
                              </div>
                            ))}
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-500">
                          <span className="text-gray-700 dark:text-gray-300 font-medium">Total Tax:</span>
                          <span className="font-semibold text-gray-900 dark:text-white">₵{displayTotalTax.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300 dark:border-gray-500">
                      <span className="text-gray-900 dark:text-white font-bold text-lg">Total:</span>
                      <span className="font-bold text-blue-600 dark:text-blue-400 text-xl">₵{displayTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Additional Fields */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Additional Information</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Payment Terms
                  </label>
                  <textarea
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., Payment is due within 30 days"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="Additional notes for invoices"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex-1 bg-white dark:bg-gray-700 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 font-medium transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 font-medium shadow-lg transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating...
                  </>
                ) : (
                  "Create Recurring Invoice"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ProtectedLayout>
  )
}

