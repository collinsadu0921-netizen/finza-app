"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { calculateGhanaTaxesFromLineItems, calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"
import { getCurrencySymbol } from "@/lib/currency"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { MenuSelect } from "@/components/ui/MenuSelect"

type Customer = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  address?: string | null
}

type EstimateItem = {
  id: string
  product_id: string | null
  description: string
  quantity: number
  price: number
  total: number
  discount_type: "amount" | "percent"
  discount_value: number
  /** Derived for API/tax calc; persisted implicitly via `total` (line_total). */
  discount_amount?: number
  _rawDiscount?: string
}

const round2 = (value: number): number => Math.round((value || 0) * 100) / 100

const getDiscountAmount = (item: Pick<EstimateItem, "quantity" | "price" | "discount_type" | "discount_value">): number => {
  const gross = Math.max(0, (Number(item.quantity) || 0) * (Number(item.price) || 0))
  const rawDiscount = Number(item.discount_value) || 0
  if (rawDiscount <= 0 || gross <= 0) return 0

  const discount = item.discount_type === "percent"
    ? (gross * Math.min(100, Math.max(0, rawDiscount))) / 100
    : Math.max(0, rawDiscount)

  return round2(Math.min(discount, gross))
}

const getLineTotal = (item: Pick<EstimateItem, "quantity" | "price" | "discount_type" | "discount_value">): number => {
  const gross = (Number(item.quantity) || 0) * (Number(item.price) || 0)
  return round2(Math.max(0, gross - getDiscountAmount(item)))
}

