"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { calculateBaseFromTotalIncludingTaxes } from "@/lib/ghanaTaxEngine"

type Client = {
  id: string
  name: string
}

type OrderItem = {
  id: string
  product_id: string | null
  description: string
  quantity: number
  price: number
  total: number
}

export default function NewOrderPage() {
  const router = useRouter()
  const [clients, setClients] = useState<Client[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [selectedClientId, setSelectedClientId] = useState<string>("")
  const [notes, setNotes] = useState<string>("")
  const [items, setItems] = useState<OrderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [businessIndustry, setBusinessIndustry] = useState<string | null>(null)
  const [showClientModal, setShowClientModal] = useState(false)
  const [newClientName, setNewClientName] = useState("")
  const [newClientEmail, setNewClientEmail] = useState("")
  const [newClientPhone, setNewClientPhone] = useState("")
  const [newClientAddress, setNewClientAddress] = useState("")
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientError, setClientError] = useState("")
  const [applyGhanaTax, setApplyGhanaTax] = useState(true)

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

      // Load customers
      const { data: customersData } = await supabase
        .from("customers")
        .select("id, name")
        .eq("business_id", business.id)
        .is("deleted_at", null)
        .order("name", { ascending: true })

      setClients(customersData || [])

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
        console.error("Error loading products:", productsError)
      } else {
        // Map products_services to expected format (unit_price -> price)
        const mappedProducts = (productsData || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          price: Number(p.unit_price) || 0,
        }))
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
      }
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
      },
    ])
  }

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof OrderItem, value: any) => {
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
      const currentItem = items.find((item) => item.id === itemId)
      const quantity = currentItem?.quantity || 1
      const productPrice = Number(product.price) || 0
      const total = quantity * productPrice

      setItems(
        items.map((item) => {
          if (item.id === itemId) {
            return {
              ...item,
              product_id: productId,
              description: product.name || "",
              price: productPrice,
              total: total,
            }
          }
          return item
        })
      )
    }
  }

  // Calculate subtotal from line items (tax-inclusive)
  const subtotal = items.reduce((sum, item) => {
    const lineTotal = (Number(item.quantity) || 0) * (Number(item.price) || 0)
    return sum + lineTotal
  }, 0)

  // Calculate taxes using tax engine - treat entered prices as tax-inclusive
  let taxBreakdown: ReturnType<typeof calculateBaseFromTotalIncludingTaxes>["taxBreakdown"] | null = null
  let baseSubtotal = subtotal
  let tax = 0
  let total = subtotal

  if (applyGhanaTax && items.length > 0 && subtotal > 0) {
    const reverseCalc = calculateBaseFromTotalIncludingTaxes(subtotal, true)
    baseSubtotal = reverseCalc.baseAmount
    taxBreakdown = reverseCalc.taxBreakdown
    tax = taxBreakdown.totalTax
    total = taxBreakdown.grandTotal
  }

  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault()
    setClientError("")

    if (!newClientName.trim()) {
      setClientError("Client name is required")
      return
    }

    try {
      setCreatingClient(true)
      const { data: newClient, error: createError } = await supabase
        .from("customers")
        .insert({
          business_id: businessId,
          name: newClientName.trim(),
          email: newClientEmail.trim() || null,
          phone: newClientPhone.trim() || null,
          address: newClientAddress.trim() || null,
        })
        .select()
        .single()

      if (createError) throw createError

      setClients([...clients, newClient])
      setSelectedClientId(newClient.id)
      setShowClientModal(false)
      setNewClientName("")
      setNewClientEmail("")
      setNewClientPhone("")
      setNewClientAddress("")
    } catch (err: any) {
      setClientError(err.message || "Failed to create client")
    } finally {
      setCreatingClient(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!businessId) {
      setError("Business ID not found. Please refresh the page.")
      return
    }

    if (!selectedClientId) {
      setError("Please select a customer")
      return
    }

    if (items.length === 0) {
      setError("Please add at least one item")
      return
    }

    // Validate items
    const invalidItems = items.filter(item => !item.description.trim() || item.quantity <= 0 || item.price <= 0)
    if (invalidItems.length > 0) {
      setError("Please fill in all item fields (description, quantity, and price)")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/orders/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          business_id: businessId,
          customerId: selectedClientId,
          items: items.map(item => ({
            product_id: item.product_id,
            product_service_id: item.product_id,
            description: item.description || "",
            quantity: Number(item.quantity) || 0,
            price: Number(item.price) || 0,
            unit_price: Number(item.price) || 0,
          })),
          notes: notes || null,
          apply_taxes: applyGhanaTax,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.message || "Failed to create order")
      }

      if (data.success && data.orderId) {
        router.push(`/service/orders/${data.orderId}/view`)
      } else {
        throw new Error("Invalid response from server")
      }
    } catch (err: any) {
      setError(err.message || "Failed to create order")
      setLoading(false)
    }
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">Create New Order</h1>
          <p className="text-gray-600">Add items and details for your new order</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Customer Selection */}
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h2 className="text-xl font-semibold mb-4">Customer</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Customer *</label>
                <div className="flex gap-2">
                  <select
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="flex-1 border border-gray-300 rounded-lg px-4 py-2"
                    required
                  >
                    <option value="">Select customer</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowClientModal(true)}
                    className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
                  >
                    + New
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="bg-white p-6 rounded-lg shadow mb-6">
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
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    >
                      <option value="">{businessIndustry === "service" ? "Select Service" : "Select product/service"}</option>
                      {products.length === 0 ? (
                        <option value="" disabled>{businessIndustry === "service" ? "No services available. Create services first." : "No products available. Create products first."}</option>
                      ) : (
                        products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} - GHS {Number(product.price || 0).toFixed(2)}
                          </option>
                        ))
                      )}
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
          <div className="bg-white p-6 rounded-lg shadow mb-6">
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
                onClick={() => setApplyGhanaTax(!applyGhanaTax)}
                role="switch"
                aria-checked={applyGhanaTax}
                className={`
                  relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                  ${applyGhanaTax ? 'bg-blue-600' : 'bg-gray-300'}
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

            {applyGhanaTax && taxBreakdown && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal (before tax):</span>
                    <span className="font-medium">GHS {baseSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>NHIL (2.5%):</span>
                    <span>GHS {taxBreakdown.nhil.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>GETFund (2.5%):</span>
                    <span>GHS {taxBreakdown.getfund.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>VAT (15%):</span>
                    <span>GHS {taxBreakdown.vat.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200">
                    <span className="font-semibold">Total Tax:</span>
                    <span className="font-semibold">GHS {taxBreakdown.totalTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg pt-2 border-t border-gray-300">
                    <span className="font-bold">Grand Total (tax-inclusive):</span>
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
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h2 className="text-xl font-semibold mb-4">Notes</h2>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full border border-gray-300 rounded-lg px-4 py-2"
              placeholder="Additional notes or terms..."
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
              disabled={loading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Order"}
            </button>
          </div>
        </form>

        {/* Client Modal */}
        {showClientModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h3 className="text-xl font-semibold mb-4">Create New Client</h3>
              {clientError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4">
                  {clientError}
                </div>
              )}
              <form onSubmit={handleCreateClient}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                    <input
                      type="text"
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={newClientEmail}
                      onChange={(e) => setNewClientEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                      type="tel"
                      value={newClientPhone}
                      onChange={(e) => setNewClientPhone(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                    <textarea
                      value={newClientAddress}
                      onChange={(e) => setNewClientAddress(e.target.value)}
                      rows={2}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-4 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowClientModal(false)
                      setClientError("")
                      setNewClientName("")
                      setNewClientEmail("")
                      setNewClientPhone("")
                      setNewClientAddress("")
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingClient}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creatingClient ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}

