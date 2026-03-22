"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"

const FragmentWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>
import { getCurrentBusiness } from "@/lib/business"
import { getCanonicalTaxResultFromLineItems } from "@/lib/taxEngine/helpers"
import type { TaxResult } from "@/lib/taxEngine/types"

type Customer = {
  id: string
  name: string
}

type EstimateItem = {
  id: string
  product_id: string | null
  description: string
  quantity: number
  price: number
  total: number
}

type Estimate = {
  id: string
  estimate_number: string
  issue_date: string
  expiry_date: string | null
  notes: string | null
  status: string
  converted_to: string | null
  customer_id: string | null
}

export default function EstimateEditPage() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const estimateId = (params?.id as string) || ""
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? FragmentWrapper : ProtectedLayout

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("")
  const [estimateNumber, setEstimateNumber] = useState<string>("")
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split("T")[0])
  const [expiryDate, setExpiryDate] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [items, setItems] = useState<EstimateItem[]>([])
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
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  useEffect(() => {
    if (estimateId) {
      loadData()
    }
  }, [estimateId])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Please log in to edit quotes")
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

      // Load estimate data
      const response = await fetch(`/api/estimates/${estimateId}`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to load quote")
      }

      const responseData = await response.json()
      console.log("Estimate edit data received:", responseData)

      const estimateData = responseData.estimate
      const estimateItems = responseData.items || []

      if (!estimateData) {
        throw new Error("Quote not found")
      }

      // Check if estimate is editable (only draft estimates that haven't been converted can be edited)
      if (estimateData.converted_to) {
        setError(`This quote cannot be edited because it has been converted to ${estimateData.converted_to}. Converted quotes are read-only.`)
        setLoading(false)
        return
      }

      // Allow editing draft and sent estimates (sent creates revision)
      if (estimateData.status !== "draft" && estimateData.status !== "sent") {
        setError(`This quote cannot be edited because it is ${estimateData.status}. Only draft and sent quotes can be edited.`)
        setLoading(false)
        return
      }

      setEstimate(estimateData)
      setSelectedCustomerId(estimateData.customer_id || "")
      setEstimateNumber(estimateData.estimate_number || "")
      setIssueDate(estimateData.issue_date || new Date().toISOString().split("T")[0])
      setExpiryDate(estimateData.expiry_date || "")
      setNotes(estimateData.notes || "")
      setApplyGhanaTax(estimateData.total_tax_amount > 0)

      // Load estimate items - ensure we always set items even if empty
      console.log("Loading estimate items:", estimateItems)
      if (estimateItems && estimateItems.length > 0) {
        const mappedItems = estimateItems.map((item: any) => ({
          id: item.id || Date.now().toString() + Math.random(),
          product_id: item.product_id || null,
          description: item.description || "",
          quantity: Number(item.quantity) || 1,
          price: Number(item.price) || 0,
          total: Number(item.total) || (Number(item.quantity) || 1) * (Number(item.price) || 0),
        }))
        console.log("Mapped items:", mappedItems)
        setItems(mappedItems)
      } else {
        console.log("No items found, setting empty array")
        setItems([])
      }

      // Load customers
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])

      // Load products/services
      const { data: productsData, error: productsError } = await supabase
        .from("products_services")
        .select("id, name, unit_price")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      if (productsError) {
        console.error("Error loading products:", productsError)
        setProducts([])
      } else {
        // Map products_services to expected format (unit_price -> price)
        const mappedProducts = (productsData || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          price: Number(p.unit_price) || 0,
        }))
        setProducts(mappedProducts)
      }

      setLoading(false)
    } catch (err: any) {
      console.error("Error loading estimate:", err)
      setError(err.message || "Failed to load quote")
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
          // Handle quantity and price as numbers, ensuring proper conversion
          const updated = { ...item }
          if (field === "quantity" || field === "price") {
            const numValue = value === "" || value === null || value === undefined ? 0 : Number(value)
            updated[field] = isNaN(numValue) ? 0 : numValue
            updated.total = updated.quantity * updated.price
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
      updateItem(itemId, "product_id", productId)
      updateItem(itemId, "description", product.name)
      updateItem(itemId, "price", Number(product.price))
      updateItem(itemId, "total", Number(product.price))
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

      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", businessId)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setCustomers(customersData || [])
      if (newCustomer) {
        setSelectedCustomerId(newCustomer.id)
      }
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

  const lineItemsSubtotal = items.reduce((sum, item) => {
    const lineTotal = (Number(item.quantity) || 0) * (Number(item.price) || 0)
    return sum + lineTotal
  }, 0)

  let taxResult: TaxResult | null = null
  let subtotal = 0
  let tax = 0
  let total = 0

  if (items.length > 0) {
    if (applyGhanaTax) {
      const config = {
        jurisdiction: "GH",
        effectiveDate: issueDate || new Date().toISOString().split("T")[0],
        taxInclusive: true,
      }
      taxResult = getCanonicalTaxResultFromLineItems(
        items.map(item => ({
          quantity: Number(item.quantity) || 0,
          unit_price: Number(item.price) || 0,
          discount_amount: 0,
        })),
        config
      )
      subtotal = taxResult.base_amount
      tax = taxResult.total_tax
      total = taxResult.total_amount
    } else {
      subtotal = lineItemsSubtotal
      tax = 0
      total = lineItemsSubtotal
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!businessId) {
      setError("Business ID not found")
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

    setSaving(true)

    try {
      const response = await fetch(`/api/estimates/${estimateId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer_id: selectedCustomerId || null,
          estimate_number: estimateNumber,
          issue_date: issueDate,
          expiry_date: expiryDate || null,
          notes: notes || null,
          items: items.map(item => ({
            product_id: item.product_id,
            description: item.description,
            quantity: item.quantity,
            price: item.price,
          })),
          apply_taxes: applyGhanaTax,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to update quote")
      }

      router.push(`/service/estimates/${estimateId}/view`)
    } catch (err: any) {
      setError(err.message || "Failed to update quote")
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Wrapper>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </Wrapper>
    )
  }

  if (error && !estimate) {
    return (
      <Wrapper>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
          <button
            onClick={() => router.push("/service/estimates")}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Quotes
          </button>
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Edit Quote #{estimateNumber}</h1>
          {estimate?.status === "sent" && (
            <p className="text-amber-600 font-medium mt-2">
              ⚠️ Editing a sent quote will create a new draft revision. The original sent version will remain unchanged.
            </p>
          )}
          <p className="text-gray-600">Update your quote details</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Customer Selection */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Customer Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2"
                  >
                    <option value="">Select a customer</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowCustomerModal(true)}
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
                  >
                    + New
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Quote Details */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Quote Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Quote Number
                </label>
                <input
                  type="text"
                  value={estimateNumber}
                  onChange={(e) => setEstimateNumber(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Issue Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Expiry Date
                </label>
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Line Items</h2>
              <button
                type="button"
                onClick={addItem}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                + Add Item
              </button>
            </div>

            <div className="space-y-4">
              {items.map((item) => (
                <div key={item.id} className="grid grid-cols-12 gap-4 items-start">
                  <div className="col-span-12 md:col-span-4">
                    <select
                      value={item.product_id || ""}
                      onChange={(e) => {
                        if (e.target.value) {
                          selectProduct(item.id, e.target.value)
                        }
                      }}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    >
                      <option value="">Select product/service</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-12 md:col-span-4">
                    <input
                      type="text"
                      placeholder="Description"
                      value={item.description}
                      onChange={(e) => updateItem(item.id, "description", e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      required
                    />
                  </div>
                  <div className="col-span-4 md:col-span-1">
                    <input
                      type="number"
                      placeholder="Qty"
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
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      min="0"
                      step="1"
                      required
                    />
                  </div>
                  <div className="col-span-4 md:col-span-2">
                    <input
                      type="number"
                      placeholder="Price"
                      value={item.price != null ? item.price : ""}
                      onChange={(e) => updateItem(item.id, "price", Number(e.target.value))}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      min="0"
                      step="0.01"
                      required
                    />
                  </div>
                  <div className="col-span-3 md:col-span-1 flex items-center justify-between">
                    <span className="font-medium">GHS {item.total.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="text-red-600 hover:text-red-800 ml-2"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {items.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p>No items added yet. Click "+ Add Item" to get started.</p>
              </div>
            )}
          </div>

          {/* Tax Toggle */}
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center justify-between">
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

            {applyGhanaTax && taxResult && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal (before tax):</span>
                    <span className="font-medium">GHS {subtotal.toFixed(2)}</span>
                  </div>
                  {taxResult.lines
                    .filter(line => Number(line.amount) > 0 && line.code.toUpperCase() !== "COVID")
                    .map(line => (
                      <div key={line.code} className="flex justify-between text-gray-600">
                        <span>{line.code}:</span>
                        <span>GHS {Number(line.amount).toFixed(2)}</span>
                      </div>
                    ))}
                  <div className="flex justify-between pt-2 border-t border-gray-200">
                    <span className="font-semibold">Total Tax:</span>
                    <span className="font-semibold">GHS {tax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg pt-2 border-t border-gray-300">
                    <span className="font-bold">Grand Total:</span>
                    <span className="font-bold">GHS {total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )}

            {!applyGhanaTax && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex justify-between text-lg">
                  <span className="font-bold">Total:</span>
                  <span className="font-bold">GHS {total.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-4 py-2"
              placeholder="Additional notes or terms (visible on quote)..."
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>

        {/* Create Customer Modal */}
        {showCustomerModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-xl font-semibold mb-4">Create New Customer</h3>
              {customerError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4">
                  {customerError}
                </div>
              )}
              <form onSubmit={handleCreateCustomer}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={newCustomerEmail}
                      onChange={(e) => setNewCustomerEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                    <input
                      type="tel"
                      value={newCustomerPhone}
                      onChange={(e) => setNewCustomerPhone(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                    <textarea
                      value={newCustomerAddress}
                      onChange={(e) => setNewCustomerAddress(e.target.value)}
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-4 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerModal(false)
                      setCustomerError("")
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingCustomer}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creatingCustomer ? "Creating..." : "Create Customer"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </Wrapper>
  )
}

