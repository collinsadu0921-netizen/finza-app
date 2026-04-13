"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, useParams, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness, getSelectedBusinessId } from "@/lib/business"
import { getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import { formatMoney } from "@/lib/money"
import type { TaxResult } from "@/lib/taxEngine/types"
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
  /** Persisted/legacy amount stored on proforma_items. Derived from discount_type/value in the UI. */
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

const getLineTotal = (item: Pick<LineItem, "qty" | "unit_price" | "discount_type" | "discount_value">): number => {
  const gross = (Number(item.qty) || 0) * (Number(item.unit_price) || 0)
  return round2(Math.max(0, gross - getDiscountAmount(item)))
}

export default function ProformaEditPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const proformaId = (params?.id as string) || ""
  const businessIdFromUrl =
    searchParams.get("business_id") ?? searchParams.get("businessId") ?? null

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("")
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [validityDate, setValidityDate] = useState<string>("")
  const [paymentTerms, setPaymentTerms] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [footerMessage, setFooterMessage] = useState<string>("")
  const [items, setItems] = useState<LineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(null)
  const [applyTaxes, setApplyTaxes] = useState(true)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)

  // Create customer modal state
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerEmail, setNewCustomerEmail] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerAddress, setNewCustomerAddress] = useState("")
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState("")

  useEffect(() => {
    if (proformaId) loadData()
  }, [proformaId, businessIdFromUrl])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setError("Please log in to edit this proforma invoice")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      const resolvedForFetch =
        businessIdFromUrl?.trim() ||
        getSelectedBusinessId()?.trim() ||
        business?.id ||
        null
      if (!resolvedForFetch) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(resolvedForFetch)

      // Get currency + industry for resolved workspace
      const { data: biz } = await supabase
        .from("businesses")
        .select("default_currency, currency_symbol, industry")
        .eq("id", resolvedForFetch)
        .single()
      const industryResolved = (biz as { industry?: string | null } | null)?.industry ?? null
      setBusinessIndustry(industryResolved)
      setCurrencyCode((biz as { default_currency?: string | null } | null)?.default_currency ?? null)

      // Load proforma data
      const response = await fetch(
        `/api/proforma/${proformaId}?business_id=${encodeURIComponent(resolvedForFetch)}`
      )
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load proforma invoice")
      }

      const responseData = await response.json()
      const proformaData = responseData.proforma
      const proformaItems = responseData.items || []

      if (!proformaData) throw new Error("Proforma invoice not found")

      setBusinessId(proformaData.business_id)

      // Only allow editing draft proformas
      if (proformaData.status !== "draft") {
        router.replace(`/service/proforma/${proformaId}/view`)
        return
      }

      setSelectedCustomerId(proformaData.customer_id || "")
      setIssueDate(proformaData.issue_date || new Date().toISOString().split("T")[0])
      setValidityDate(proformaData.validity_date || "")
      setPaymentTerms(proformaData.payment_terms || "")
      setNotes(proformaData.notes || "")
      setFooterMessage(proformaData.footer_message || "")
      setApplyTaxes(proformaData.apply_taxes !== false)

      if (proformaItems.length > 0) {
        setItems(
          proformaItems.map((item: any) => ({
            id: item.id || Date.now().toString() + Math.random(),
            product_service_id: item.product_service_id || null,
            description: item.description || "",
            qty: Number(item.qty) || 1,
            unit_price: Number(item.unit_price) || 0,
            discount_type: "amount",
            discount_value: Number(item.discount_amount) || 0,
            discount_amount: Number(item.discount_amount) || 0,
          }))
        )
      } else {
        setItems([])
      }

      // Load customers
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name, email, phone, address")
        .eq("business_id", resolvedForFetch)
        .is("deleted_at", null)
        .order("name", { ascending: true })
      setCustomers(customersData || [])

      // Load products/services
      if (industryResolved === "service") {
        const { data: catalogData } = await supabase
          .from("service_catalog")
          .select("*")
          .eq("business_id", resolvedForFetch)
          .eq("is_active", true)
          .order("name", { ascending: true })
        setProducts(
          (catalogData || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.default_price) || 0,
          }))
        )
      } else {
        const { data: productsData } = await supabase
          .from("products_services")
          .select("id, name, unit_price")
          .eq("business_id", resolvedForFetch)
          .is("deleted_at", null)
          .order("name", { ascending: true })
        setProducts(
          (productsData || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.unit_price) || 0,
          }))
        )
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load proforma invoice")
      setLoading(false)
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
        if (item.id !== id) return item
        const updated = { ...item }
        if (field === "_rawDiscount") {
          updated._rawDiscount = value
          return updated
        }
        if (field === "qty" || field === "unit_price" || field === "discount_value") {
          if (field === "discount_value") updated._rawDiscount = String(value)
          const num = value === "" || value === null ? 0 : Number(value)
          ;(updated as any)[field] = isNaN(num) ? 0 : num
          updated.discount_amount = getDiscountAmount(updated)
        } else if (field === "discount_type") {
          ;(updated as any)[field] = value
          updated.discount_amount = getDiscountAmount(updated)
        } else {
          ;(updated as any)[field] = value
        }
        return updated
      })
    )
  }

  const selectProduct = (itemId: string, productId: string) => {
    const product = products.find((p) => p.id === productId)
    if (!product) return
    setItems(
      items.map((item) => {
        if (item.id !== itemId) return item
        return {
          ...item,
          product_service_id: productId,
          description: product.name || "",
          unit_price: Number(product.price) || 0,
        }
      })
    )
  }

  // Tax calculation
  const lineItemsTotal = items.reduce((sum, item) => sum + getLineTotal(item), 0)
  const totalDiscount = items.reduce((sum, item) => sum + getDiscountAmount(item), 0)

  let taxResult: TaxResult | null = null
  let displaySubtotal = lineItemsTotal
  let displayTax = 0
  let displayTotal = lineItemsTotal

  if (applyTaxes && items.length > 0 && lineItemsTotal > 0) {
    try {
      taxResult = getCanonicalTaxResultFromLineItems(
        items.map((item) => ({
          quantity: Number(item.qty) || 0,
          unit_price: Number(item.unit_price) || 0,
          discount_amount: getDiscountAmount(item),
        })),
        {
          jurisdiction: "GH",
          effectiveDate: issueDate || new Date().toISOString().split("T")[0],
          taxInclusive: true,
        }
      )
      displaySubtotal = taxResult.base_amount
      displayTax = taxResult.total_tax
      displayTotal = taxResult.total_amount
    } catch {
      // fallback to no tax
    }
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

    if (items.length === 0) {
      setError("Please add at least one line item")
      return
    }
    if (!issueDate) {
      setError("Issue date is required")
      return
    }
    const invalid = items.filter((i) => !i.description.trim() || i.qty <= 0 || i.unit_price <= 0)
    if (invalid.length > 0) {
      setError("Please fill in all item fields (description, quantity, and price)")
      return
    }

    setSaving(true)
    try {
      const response = await fetch(`/api/proforma/${proformaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          customer_id: selectedCustomerId || null,
          issue_date: issueDate,
          validity_date: validityDate || null,
          payment_terms: paymentTerms || null,
          notes: notes || null,
          footer_message: footerMessage || null,
          apply_taxes: applyTaxes,
          items: items.map((item) => ({
            product_service_id: item.product_service_id,
            description: item.description,
            qty: item.qty,
            unit_price: item.unit_price,
            discount_amount: getDiscountAmount(item),
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.message || "Failed to update proforma invoice")
      }

      router.push(`/service/proforma/${proformaId}/view`)
    } catch (err: any) {
      setError(err.message || "Failed to update proforma invoice")
      setSaving(false)
    }
  }

  const customerMenuOptions = useMemo(
    () => [
      { value: "", label: "Select a customer..." },
      ...customers.map((c) => ({ value: c.id, label: c.name })),
    ],
    [customers]
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  if (error && items.length === 0 && !selectedCustomerId && !issueDate) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4 text-sm">
          {error}
        </div>
        <button
          onClick={() => router.push("/service/proforma")}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
        >
          Back to Proformas
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 pb-20 font-sans">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header / Nav */}
        <div className="flex items-center justify-between mb-8">
          <button
            type="button"
            onClick={() => router.push(`/service/proforma/${proformaId}/view`)}
            className="group flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <svg className="w-4 h-4 transition-transform group-hover:-translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Proforma
          </button>
          <span className="text-xs text-slate-400 font-mono">EDIT PROFORMA</span>
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
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mb-1">Edit Proforma Invoice</h1>
                <p className="text-sm text-slate-500">Update your proforma invoice details</p>
              </div>
            </div>

            {/* 2. Customer & Dates Section */}
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 border-b border-slate-100 dark:border-slate-700">
              {/* Customer Selection */}
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Bill To</label>
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

              {/* Dates & Settings */}
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Issue Date</label>
                    <input
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Validity Date</label>
                    <input
                      type="date"
                      value={validityDate}
                      onChange={(e) => setValidityDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Payment Terms</label>
                  <input
                    type="text"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    placeholder="e.g. Net 30, 50% upfront..."
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-2.5 dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                  />
                </div>
                {/* Tax toggle moved to summary for clarity */}
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
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="min-w-0 px-4 py-3 font-semibold sm:px-6">Item Description</th>
                      <th className="whitespace-nowrap px-3 py-3 text-center font-semibold sm:px-4">Qty</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4">Price</th>
                      <th className="whitespace-nowrap px-3 py-3 text-right font-semibold sm:px-4">Discount</th>
                      <th className="whitespace-nowrap px-4 py-3 text-right font-semibold sm:px-6">Total</th>
                      <th className="w-10 py-3" aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic bg-slate-50/30">
                          No line items added. Click "Add Line Item" below to start.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => {
                        const lineTotal = getLineTotal(item)
                        return (
                          <tr key={item.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-700/30 transition-colors">
                            <td className="min-w-0 px-4 py-3 align-top sm:px-6">
                              <div className="space-y-1.5">
                                <NativeSelect
                                  value={item.product_service_id || ""}
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      selectProduct(item.id, e.target.value)
                                    } else {
                                      updateItem(item.id, "product_service_id", null)
                                      updateItem(item.id, "description", "")
                                      updateItem(item.id, "unit_price", 0)
                                    }
                                  }}
                                  size="sm"
                                  className="dark:bg-gray-700"
                                >
                                  <option value="">{businessIndustry === "service" ? "Select Service" : "Select product/service"}</option>
                                  {products.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} — {formatMoney(p.price, currencyCode)}
                                    </option>
                                  ))}
                                </NativeSelect>
                                <input
                                  type="text"
                                  placeholder="Description"
                                  value={item.description}
                                  onChange={(e) => updateItem(item.id, "description", e.target.value)}
                                  className="block w-full text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 py-1.5"
                                  required
                                />
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top sm:px-4">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={item.qty != null ? Number(item.qty) : ""}
                                onChange={(e) => updateItem(item.id, "qty", e.target.value === "" ? 0 : Number(e.target.value))}
                                onBlur={(e) => {
                                  if (e.target.value === "" || isNaN(Number(e.target.value)) || Number(e.target.value) < 0) {
                                    updateItem(item.id, "qty", 1)
                                  }
                                }}
                                className="block w-full min-w-[3.5rem] min-h-[2.25rem] text-center text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
                                required
                              />
                            </td>
                            <td className="px-3 py-3 align-top sm:px-4">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unit_price != null ? item.unit_price : ""}
                                onChange={(e) => updateItem(item.id, "unit_price", Number(e.target.value))}
                                className="block w-full min-w-[5.5rem] min-h-[2.25rem] text-right text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
                                required
                              />
                            </td>
                            <td className="px-3 py-3 align-top sm:px-4">
                              <div className="flex min-w-0 items-stretch gap-2">
                                <NativeSelect
                                  value={item.discount_type}
                                  onChange={(e) => updateItem(item.id, "discount_type", e.target.value as any)}
                                  size="sm"
                                  wrapperClassName="w-[4.5rem] shrink-0 self-center"
                                  className="text-xs dark:bg-gray-700"
                                  aria-label="Discount type"
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
                                  className="min-w-0 flex-1 min-h-[2.25rem] text-right text-sm border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md shadow-sm focus:border-blue-500 focus:ring-blue-500 px-2 py-2 tabular-nums"
                                />
                              </div>
                            </td>
                            <td className="px-4 py-3 align-top text-right text-sm font-medium tabular-nums text-slate-900 dark:text-white whitespace-nowrap sm:px-6 sm:text-base sm:pt-5">
                              {formatMoney(lineTotal, currencyCode)}
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
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/30 border-t border-slate-200 dark:border-slate-700 px-6 py-3">
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

            {/* 4. Notes & Financial Summary */}
            <div className="p-8 border-t border-slate-200 dark:border-slate-700 grid grid-cols-1 lg:grid-cols-2 gap-12">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Notes</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-3"
                    rows={3}
                    placeholder="Additional notes or terms (visible on proforma)..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Footer Message</label>
                  <textarea
                    value={footerMessage}
                    onChange={(e) => setFooterMessage(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-900 dark:text-white text-sm rounded-md focus:ring-blue-500 focus:border-blue-500 p-3"
                    rows={2}
                    placeholder="Footer text shown at the bottom of the proforma..."
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Add Ghana taxes</span>
                      <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">Apply VAT/NHIL/GETFund during tax calculation</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={applyTaxes}
                      onClick={() => setApplyTaxes(!applyTaxes)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${applyTaxes ? "bg-blue-600" : "bg-slate-300"}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${applyTaxes ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center text-sm text-slate-600 dark:text-slate-400">
                  <span>Subtotal</span>
                  <span className="font-medium">{formatMoney(displaySubtotal, currencyCode)}</span>
                </div>

                {totalDiscount > 0 && (
                  <div className="flex justify-between items-center text-sm text-slate-600 dark:text-slate-400">
                    <span>Discounts</span>
                    <span className="font-medium text-rose-600">{formatMoney(-Math.abs(totalDiscount), currencyCode)}</span>
                  </div>
                )}

                {applyTaxes && taxResult && (
                  <div className="py-3 border-y border-slate-100 dark:border-slate-700 space-y-2">
                    {taxResult.lines
                      .filter((line) => Number(line.amount) > 0 && line.code.toUpperCase() !== "COVID")
                      .map((line) => (
                        <div key={line.code} className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400">
                          <span>{line.code}</span>
                          <span>{formatMoney(Number(line.amount), currencyCode)}</span>
                        </div>
                      ))}
                    <div className="flex justify-between items-center text-xs text-slate-500 dark:text-slate-400 pt-1">
                      <span>Total Tax</span>
                      <span className="font-medium">{formatMoney(displayTax, currencyCode)}</span>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center pt-2">
                  <span className="text-base font-bold text-slate-900 dark:text-white">Total</span>
                  <span className="text-xl font-bold text-slate-900 dark:text-white">{formatMoney(displayTotal, currencyCode)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Sticky Action Footer */}
          <div className="mt-8 flex items-center justify-end gap-3 sticky bottom-4 z-10">
            <button
              type="button"
              onClick={() => router.push(`/service/proforma/${proformaId}/view`)}
              className="px-4 py-2 bg-white dark:bg-gray-800 border border-slate-300 dark:border-slate-600 rounded shadow-sm text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-slate-900 dark:bg-blue-600 border border-transparent rounded shadow text-white text-sm font-medium hover:bg-black dark:hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving ? "Saving..." : "Save Changes"}
              {!saving && (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              )}
            </button>
          </div>
        </form>

        {/* Create Customer Modal */}
        {showCustomerModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-bold mb-4 text-slate-900 dark:text-white">Create Customer</h3>
              {customerError && (
                <div className="text-red-600 text-sm bg-red-50 p-2 rounded mb-4">{customerError}</div>
              )}
              <form onSubmit={handleCreateCustomer} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                  <input
                    autoFocus
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    className="w-full border dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 mt-1"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Email</label>
                  <input
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    className="w-full border dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 mt-1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Phone</label>
                  <input
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="w-full border dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 mt-1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Address</label>
                  <textarea
                    value={newCustomerAddress}
                    onChange={(e) => setNewCustomerAddress(e.target.value)}
                    rows={3}
                    className="w-full border dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded p-2 mt-1"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowCustomerModal(false); setCustomerError("") }}
                    className="flex-1 border dark:border-slate-600 rounded p-2 hover:bg-gray-50 dark:hover:bg-slate-700 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingCustomer}
                    className="flex-1 bg-blue-600 text-white rounded p-2 hover:bg-blue-700 disabled:opacity-50 text-sm"
                  >
                    {creatingCustomer ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
