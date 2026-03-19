"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"

const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>
import { getCurrentBusiness } from "@/lib/business"
import { calculateTaxes, getLegacyTaxAmounts } from "@/lib/taxEngine"
import SendInvoiceModal from "@/components/invoices/SendInvoiceModal"
import SendMethodDropdown, { SendMethod } from "@/components/invoices/SendMethodDropdown"
import { getCurrencySymbol } from "@/lib/currency"
import { resolveCurrencyDisplay } from "@/lib/currency/resolveCurrencyDisplay"
import { normalizeCountry } from "@/lib/payments/eligibility"

type Customer = {
  id: string
  name: string
}

type InvoiceItem = {
  id: string
  product_id: string | null
  description: string
  quantity: number
  price: number
  total: number
  discount_amount?: number
}

type Invoice = {
  id: string
  invoice_number: string
  issue_date: string
  due_date: string | null
  payment_terms: string | null
  notes: string | null
  footer_message: string | null
  apply_taxes: boolean
  status: string
  customer_id: string
  public_token: string | null
  source_type: string | null
  source_id: string | null
  orders?: {
    id: string
    order_number: string | null
  } | null
  customers: {
    id: string
    name: string
    email: string | null
    phone: string | null
    whatsapp_phone: string | null
  } | null
}

export default function InvoiceEditPage() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const invoiceId = (params?.id as string) || ""
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? FragmentWrapper : ProtectedLayout

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("")
  const [invoiceNumber, setInvoiceNumber] = useState<string>("")
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [dueDate, setDueDate] = useState<string>("")
  const [paymentTerms, setPaymentTerms] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [footerMessage, setFooterMessage] = useState<string>("")
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerEmail, setNewCustomerEmail] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [newCustomerAddress, setNewCustomerAddress] = useState("")
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [customerError, setCustomerError] = useState("")
  const [applyGhanaTax, setApplyGhanaTax] = useState(true)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [showSendModal, setShowSendModal] = useState(false)
  const [sendMethod, setSendMethod] = useState<SendMethod>("whatsapp")
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>("₵")

  useEffect(() => {
    if (invoiceId) {
      loadData()
    } else {
      setError("Invoice ID is missing")
      setLoading(false)
    }
  }, [invoiceId])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Please log in to edit invoices")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      
      // Load business country and currency for tax calculation
      const { data: businessDetails } = await supabase
        .from("businesses")
        .select("address_country, default_currency")
        .eq("id", business.id)
        .single()
      setBusinessCountry(businessDetails?.address_country || null)
      
      // CRITICAL: Get currency symbol from currency code
      const businessCurrency = businessDetails?.default_currency || null
      setCurrencyCode(businessCurrency)
      if (businessCurrency) {
        const symbol = getCurrencySymbol(businessCurrency)
        if (symbol) {
          setCurrencySymbol(symbol)
        } else {
          setError("Currency symbol not available. Please set your business currency in Business Profile settings.")
        }
      } else {
        setError("Business currency is required. Please set your business currency in Business Profile settings.")
      }

      // Load invoice data
      const response = await fetch(`/api/invoices/${invoiceId}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load invoice")
      }

      const { invoice: invoiceData, items: invoiceItems } = await response.json()

      if (!invoiceData) {
        throw new Error("Invoice not found")
      }

      // Enforce immutability: Only draft invoices can be edited
      if (invoiceData.status !== "draft") {
        setError(`This invoice cannot be edited because it has status "${invoiceData.status}". Invoices are immutable after being issued. Only draft invoices can be edited.`)
        setLoading(false)
        // Redirect to view page after a short delay
        setTimeout(() => {
          router.push(`/service/invoices/${invoiceId}/view`)
        }, 3000)
        return
      }

      setInvoice(invoiceData)
      setSelectedCustomerId(invoiceData.customer_id || "")
      setInvoiceNumber(invoiceData.invoice_number || "")
      setIssueDate(invoiceData.issue_date || new Date().toISOString().split("T")[0])
      setDueDate(invoiceData.due_date || "")
      setPaymentTerms(invoiceData.payment_terms || "")
      setNotes(invoiceData.notes || "")
      setFooterMessage(invoiceData.footer_message || "")
      setApplyGhanaTax(invoiceData.apply_taxes !== false)

      // Load products/services FIRST (needed for description fallback)
      // Note: products_services table uses unit_price, not price
      const { data: productsData, error: psError } = await supabase
        .from("products_services")
        .select("id, name, unit_price")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      if (psError) {
        console.error("Error loading products_services:", psError)
        // Fallback: try loading from products table if products_services fails
        const { data: fallbackProducts } = await supabase
          .from("products")
          .select("id, name, price")
          .eq("business_id", business.id)
          .order("name", { ascending: true })

        if (fallbackProducts) {
          setProducts(fallbackProducts.map((p: any) => ({
            id: p.id,
            name: p.name,
            price: Number(p.price) || 0,
          })))
        }
      } else {
        // Map products_services to expected format (unit_price -> price)
        const mappedProducts = (productsData || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          price: Number(p.unit_price) || 0,
        }))

        console.log(`Loaded ${mappedProducts.length} products/services for invoice edit`)
        setProducts(mappedProducts)

        // Phase 2 READ-SHADOW: parallel read from canonical items — no UI change, log mismatches only
        const { data: canonicalItemsRows } = await supabase
          .from("items")
          .select("id, business_id, name, type, source_table, source_id")
          .eq("business_id", business.id)
          .eq("source_table", "products_services")
        const canonicalBySourceId = new Map(
          (canonicalItemsRows ?? []).map((r: any) => [r.source_id, r])
        )
        const legacyIds = new Set(mappedProducts.map((p: any) => p.id))
        if ((canonicalItemsRows?.length ?? 0) !== mappedProducts.length) {
          console.warn("[items shadow] Count mismatch:", {
            legacy: mappedProducts.length,
            canonical: canonicalItemsRows?.length ?? 0,
            business_id: business.id,
          })
        }
        for (const p of mappedProducts) {
          const c = canonicalBySourceId.get(p.id)
          if (!c) {
            console.warn("[items shadow] Missing canonical row for products_services id:", p.id, p.name)
          } else if (c.name !== p.name) {
            console.warn("[items shadow] Name mismatch for source_id:", p.id, { legacy: p.name, canonical: c.name })
          }
        }
        for (const r of canonicalItemsRows ?? []) {
          if (!legacyIds.has(r.source_id)) {
            console.warn("[items shadow] Extra canonical row (no legacy):", r.source_id, r.name)
          }
        }
      }

      // Load customers
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])

      // Load invoice items AFTER products are loaded (for description fallback)
      if (invoiceItems && invoiceItems.length > 0) {
        console.log("📥 Loading invoice items for edit:", JSON.stringify(invoiceItems, null, 2))

        const mappedItems = invoiceItems.map((item: any) => {
          // If description is missing but product_service_id exists, try to get product name
          let description = item.description || ""
          if (!description && item.product_service_id && productsData) {
            const product = productsData.find((p: any) => p.id === item.product_service_id)
            if (product) {
              description = product.name
            }
          }

          // Handle qty and unit_price - they might be 0, null, undefined, or a string
          const qtyValue = item.qty
          const priceValue = item.unit_price

          // Convert to number, but preserve 0 values
          let quantity = 1 // default
          if (qtyValue !== null && qtyValue !== undefined && qtyValue !== "") {
            const numQty = Number(qtyValue)
            if (!isNaN(numQty) && numQty >= 0) {
              quantity = numQty
            }
          }

          let price = 0 // default
          if (priceValue !== null && priceValue !== undefined && priceValue !== "") {
            const numPrice = Number(priceValue)
            if (!isNaN(numPrice) && numPrice >= 0) {
              price = numPrice
            }
          }

          const mapped = {
            id: item.id,
            product_id: item.product_service_id,
            description: description,
            quantity: quantity,
            price: price,
            total: Number(item.line_subtotal ?? 0),
            discount_amount: Number(item.discount_amount ?? 0),
          }

          console.log(`📋 Mapped item: qty=${item.qty}, unit_price=${item.unit_price} → quantity=${mapped.quantity}, price=${mapped.price}`)
          return mapped
        })

        console.log("✅ Final mapped items for state:", JSON.stringify(mappedItems, null, 2))
        setItems(mappedItems)
      }

      setLoading(false)
    } catch (err: any) {
      console.error("Error loading invoice:", err)
      setError(err.message || "Failed to load invoice")
      setLoading(false)
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
        discount_amount: 0,
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof InvoiceItem, value: any) => {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          // Handle quantity, price, and discount_amount as numbers, ensuring proper conversion
          const updated = { ...item }
          if (field === "quantity" || field === "price" || field === "discount_amount") {
            const numValue = value === "" || value === null || value === undefined ? 0 : Number(value)
            updated[field] = isNaN(numValue) ? 0 : numValue
            const qty = updated.quantity
            const price = updated.price
            const discount = Number(updated.discount_amount) || 0
            updated.total = qty * price - discount
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
      const currentItem = items.find(i => i.id === itemId)
      if (!currentItem) return

      const qty = currentItem.quantity || 1
      const discount = currentItem.discount_amount || 0
      const price = Number(product.price) || 0
      const total = (qty * price) - discount

      // Update all fields in a single state update to prevent batching issues
      setItems(
        items.map((item) => {
          if (item.id === itemId) {
            return {
              ...item,
              product_id: productId,
              description: product.name, // Auto-fill description with product name
              price: price,
              total: total,
            }
          }
          return item
        })
      )
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

      const { data: newCustomer, error: insertError } = await supabase.from("customers").insert({
        business_id: businessId,
        name: newCustomerName.trim(),
        email: newCustomerEmail.trim() || null,
        phone: newCustomerPhone.trim() || null,
        address: newCustomerAddress.trim() || null,
      }).select().single()

      if (insertError) {
        setCustomerError(insertError.message || "Failed to create customer")
        setCreatingCustomer(false)
        return
      }

      // Reload customers list
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])

      // Select the newly created customer
      if (newCustomer) {
        setSelectedCustomerId(newCustomer.id)
      }

      // Reset form and close modal
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

  // Calculate subtotal from line items (sum of all line totals)
  // When taxes are applied, prices are always treated as tax-inclusive (like expenses)
  let subtotal = items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0
    const price = Number(item.price) || 0
    const discount = Number(item.discount_amount) || 0
    const lineTotal = qty * price - discount
    return sum + lineTotal
  }, 0)

  // Calculate taxes using shared tax engine
  // For drafts, use issue_date; for sent invoices, sent_at is used (handled by API)
  const effectiveDate = issueDate || new Date().toISOString().split('T')[0]
  
  const lineItems = items.map((item) => ({
    quantity: Number(item.quantity) || 0,
    unit_price: Number(item.price) || 0,
    discount_amount: Number(item.discount_amount) || 0,
  }))

  let tax = 0
  let total = subtotal
  let baseSubtotal = subtotal
  let legacyTaxAmounts: ReturnType<typeof getLegacyTaxAmounts> | null = null

  if (applyGhanaTax && items.length > 0 && subtotal > 0) {
    // Always treat entered prices as tax-inclusive
    const taxCalculationResult = calculateTaxes(
      lineItems,
      businessCountry,
      effectiveDate,
      true // tax-inclusive pricing
    )
    
    baseSubtotal = taxCalculationResult.subtotal_excl_tax || 0
    total = taxCalculationResult.total_incl_tax || subtotal
    tax = taxCalculationResult.tax_total || 0
    legacyTaxAmounts = getLegacyTaxAmounts(taxCalculationResult)
  }

  // Ensure all numeric values are valid (not NaN or undefined)
  total = isNaN(total) || total < 0 ? 0 : total
  baseSubtotal = isNaN(baseSubtotal) || baseSubtotal < 0 ? 0 : baseSubtotal
  subtotal = isNaN(subtotal) || subtotal < 0 ? 0 : subtotal

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!businessId) {
      setError("Business not found. Please refresh the page or contact support.")
      return
    }

    if (!selectedCustomerId) {
      setError("Please select a customer to update the invoice")
      return
    }

    if (items.length === 0) {
      setError("Please add at least one item to the invoice")
      return
    }

    // Validate items
    for (const item of items) {
      if (!item.description || !item.description.trim()) {
        setError("All items must have a description")
        return
      }
      if (!item.quantity || Number(item.quantity) <= 0) {
        setError("All items must have a quantity greater than 0")
        return
      }
      if (!item.price || Number(item.price) < 0) {
        setError("All items must have a valid price")
        return
      }
    }

    // Invoice number validation removed - system-controlled

    if (invoice?.status !== "draft") {
      setError("Only draft invoices can be edited. This invoice has already been sent or paid.")
      return
    }

    try {
      setSaving(true)

      const putPayload = {
        customer_id: selectedCustomerId,
        issue_date: issueDate,
        due_date: dueDate || null,
        payment_terms: paymentTerms || null,
        notes: notes || null,
        footer_message: footerMessage || null,
        apply_taxes: applyGhanaTax,
        items: items.map(item => {
          const qty = Number(item.quantity) || 0
          const unitPrice = Number(item.price) || 0
          const discount = Number(item.discount_amount) || 0
          const lineSubtotal = qty * unitPrice - discount
          return {
            id: item.id.startsWith("temp_") ? undefined : item.id,
            product_service_id: item.product_id || null,
            description: item.description || "",
            qty: qty,
            unit_price: unitPrice,
            discount_amount: discount,
            line_subtotal: lineSubtotal,
          }
        }),
      }
      console.log("[invoice update] PUT request payload:", putPayload)

      // Use API route for invoice update
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(putPayload),
      })

      if (!response.ok) {
        let errorData: any
        try {
          errorData = await response.json()
        } catch {
          errorData = { error: "Invalid response body" }
        }
        const errorMessage =
          errorData?.details?.message ?? errorData?.error ?? "Failed to update invoice"
        console.error("Invoice update error:", { status: response.status, errorMessage, errorData })
        setError(errorMessage)
        setSaving(false)
        return
      }

      const data = await response.json()

      // Redirect to the invoice view page
      router.push(`/service/invoices/${invoiceId}/view`)
    } catch (err: any) {
      const errorMessage = err?.message ?? "Failed to update invoice"
      const errorData = err != null && typeof err === "object" ? { message: err.message, ...err } : err
      console.error("Invoice update error:", { status: undefined, errorMessage, errorData })
      setError(errorMessage)
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Wrapper>
        <div className="p-6 max-w-5xl mx-auto">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p className="text-gray-600">Loading invoice...</p>
            </div>
          </div>
        </div>
      </Wrapper>
    )
  }

  if (error && !invoice) {
    return (
      <Wrapper>
        <div className="p-6 max-w-5xl mx-auto">
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
          <button
            onClick={() => router.push("/service/invoices")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Invoices
          </button>
        </div>
      </Wrapper>
    )
  }

  const currency = resolveCurrencyDisplay({ currency_symbol: currencySymbol, currency_code: currencyCode ?? undefined })

  return (
    <Wrapper>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="text-gray-600 hover:text-gray-900 mb-4 flex items-center gap-2 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Edit Invoice</h1>
              <p className="text-gray-600 mt-1">
                {invoice?.status === "draft" 
                  ? "Edit draft invoice" 
                  : `Edit invoice ${invoiceNumber || "(no number assigned)"}`}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 text-red-700 px-4 py-3 rounded mb-6 shadow-sm">
            <div className="flex items-center">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full"></div>
              <h2 className="text-xl font-semibold text-gray-900">Invoice Details</h2>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    Customer *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCustomerModal(true)}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add New Customer
                  </button>
                </div>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => setSelectedCustomerId(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                >
                  <option value="">Select a customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Invoice Number
                </label>
                {invoice?.source_type === "order" ? (
                  <>
                    <input
                      type="text"
                      value={invoiceNumber}
                      readOnly
                      disabled
                      className="w-full border border-gray-200 bg-gray-50 rounded-lg px-4 py-3 text-gray-700 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Invoice number is system-generated and cannot be changed for invoices created from orders
                      {invoice.orders?.order_number && (
                        <span className="block mt-1">
                          Created from Order: {invoice.orders.order_number}
                        </span>
                      )}
                    </p>
                  </>
                ) : invoice?.status === "draft" ? (
                  <>
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-4 py-3 text-gray-500 italic">
                      Not issued yet
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Invoice number will be automatically assigned when the invoice is sent.
                    </p>
                  </>
                ) : invoiceNumber ? (
                  <>
                    <input
                      type="text"
                      value={invoiceNumber}
                      readOnly
                      disabled
                      className="w-full border border-gray-200 bg-gray-50 rounded-lg px-4 py-3 text-gray-700 cursor-not-allowed"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Invoice numbers cannot be changed after issuance.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-4 py-3 text-gray-500 italic">
                      Not assigned
                    </div>
                  </>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Issue Date *
                </label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Payment Terms
              </label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                placeholder="e.g., Net 30 days"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Additional notes or terms..."
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Footer Message
              </label>
              <textarea
                value={footerMessage}
                onChange={(e) => setFooterMessage(e.target.value)}
                rows={2}
                placeholder="Message to display at the bottom of the invoice..."
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
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
                aria-checked={applyGhanaTax}
                onClick={() => setApplyGhanaTax(!applyGhanaTax)}
                className={`
                  relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                  transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                  ${applyGhanaTax ? 'bg-blue-600' : 'bg-gray-200'}
                `}
              >
                <span
                  className={`
                    pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0
                    transition duration-200 ease-in-out
                    ${applyGhanaTax ? 'translate-x-5' : 'translate-x-0'}
                  `}
                />
              </button>
            </div>
          </div>

          {/* Items Section */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full"></div>
                <h2 className="text-xl font-semibold text-gray-900">Items</h2>
              </div>
              <button
                type="button"
                onClick={addItem}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Item
              </button>
            </div>

            {items.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No items added yet. Click "Add Item" to get started.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {items.map((item, index) => (
                  <div key={item.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-12 gap-3">
                      <div className="col-span-12 md:col-span-5">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Product/Service
                        </label>
                        <select
                          value={item.product_id || ""}
                          onChange={(e) => {
                            if (e.target.value) {
                              selectProduct(item.id, e.target.value)
                            } else {
                              // Clear product selection - update in single state update
                              setItems(
                                items.map((it) => {
                                  if (it.id === item.id) {
                                    return {
                                      ...it,
                                      product_id: null,
                                      description: "",
                                    }
                                  }
                                  return it
                                })
                              )
                            }
                          }}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Select product/service</option>
                          {products.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} - {currency}{Number(product.price).toFixed(2)}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={item.description || ""}
                          onChange={(e) => updateItem(item.id, "description", e.target.value)}
                          required
                          placeholder="Service/product name or description"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Qty *
                        </label>
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
                            // Ensure valid number on blur
                            const val = e.target.value
                            if (val === "" || isNaN(Number(val)) || Number(val) < 0) {
                              updateItem(item.id, "quantity", 1)
                            }
                          }}
                          required
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Price *
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.price != null ? item.price : ""}
                          onChange={(e) => {
                            const val = e.target.value
                            updateItem(item.id, "price", val === "" ? 0 : val)
                          }}
                          onBlur={(e) => {
                            // Ensure valid number on blur
                            const val = e.target.value
                            if (val === "" || isNaN(Number(val)) || Number(val) < 0) {
                              updateItem(item.id, "price", 0)
                            }
                          }}
                          required
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Total
                        </label>
                        <input
                          type="text"
                          value={`${currency}${item.total.toFixed(2)}`}
                          readOnly
                          className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-red-600 hover:text-red-800 text-sm font-medium flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary Section */}
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-1 h-6 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full"></div>
              <h2 className="text-xl font-semibold text-gray-900">Summary</h2>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-700 font-medium">
                  {applyGhanaTax ? "Subtotal (tax inclusive):" : "Subtotal:"}
                </span>
                <span className="font-semibold text-gray-900 text-lg">
                  {currency}{applyGhanaTax ? total.toFixed(2) : baseSubtotal.toFixed(2)}
                </span>
              </div>
              {applyGhanaTax && (
                <div className="text-xs text-gray-500 italic -mt-1">
                  Base amount: {currency}{baseSubtotal.toFixed(2)}
                </div>
              )}
              {applyGhanaTax && legacyTaxAmounts && subtotal > 0 && (() => {
                const countryCode = businessCountry ? normalizeCountry(businessCountry) : null
                const isGhana = countryCode === "GH"
                
                // CRITICAL: Only show Ghana tax labels for GH businesses
                if (isGhana) {
                  if (!legacyTaxAmounts) {
                    return null
                  }
                  return (
                    <>
                      <div className="border-t border-gray-200 pt-3 space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          {legacyTaxAmounts.nhil > 0 && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-600">NHIL:</span>
                              <span className="text-gray-700">{currency}{legacyTaxAmounts.nhil.toFixed(2)}</span>
                            </div>
                          )}
                          {legacyTaxAmounts.getfund > 0 && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-600">GETFund:</span>
                              <span className="text-gray-700">{currency}{legacyTaxAmounts.getfund.toFixed(2)}</span>
                            </div>
                          )}
                          {legacyTaxAmounts.vat > 0 && (
                            <div className="flex justify-between items-center text-sm">
                              <span className="text-gray-600">VAT:</span>
                              <span className="text-gray-700">{currency}{legacyTaxAmounts.vat.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                        <span className="text-gray-700 font-medium">Total Tax:</span>
                        <span className="font-semibold text-gray-900">{currency}{legacyTaxAmounts.totalTax.toFixed(2)}</span>
                      </div>
                    </>
                  )
                } else {
                  // Non-GH: Show generic VAT only
                  if (!legacyTaxAmounts) {
                    return null
                  }
                  return (
                    <div className="border-t border-gray-200 pt-3 space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">VAT:</span>
                        <span className="text-gray-700">{currency}{legacyTaxAmounts.vat.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center pt-2 border-t border-gray-200">
                        <span className="text-gray-700 font-medium">Total Tax:</span>
                        <span className="font-semibold text-gray-900">{currency}{legacyTaxAmounts.totalTax.toFixed(2)}</span>
                      </div>
                    </div>
                  )
                }
              })()}
              <div className="flex justify-between items-center pt-3 border-t-2 border-gray-300">
                <span className="text-gray-900 font-bold text-lg">Total:</span>
                <span className="font-bold text-blue-600 text-xl">{currency}{total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-4 pt-4">
            {/* Save Button */}
            <div className="flex items-center justify-end gap-4">
              <button
                type="button"
                onClick={() => router.back()}
                className="px-6 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              {invoice?.status === "draft" && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Saving...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Save Changes
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Send Invoice Section - Show for non-paid invoices */}
            {invoice && invoice.status !== "paid" && (
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200">
                <SendMethodDropdown
                  value={sendMethod}
                  onChange={setSendMethod}
                />
                <button
                  type="button"
                  onClick={() => setShowSendModal(true)}
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-700 text-white rounded-lg font-medium hover:from-green-700 hover:to-green-800 shadow-lg transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send Invoice
                </button>
              </div>
            )}
          </div>
        </form>

        {/* Create Customer Modal */}
        {showCustomerModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Create New Customer</h3>
              <form onSubmit={handleCreateCustomer} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Name *
                  </label>
                  <input
                    type="text"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Address
                  </label>
                  <textarea
                    value={newCustomerAddress}
                    onChange={(e) => setNewCustomerAddress(e.target.value)}
                    rows={2}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                {customerError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">
                    {customerError}
                  </div>
                )}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerModal(false)
                      setCustomerError("")
                      setNewCustomerName("")
                      setNewCustomerEmail("")
                      setNewCustomerPhone("")
                      setNewCustomerAddress("")
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingCustomer}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creatingCustomer ? "Creating..." : "Create Customer"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Send Invoice Modal */}
        {showSendModal && invoice && (
          <SendInvoiceModal
            invoice={{
              id: invoice.id,
              public_token: invoice.public_token || "",
              customers: invoice.customers ? {
                ...invoice.customers,
                email: invoice.customers.email || undefined,
                phone: invoice.customers.phone || undefined,
                whatsapp_phone: invoice.customers.whatsapp_phone || undefined,
              } : null,
            }}
            invoiceId={invoice.id}
            defaultMethod={sendMethod}
            onClose={() => setShowSendModal(false)}
            onSuccess={() => {
              setShowSendModal(false)
              // Reload invoice to get updated status
              loadData()
            }}
          />
        )}
      </div>
    </Wrapper>
  )
}