export default function NewEstimatePage() {
  const router = useRouter()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("")
  const [estimateNumber, setEstimateNumber] = useState<string>("")
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [expiryDate, setExpiryDate] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [items, setItems] = useState<EstimateItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(null)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerEmail, setNewCustomerEmail] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerAddress, setNewCustomerAddress] = useState("")
  const [newCustomerTin, setNewCustomerTin] = useState("")
  const [newCustomerWhatsapp, setNewCustomerWhatsapp] = useState("")
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState("")
  const [applyGhanaTax, setApplyGhanaTax] = useState(true)
  const [businessCurrencyCode, setBusinessCurrencyCode] = useState<string | null>(null)

  // FX (foreign currency) settings
  const [fxEnabled, setFxEnabled] = useState(false)
  const [fxCurrencyCode, setFxCurrencyCode] = useState<string>("USD")
  const [fxRate, setFxRate] = useState<string>("")

  // Symbol used for all amount displays — switches to FX symbol when FX is enabled
  const homeCurrencySymbol = getCurrencySymbol(businessCurrencyCode || "") || "₵"
  const displaySymbol = fxEnabled && fxCurrencyCode
    ? (getCurrencySymbol(fxCurrencyCode) || fxCurrencyCode)
    : homeCurrencySymbol

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) return

      setBusinessId(business.id)
      const industry = (business as { industry?: string }).industry ?? null
      setBusinessIndustry(industry)

      const { data: bizDetails } = await supabase
        .from("businesses")
        .select("default_currency")
        .eq("id", business.id)
        .single()
      setBusinessCurrencyCode(bizDetails?.default_currency || null)

      // Load customers
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name, email, phone, address")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])

      // Load items: service_catalog for service industry, else products_services (no retail products)
      if (industry === "service") {
        const { data: catalogData, error: catalogErr } = await supabase
          .from("service_catalog")
          .select("*")
          .eq("business_id", business.id)
          .eq("is_active", true)
          .order("name", { ascending: true })
        if (catalogErr) {
          console.error("Error loading service catalog:", catalogErr)
          setProducts([])
        } else {
          setProducts((catalogData || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.default_price) ?? 0,
            tax_code: p.tax_code ?? null,
          })))
        }
      } else {
      const { data: productsData, error: productsError } = await supabase
        .from("products_services")
        .select("id, name, unit_price")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      if (productsError) {
        console.error("Error loading products:", {
          message: productsError.message,
          code: productsError.code,
          details: productsError.details,
          hint: productsError.hint,
          fullError: productsError
        })
        setProducts([])
      } else {
        const mappedProducts = (productsData || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          price: Number(p.unit_price) || 0,
        }))
        console.log(`✅ Loaded ${mappedProducts.length} products for estimate`)
        setProducts(mappedProducts)
      }
      }

      // Generate quote number (QUO-XXXX); existing EST- records unchanged
      try {
        const { data: lastQuote } = await supabase
          .from("estimates")
          .select("estimate_number")
          .eq("business_id", business.id)
          .like("estimate_number", "QUO-%")
          .order("estimate_number", { ascending: false })
          .limit(1)
          .maybeSingle()
        const lastNum = lastQuote?.estimate_number
          ? parseInt(lastQuote.estimate_number.replace("QUO-", ""), 10) || 0
          : 0
        setEstimateNumber(`QUO-${String(lastNum + 1).padStart(4, "0")}`)
      } catch {
        setEstimateNumber("QUO-0001")
      }

      // Set default expiry date (30 days from now)
      const expiry = new Date()
      expiry.setDate(expiry.getDate() + 30)
      setExpiryDate(expiry.toISOString().split("T")[0])
    } catch (err: any) {
      console.error("Error loading data:", err)
      setError(err.message || "Failed to load data")
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        product_id: null,
        description: "",
        quantity: 1,
        price: 0,
        total: 0,
        discount_type: "amount",
        discount_value: 0,
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof EstimateItem, value: any) => {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          // Handle numeric fields as numbers, ensuring proper conversion
          const updated = { ...item }
          if (field === "_rawDiscount") {
            updated._rawDiscount = value
            return updated
          }
          if (field === "quantity" || field === "price" || field === "discount_value") {
            if (field === "discount_value") updated._rawDiscount = String(value)
            const numValue = value === "" || value === null || value === undefined ? 0 : Number(value)
            updated[field] = isNaN(numValue) ? 0 : numValue
            updated.total = getLineTotal(updated)
            updated.discount_amount = getDiscountAmount(updated)
          } else if (field === "discount_type") {
            updated.discount_type = value as any
            updated.total = getLineTotal(updated)
            updated.discount_amount = getDiscountAmount(updated)
          } else {
            (updated as any)[field] = value
          }
          return updated
        }
        return item
      })
    )
  }

  const selectProduct = (itemId: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (product) {
      // Find the current item to get its quantity
      const currentItem = items.find((item) => item.id === itemId)
      const quantity = currentItem?.quantity || 1
      const productPrice = Number(product.price) || 0
      const total = getLineTotal({ ...currentItem, quantity, price: productPrice } as any)

      // Update all fields at once to avoid multiple state updates
      setItems(
        items.map((item) => {
          if (item.id === itemId) {
            return {
              ...item,
              product_id: productId,
              description: product.name || "",
              price: productPrice,
              total: total,
              discount_amount: getDiscountAmount({ ...item, quantity, price: productPrice } as any),
            }
          }
          return item
        })
      )
    } else {
      console.warn("Product not found:", productId)
    }
  }

  // Calculate subtotal from line items
  // When taxes are applied, prices are always treated as tax-inclusive (like invoices)
  const subtotal = items.reduce((sum, item) => {
    return sum + getLineTotal(item)
  }, 0)
  const totalDiscount = items.reduce((sum, item) => sum + getDiscountAmount(item), 0)

  // Calculate taxes using tax engine - treat entered prices as tax-inclusive
  let taxBreakdown: ReturnType<typeof calculateBaseFromTotalIncludingTaxes>["taxBreakdown"] | null = null
  let baseSubtotal = subtotal
  let tax = 0
  let total = subtotal

  if (applyGhanaTax && items.length > 0 && subtotal > 0) {
    // Reverse calculate base amount from tax-inclusive total
    const reverseCalc = calculateBaseFromTotalIncludingTaxes(subtotal, true)
    baseSubtotal = reverseCalc.baseAmount
    taxBreakdown = reverseCalc.taxBreakdown

    // Total is the tax-inclusive amount (same as subtotal from line items)
    tax = taxBreakdown.totalTax
    total = taxBreakdown.grandTotal // This should equal subtotal (tax-inclusive)
  }

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    setCustomerError("")

    if (!newCustomerName.trim()) {
      setCustomerError("Customer name is required")
      return
    }

    try {
      setCreatingCustomer(true)

      const { data: newCustomer, error: insertError } = await supabase.from("customers").insert({
        business_id: businessId,
        name: newCustomerName.trim(),
        email: newCustomerEmail.trim() || null,
        phone: newCustomerPhone.trim() || null,
        address: newCustomerAddress.trim() || null,
        tin: newCustomerTin.trim() || null,
        whatsapp_phone: newCustomerWhatsapp.trim() || null,
      }).select().single()

      if (insertError) {
        setCustomerError(insertError.message || "Failed to create customer")
        setCreatingCustomer(false)
        return
      }

      // Reload customers list
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name, email, phone, address")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])
      setSelectedCustomerId(newCustomer.id)
      setShowCustomerModal(false)
      setNewCustomerName("")
      setNewCustomerEmail("")
      setNewCustomerPhone("")
      setNewCustomerAddress("")
      setNewCustomerTin("")
      setNewCustomerWhatsapp("")
      setCreatingCustomer(false)
    } catch (err: any) {
      setCustomerError(err.message || "Failed to create customer")
      setCreatingCustomer(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!businessId) {
      setError("Business ID not found. Please refresh the page.")
      return
    }

    if (items.length === 0) {
      setError("Please add at least one item")
      return
    }

    if (!issueDate) {
      setError("Issue date is required")
      return
    }

    // Validate items
    const invalidItems = items.filter(item => !item.description.trim() || item.quantity <= 0 || item.price <= 0)
    if (invalidItems.length > 0) {
      setError("Please fill in all item fields (description, quantity, and price)")
      return
    }

    setLoading(true)

    const doCreate = async (quoteNum: string) => {
      const response = await fetch("/api/estimates/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          customer_id: selectedCustomerId || null,
          estimate_number: quoteNum,
          issue_date: issueDate,
          expiry_date: expiryDate || null,
          notes: notes || null,
          items: items.map(item => ({
            product_id: item.product_id,
            product_service_id: item.product_id,
            description: item.description || "",
            quantity: Number(item.quantity) || 0,
            qty: Number(item.quantity) || 0,
            price: Number(item.price) || 0,
            unit_price: Number(item.price) || 0,
            discount_amount: getDiscountAmount(item),
            total: getLineTotal(item),
          })),
          apply_taxes: applyGhanaTax,
          ...(fxEnabled && fxCurrencyCode && fxRate ? {
            currency_code: fxCurrencyCode,
            fx_rate: parseFloat(fxRate),
          } : {}),
        }),
      })
      const data = await response.json()
      return { response, data }
    }

    try {
      let { response, data } = await doCreate(estimateNumber)
      const isDuplicate = !response.ok && (
        /duplicate|unique|already exists/i.test(data?.error || "") ||
        (response.status === 500 && /estimate_number|quote/i.test(data?.error || ""))
      )

      if (isDuplicate) {
        const match = estimateNumber.match(/^QUO-(\d+)$/i)
        const nextNum = match ? String(parseInt(match[1], 10) + 1).padStart(4, "0") : "0001"
        const nextQuoteNum = `QUO-${nextNum}`
        setEstimateNumber(nextQuoteNum)
        const retry = await doCreate(nextQuoteNum)
        response = retry.response
        data = retry.data
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || "Failed to create quote")
      }

      if (data.success && data.estimateId) {
        router.push(`/service/estimates/${data.estimateId}/view`)
      } else {
        throw new Error("Invalid response from server")
      }
    } catch (err: any) {
      setError(err.message || "Failed to create quote")
      setLoading(false)
    }
  }

  const customerMenuOptions = useMemo(
    () => [
      { value: "", label: "Select a customer..." },
      ...customers.map((c) => ({ value: c.id, label: c.name })),
    ],
    [customers]
  )

  return (
    <ProtectedLayout>
      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 pb-20 font-sans">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* Header / Nav */}
          <div className="flex items-center justify-between mb-8">
            <button
              type="button"
              onClick={() => router.back()}
              className="group flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
            >
              <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Quotes
            </button>
            <span className="text-xs text-slate-400 font-mono">NEW QUOTE</span>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="mb-6 rounded-md bg-red-50 border border-red-200 p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Main Document Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">

              {/* 1. Header Section */}
              <div className="p-8 border-b border-slate-100 dark:border-slate-700">
                <div className="flex flex-col md:flex-row justify-between items-start gap-8">
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-1">New Quote</h1>
                    <p className="text-sm text-slate-500">Drafting a new quote for your customer</p>
                  </div>
                  <div className="w-full md:w-auto flex flex-col items-end gap-1">
                    <div className="text-right">
                      <span className="block text-xs uppercase font-bold text-slate-400 tracking-wider mb-1">Quote Number</span>
                      <input
                        type="text"
                        value={estimateNumber}
                        onChange={(e) => setEstimateNumber(e.target.value)}
                        className="text-sm font-mono text-slate-600 bg-slate-50 px-3 py-1.5 rounded border border-slate-200 text-right w-36 focus:ring-blue-500 focus:border-blue-500"
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Customer & Dates Section */}
              <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
                {/* Customer Selection */}
                <div className="space-y-4">
                  <div className="flex justify-between items-end">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Quote To</label>
                    <button
                      type="button"
                      onClick={() => setShowCustomerModal(true)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1"
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

                {/* Dates & Tax Toggle */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Issue Date</label>
                    <input
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Expiry Date</label>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5"
                    />
                  </div>
                  {/* Tax toggle moved to summary for clarity */}

                  {/* FX Currency Section */}
                  <div className="col-span-2 pt-1">
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-md border border-slate-100">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-slate-700">Quote in foreign currency?</span>
                        <p className="text-xs text-slate-500">Issue this quote in USD, EUR, GBP, etc. — booked in {businessCurrencyCode || "home currency"}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={fxEnabled}
                        onClick={() => setFxEnabled(!fxEnabled)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${fxEnabled ? "bg-blue-600" : "bg-slate-300"}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${fxEnabled ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {fxEnabled && (
                      <div className="mt-3 grid grid-cols-2 gap-3 p-3 bg-blue-50 rounded-md border border-blue-100">
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Quote Currency</label>
                          <NativeSelect
                            value={fxCurrencyCode}
                            onChange={(e) => setFxCurrencyCode(e.target.value)}
                            className="bg-white dark:bg-slate-800"
                            size="sm"
                          >
                            <option value="USD">USD — US Dollar</option>
                            <option value="EUR">EUR — Euro</option>
                            <option value="GBP">GBP — British Pound</option>
                            <option value="KES">KES — Kenyan Shilling</option>
                            <option value="NGN">NGN — Nigerian Naira</option>
                            <option value="ZAR">ZAR — South African Rand</option>
                          </NativeSelect>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                            Rate: 1 {fxCurrencyCode} = ? {businessCurrencyCode || "home"}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={fxRate}
                            onChange={(e) => setFxRate(e.target.value)}
                            placeholder="e.g. 14.50"
                            className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-md p-2 focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        {fxRate && !isNaN(parseFloat(fxRate)) && parseFloat(fxRate) > 0 && (
                          <p className="col-span-2 text-xs text-blue-700">
                            Prices entered in {fxCurrencyCode}. Booked in {businessCurrencyCode} at rate {parseFloat(fxRate).toFixed(4)}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 3. Line Items Table */}
              <div className="border-t border-slate-200 dark:border-slate-700">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[56rem] table-fixed text-sm text-left">
                    <colgroup>
                      <col style={{ width: "38%" }} />
                      <col style={{ width: "5.75rem" }} />
                      <col style={{ width: "9.5rem" }} />
                      <col style={{ width: "13.5rem" }} />
                      <col style={{ width: "9.5rem" }} />
                      <col style={{ width: "2.75rem" }} />
                    </colgroup>
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 uppercase border-b border-slate-200">
                      <tr>
                        <th className="min-w-0 px-4 py-3 font-semibold sm:px-6">Item Description</th>
                        <th className="whitespace-nowrap px-3 py-3 text-center font-semibold sm:px-4">Qty</th>
                        <th className="whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4">Price</th>
                        <th className="whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4">Discount</th>
                        <th className="whitespace-nowrap px-4 py-3 text-right font-semibold sm:px-6">Total</th>
                        <th className="w-10 py-3" aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic bg-slate-50/30">
                            No line items added. Click "Add Line Item" below to start.
                          </td>
                        </tr>
                      ) : (
                        items.map((item) => (
                          <tr key={item.id} className="group hover:bg-slate-50/50 transition-colors">
                            <td className="min-w-0 px-4 py-3 align-top sm:px-6">
                              <div className="space-y-1.5">
                                <NativeSelect
                                  value={item.product_id || ""}
                                  onChange={(e) => {
                                    const selectedProductId = e.target.value
                                    if (selectedProductId) {
                                      selectProduct(item.id, selectedProductId)
                                    } else {
                                      updateItem(item.id, "product_id", null)
                                      updateItem(item.id, "description", "")
                                      updateItem(item.id, "price", 0)
                                      updateItem(item.id, "total", 0)
                                    }
                                  }}
                                  size="sm"
                                >
                                  <option value="">{businessIndustry === "service" ? "Select Service" : "Select product/service"}</option>
                                  {products.length === 0 ? (
                                    <option value="" disabled>{businessIndustry === "service" ? "No services available. Create services first." : "No products available. Create products first."}</option>
                                  ) : (
                                    products.map((product) => (
                                      <option key={product.id} value={product.id}>
                                        {product.name} — {homeCurrencySymbol} {Number(product.price || 0).toFixed(2)}
                                      </option>
                                    ))
                                  )}
                                </NativeSelect>
                                <input
                                  type="text"
                                  placeholder="Description"
                                  value={item.description}
                                  onChange={(e) => updateItem(item.id, "description", e.target.value)}
                                  className="block w-full text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 py-1.5"
                                  required
                                />
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top sm:px-4">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={item.quantity != null ? Number(item.quantity) : ""}
                                onChange={(e) => {
                                  const val = e.target.value
                                  updateItem(item.id, "quantity", val === "" ? 0 : Number(val))
                                }}
                                onBlur={(e) => {
                                  const val = e.target.value
                                  if (val === "" || isNaN(Number(val)) || Number(val) < 0) {
                                    updateItem(item.id, "quantity", 1)
                                  }
                                }}
                                className="block w-full min-w-[3.5rem] min-h-[2.25rem] text-center text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
                                required
                              />
                            </td>
                            <td className="px-3 py-3 align-top sm:px-4">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.price != null ? item.price : ""}
                                onChange={(e) => updateItem(item.id, "price", Number(e.target.value))}
                                className="block w-full min-w-[5.5rem] min-h-[2.25rem] text-right text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
                                required
                              />
                            </td>
                            <td className="px-3 py-3 align-top sm:px-4">
                              <div className="flex min-w-0 items-stretch gap-2">
                                <NativeSelect
                                  value={item.discount_type}
                                  onChange={(e) => updateItem(item.id, "discount_type", e.target.value as any)}
                                  aria-label="Discount type"
                                  size="sm"
                                  wrapperClassName="w-[4.5rem] shrink-0 self-center"
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
                                  className="min-w-0 flex-1 min-h-[2.25rem] text-right text-sm border-gray-300 rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top text-right text-sm font-medium tabular-nums text-slate-900 whitespace-nowrap sm:px-6 sm:text-base sm:pt-5">
                              {displaySymbol} {item.total.toFixed(2)}
                            </td>
                            <td className="px-2 py-3 align-top pt-4">
                              <button
                                type="button"
                                onClick={() => removeItem(item.id)}
                                className="text-slate-400 hover:text-red-600 transition-colors p-1"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="bg-slate-50 border-t border-slate-200 px-6 py-3">
                  <button
                    type="button"
                    onClick={addItem}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1.5 hover:underline"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Line Item
                  </button>
                </div>
              </div>

              {/* 4. Financial Summary Panel */}
              <div className="p-8 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-2 gap-12">
                <div className="space-y-4">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-3"
                    rows={4}
                    placeholder="Additional notes or terms (visible on quote)..."
                  />
                </div>

                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold text-slate-800">Add Ghana taxes</span>
                        <p className="text-xs text-slate-500 mt-0.5">Apply VAT/NHIL/GetFund during tax calculation</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={applyGhanaTax}
                        onClick={() => setApplyGhanaTax(!applyGhanaTax)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${applyGhanaTax ? "bg-blue-600" : "bg-slate-300"}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${applyGhanaTax ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>

                  {/* Subtotal */}
                  <div className="flex justify-between items-center text-sm text-slate-600">
                    <span>Subtotal</span>
                    <span className="font-medium">{displaySymbol} {(applyGhanaTax ? total : baseSubtotal).toFixed(2)}</span>
                  </div>

                  {totalDiscount > 0 && (
                    <div className="flex justify-between items-center text-sm text-slate-600">
                      <span>Discounts</span>
                      <span className="font-medium text-rose-600">−{displaySymbol} {totalDiscount.toFixed(2)}</span>
                    </div>
                  )}

                  {/* Tax breakdown */}
                  {applyGhanaTax && taxBreakdown && (
                    <div className="py-3 border-y border-slate-100 space-y-2">
                      {taxBreakdown.nhil > 0 && (
                        <div className="flex justify-between items-center text-xs text-slate-500">
                          <span>NHIL (2.5%)</span>
                          <span>{displaySymbol} {taxBreakdown.nhil.toFixed(2)}</span>
                        </div>
                      )}
                      {taxBreakdown.getfund > 0 && (
                        <div className="flex justify-between items-center text-xs text-slate-500">
                          <span>GETFund (2.5%)</span>
                          <span>{displaySymbol} {taxBreakdown.getfund.toFixed(2)}</span>
                        </div>
                      )}
                      {taxBreakdown.vat > 0 && (
                        <div className="flex justify-between items-center text-xs text-slate-500">
                          <span>VAT</span>
                          <span>{displaySymbol} {taxBreakdown.vat.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="mt-2 bg-blue-50 rounded p-2 text-[10px] text-blue-700">
                        <div className="flex justify-between mb-1">
                          <span>Base Amount:</span>
                          <span>{displaySymbol} {baseSubtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Tax Component:</span>
                          <span>{displaySymbol} {tax.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Grand Total */}
                  <div className="flex justify-between items-center pt-2">
                    <span className="text-base font-bold text-slate-900">Total</span>
                    <span className="text-xl font-bold text-slate-900">{displaySymbol} {total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sticky Action Footer */}
            <div className="mt-8 flex items-center justify-end gap-3 sticky bottom-4 z-10">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-4 py-2 bg-white border border-slate-300 rounded shadow-sm text-slate-700 text-sm font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <div className="h-6 w-px bg-slate-300 mx-1"></div>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-slate-900 border border-transparent rounded shadow text-white text-sm font-medium hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? "Creating..." : "Create Quote"}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </div>
          </form>

          {/* Create Customer Modal */}
          {showCustomerModal && (
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <h3 className="text-lg font-bold mb-4">Create Customer</h3>
                {customerError && (
                  <div className="text-red-600 text-sm bg-red-50 p-2 rounded mb-4">{customerError}</div>
                )}
                <form onSubmit={handleCreateCustomer} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium">Name</label>
                    <input autoFocus type="text" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} className="w-full border rounded p-2" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Email</label>
                    <input type="email" value={newCustomerEmail} onChange={(e) => setNewCustomerEmail(e.target.value)} className="w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Phone</label>
                    <input type="tel" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} className="w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Address</label>
                    <textarea value={newCustomerAddress} onChange={(e) => setNewCustomerAddress(e.target.value)} rows={3} className="w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">TIN</label>
                    <input type="text" value={newCustomerTin} onChange={(e) => setNewCustomerTin(e.target.value)} className="w-full border rounded p-2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">WhatsApp</label>
                    <input type="tel" value={newCustomerWhatsapp} onChange={(e) => setNewCustomerWhatsapp(e.target.value)} placeholder="Optional if same as phone" className="w-full border rounded p-2" />
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => { setShowCustomerModal(false); setCustomerError("") }} className="flex-1 border rounded p-2 hover:bg-gray-50">Cancel</button>
                    <button type="submit" disabled={creatingCustomer} className="flex-1 bg-blue-600 text-white rounded p-2 hover:bg-blue-700 disabled:opacity-50">{creatingCustomer ? "Creating..." : "Create"}</button>
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
