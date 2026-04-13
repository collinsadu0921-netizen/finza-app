"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { getTaxEngineCode } from "@/lib/taxEngine/helpers"
import { toTaxLinesJsonb } from "@/lib/taxEngine/serialize"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { MenuSelect } from "@/components/ui/MenuSelect"

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
}

type LineItem = {
  id: string
  product_service_id: string | null
  description: string
  qty: number
  unit_price: number
  discount_type: "amount" | "percent"
  discount_value: number
  /** Persisted/legacy amount stored in template. Derived from discount_type/value in the UI. */
  discount_amount: number
  _rawDiscount?: string
}

const round2 = (value: number): number => Math.round((value || 0) * 100) / 100

const getDiscountAmount = (item: Pick<LineItem, "qty" | "unit_price" | "discount_type" | "discount_value">): number => {
  const gross = Math.max(0, (Number(item.qty) || 0) * (Number(item.unit_price) || 0))
  const rawDiscount = Number(item.discount_value) || 0
  if (rawDiscount <= 0 || gross <= 0) return 0

  const discount = item.discount_type === "percent"
    ? (gross * Math.min(100, Math.max(0, rawDiscount))) / 100
    : Math.max(0, rawDiscount)

  return round2(Math.min(discount, gross))
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

  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerEmail, setNewCustomerEmail] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerAddress, setNewCustomerAddress] = useState("")
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState("")

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
        .select("id, name, email, phone, address")
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
        discount_type: "amount",
        discount_value: 0,
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
          const updated: any = { ...item, [field]: value }
          if (field === "_rawDiscount") return updated
          if (field === "qty" || field === "unit_price" || field === "discount_value" || field === "discount_type") {
            if (field === "discount_value") updated._rawDiscount = String(value)
            updated.discount_amount = getDiscountAmount(updated)
          }
          return updated
        }
        return item
      })
    )
  }

  // Calculate totals
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
    const discount = getDiscountAmount(item)
    return sum + lineTotal - discount
  }, 0)
  const totalDiscount = items.reduce((sum, item) => sum + getDiscountAmount(item), 0)

  const effectiveDate = new Date().toISOString().split("T")[0]
  const taxResult = applyTaxes
    ? getCanonicalTaxResultFromLineItems(
        items.map((item) => ({
          quantity: Number(item.qty) || 0,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: getDiscountAmount(item),
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

  const customerMenuOptions = useMemo(
    () => [
      { value: "", label: "Select a customer..." },
      ...customers.map((c) => ({ value: c.id, label: c.name })),
    ],
    [customers]
  )

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    setCustomerError("")
    if (!newCustomerName.trim()) {
      setCustomerError("Customer name is required")
      return
    }
    try {
      setCreatingCustomer(true)
      const { data: newCustomer, error: insertError } = await supabase
        .from("customers")
        .insert({
          business_id: businessId,
          name: newCustomerName.trim(),
          email: newCustomerEmail.trim() || null,
          phone: newCustomerPhone.trim() || null,
          address: newCustomerAddress.trim() || null,
        })
        .select()
        .single()

      if (insertError) {
        setCustomerError(insertError.message || "Failed to create customer")
        setCreatingCustomer(false)
        return
      }

      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name, email, phone, address")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("name", { ascending: true })
      setCustomers(customersData || [])
      if (newCustomer) setSelectedCustomerId(newCustomer.id)
      setNewCustomerName("")
      setNewCustomerEmail("")
      setNewCustomerPhone("")
      setNewCustomerAddress("")
      setShowCustomerModal(false)
      setCreatingCustomer(false)
    } catch (err: any) {
      setCustomerError(err.message || "Failed to create customer")
      setCreatingCustomer(false)
    }
  }

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
            discount_amount: getDiscountAmount(item),
          })),
          { jurisdiction, effectiveDate: effectiveDateForTemplate, taxInclusive: true }
        )

      const invoiceTemplateData: Record<string, unknown> = {
        line_items: items.map((item) => ({
          product_service_id: item.product_service_id,
          description: item.description,
          qty: item.qty,
          unit_price: item.unit_price,
          discount_amount: getDiscountAmount(item),
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
      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 pb-20 font-sans">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-8">
            <button
              type="button"
              onClick={() => router.back()}
              className="group flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to recurring
            </button>
            <span className="text-xs text-slate-400 font-mono">TEMPLATE</span>
          </div>

          {error && (
            <div className="mb-6 rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">{error}</div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="p-8 border-b border-slate-100 dark:border-slate-700">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-1">
                  Recurring invoice template
                </h1>
                <p className="text-sm text-slate-500">
                  Schedule automatic invoices from this template
                </p>
              </div>

              <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 border-b border-slate-100 dark:border-slate-700">
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Bill To</label>
                    <button
                      type="button"
                      onClick={() => setShowCustomerModal(true)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      New Customer
                    </button>
                  </div>
                  <MenuSelect
                    value={selectedCustomerId}
                    onValueChange={setSelectedCustomerId}
                    options={customerMenuOptions}
                    placeholder="Select a customer..."
                    size="lg"
                    className="bg-slate-50 hover:bg-slate-100 dark:bg-slate-700"
                  />
                  {selectedCustomerId && (() => {
                    const c = customers.find((x) => x.id === selectedCustomerId)
                    if (c?.address || c?.email || c?.phone) {
                      return (
                        <div className="text-xs text-slate-500 pl-1 space-y-1 border-l-2 border-slate-100 dark:border-slate-700">
                          {c.address && <p>{c.address}</p>}
                          {c.email && <p>{c.email}</p>}
                          {c.phone && <p>{c.phone}</p>}
                        </div>
                      )
                    }
                    return null
                  })()}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Frequency
                    </label>
                    <NativeSelect
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly")}
                      required
                      size="md"
                    >
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Bi-weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option>
                    </NativeSelect>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                      Next run date
                    </label>
                    <input
                      type="date"
                      value={nextRunDate}
                      onChange={(e) => setNextRunDate(e.target.value)}
                      required
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                    />
                  </div>
                  <div className="space-y-3 pt-1">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoSend}
                        onChange={(e) => setAutoSend(e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Auto-send invoice when generated
                      </span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoWhatsApp}
                        onChange={(e) => setAutoWhatsApp(e.target.checked)}
                        className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                      />
                      <span className="ml-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                        Auto-send via WhatsApp (recommended)
                      </span>
                    </label>
                  </div>
                </div>
              </div>

            {/* Invoice template — line items */}
            <div className="p-8 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Line items</h2>
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Item
                </button>
              </div>

              {items.length === 0 ? (
                <p className="text-slate-500 text-center py-8 text-sm">No line items yet</p>
              ) : (
                <div className="space-y-4">
                  {items.map((item) => (
                    <div key={item.id} className="grid grid-cols-12 gap-4 p-4 border border-slate-200 rounded-lg bg-slate-50/50">
                      <div className="col-span-12 md:col-span-4">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Product/Service</label>
                        <NativeSelect
                          value={item.product_service_id || ""}
                          onChange={(e) => updateItem(item.id, "product_service_id", e.target.value)}
                          size="sm"
                        >
                          <option value="">Select or type description</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name}
                            </option>
                          ))}
                        </NativeSelect>
                      </div>
                      <div className="col-span-12 md:col-span-4">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateItem(item.id, "description", e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                          placeholder="Item description"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Qty</label>
                        <input
                          type="number"
                          value={item.qty}
                          onChange={(e) => updateItem(item.id, "qty", Number(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-2">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Unit Price</label>
                        <input
                          type="number"
                          value={item.unit_price}
                          onChange={(e) => updateItem(item.id, "unit_price", Number(e.target.value) || 0)}
                          min="0"
                          step="0.01"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Discount</label>
                        <div className="flex items-center gap-2">
                          <NativeSelect
                            value={item.discount_type}
                            onChange={(e) => updateItem(item.id, "discount_type", e.target.value as any)}
                            size="sm"
                            wrapperClassName="w-20 shrink-0"
                          >
                            <option value="amount">Amt</option>
                            <option value="percent">%</option>
                          </NativeSelect>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item._rawDiscount ?? (item.discount_value === 0 ? "" : String(item.discount_value))}
                            onChange={(e) => updateItem(item.id, "discount_value", e.target.value)}
                            onBlur={() => updateItem(item.id, "_rawDiscount", undefined)}
                            placeholder={item.discount_type === "percent" ? "0" : "0.00"}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white text-right tabular-nums"
                          />
                        </div>
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
              <div className="mt-6 pt-6 border-t border-slate-100">
                <label className="flex items-center cursor-pointer">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-slate-900">
                        Apply Ghana Taxes
                      </label>
                      <p className="text-xs text-slate-500 mt-1">
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
                        ${applyTaxes ? 'bg-blue-600' : 'bg-slate-200'}
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
              <div className="mt-6 pt-6 border-t border-slate-100">
                <div className="flex justify-end">
                  <div className="w-full max-w-sm space-y-3 bg-slate-50 rounded-lg p-5 border border-slate-200">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 text-sm font-medium">
                        {applyTaxes ? "Subtotal (before tax)" : "Subtotal"}
                      </span>
                      <span className="font-semibold text-slate-900 text-base tabular-nums">₵{displaySubtotal.toFixed(2)}</span>
                    </div>
                    {totalDiscount > 0 && (
                      <div className="flex justify-between items-center text-sm text-slate-600">
                        <span>Discounts</span>
                        <span className="font-medium text-rose-600 tabular-nums">−₵{totalDiscount.toFixed(2)}</span>
                      </div>
                    )}
                    {applyTaxes && taxResult && taxResult.lines.length > 0 && (
                      <>
                        <div className="space-y-1 pt-2 border-t border-slate-200">
                          {taxResult.lines
                            .filter((line) => line.amount !== 0)
                            .map((line) => (
                              <div key={line.code} className="flex justify-between items-center text-sm">
                                <span className="text-slate-600">
                                  {line.name || line.code}
                                  {line.rate != null ? ` (${(line.rate * 100).toFixed(1)}%)` : ""}:
                                </span>
                                <span className="text-slate-800 tabular-nums">₵{line.amount.toFixed(2)}</span>
                              </div>
                            ))}
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200">
                          <span className="text-slate-700 text-sm font-medium">Total tax</span>
                          <span className="font-semibold text-slate-900 tabular-nums">₵{displayTotalTax.toFixed(2)}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between items-center pt-3 border-t border-slate-200">
                      <span className="text-slate-900 font-bold">Total</span>
                      <span className="font-bold text-slate-900 text-lg tabular-nums">₵{displayTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-8 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Additional information</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Payment Terms
                  </label>
                  <textarea
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    rows={2}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    placeholder="e.g., Payment is due within 30 days"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-slate-800 dark:border-slate-600 dark:text-white"
                    placeholder="Additional notes for invoices"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-3 p-8 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => router.back()}
                className="flex-1 inline-flex justify-center items-center px-4 py-2.5 text-sm font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
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
                  "Create recurring invoice"
                )}
              </button>
            </div>
            </div>
          </form>

          {showCustomerModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/60" onClick={() => setShowCustomerModal(false)} aria-hidden />
              <div
                className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">New Customer</h3>
                {customerError && (
                  <div className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 p-2 rounded mb-4">{customerError}</div>
                )}
                <form onSubmit={handleCreateCustomer} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name <span className="text-red-500">*</span></label>
                    <input
                      autoFocus
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                    <input
                      type="text"
                      inputMode="email"
                      value={newCustomerEmail}
                      onChange={(e) => setNewCustomerEmail(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                    <input
                      type="text"
                      inputMode="tel"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
                    <textarea
                      value={newCustomerAddress}
                      onChange={(e) => setNewCustomerAddress(e.target.value)}
                      rows={2}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => { setShowCustomerModal(false); setCustomerError("") }}
                      className="flex-1 border border-gray-300 dark:border-gray-600 rounded-lg py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={creatingCustomer || !newCustomerName.trim()}
                      className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {creatingCustomer ? "Creating..." : "Create Customer"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  )
}

