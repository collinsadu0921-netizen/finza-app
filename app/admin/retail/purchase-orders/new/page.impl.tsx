"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

type Supplier = {
  id: string
  name: string
}

type Product = {
  id: string
  name: string
  price: number
}

type POItem = {
  id: string
  product_id: string | null
  variant_id: string | null
  quantity: number
  unit_cost: number
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [supplierId, setSupplierId] = useState(searchParams.get("supplier_id") || "")
  const [reference, setReference] = useState("")
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split("T")[0])
  const [expectedDate, setExpectedDate] = useState("")
  const [items, setItems] = useState<POItem[]>([
    { id: "1", product_id: null, variant_id: null, quantity: 1, unit_cost: 0 },
  ])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      // Load suppliers
      const { data: suppliersData, error: suppliersError } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name", { ascending: true })

      if (suppliersError) {
        throw new Error(suppliersError.message || "Failed to load suppliers")
      }

      setSuppliers(suppliersData || [])

      // Load products
      const { data: productsData, error: productsError } = await supabase
        .from("products")
        .select("id, name, price")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (productsError) {
        throw new Error(productsError.message || "Failed to load products")
      }

      setProducts(productsData || [])
      setLoading(false)
    } catch (err: any) {
      console.error("Error loading data:", err)
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        product_id: null,
        variant_id: null,
        quantity: 1,
        unit_cost: 0,
      },
    ])
  }

  const removeItem = (id: string) => {
    if (items.length === 1) {
      setError("Purchase order must have at least one item")
      return
    }
    setItems(items.filter((item) => item.id !== id))
  }

  const updateItem = (id: string, field: keyof POItem, value: any) => {
    setItems(
      items.map((item) => {
        if (item.id === id) {
          return { ...item, [field]: value }
        }
        return item
      })
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!supplierId) {
      setError("Supplier is required")
      return
    }

    const validItems = items.filter(
      (item) => item.product_id && item.quantity > 0 && item.unit_cost >= 0
    )

    if (validItems.length === 0) {
      setError("Purchase order must have at least one valid item")
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supplier_id: supplierId,
          reference: reference.trim() || null,
          order_date: orderDate,
          expected_date: expectedDate || null,
          items: validItems.map((item) => ({
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            quantity: Number(item.quantity),
            unit_cost: Number(item.unit_cost),
          })),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to create purchase order")
      }

      // Redirect to purchase orders list page
      router.push("/admin/retail/purchase-orders")
    } catch (err: any) {
      console.error("Error creating purchase order:", err)
      setError(err.message || "Failed to create purchase order")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Loading...</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">New Purchase Order</h1>
          <p className="text-gray-600 mt-1">
            Create a new purchase order for inventory
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
          <div className="space-y-6">
            {/* Supplier Selection */}
            <div>
              <label htmlFor="supplier" className="block text-sm font-medium text-gray-700 mb-1">
                Supplier <span className="text-red-600">*</span>
              </label>
              <select
                id="supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                required
                className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={submitting}
              >
                <option value="">Select a supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Reference and Dates */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="reference" className="block text-sm font-medium text-gray-700 mb-1">
                  Reference
                </label>
                <input
                  type="text"
                  id="reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="PO-001"
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="orderDate" className="block text-sm font-medium text-gray-700 mb-1">
                  Order Date <span className="text-red-600">*</span>
                </label>
                <input
                  type="date"
                  id="orderDate"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  required
                  className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={submitting}
                />
              </div>
              <div>
                <label htmlFor="expectedDate" className="block text-sm font-medium text-gray-700 mb-1">
                  Expected Date
                </label>
                <input
                  type="date"
                  id="expectedDate"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  className="w-full border rounded px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={submitting}
                />
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Items <span className="text-red-600">*</span>
                </label>
                <button
                  type="button"
                  onClick={addItem}
                  className="text-sm bg-gray-200 text-gray-800 px-3 py-1 rounded hover:bg-gray-300"
                  disabled={submitting}
                >
                  + Add Item
                </button>
              </div>

              <div className="space-y-3">
                {items.map((item, index) => (
                  <div key={item.id} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
                    <div className="col-span-5">
                      <label className="block text-xs text-gray-600 mb-1">Product</label>
                      <select
                        value={item.product_id || ""}
                        onChange={(e) => updateItem(item.id, "product_id", e.target.value || null)}
                        required
                        className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={submitting}
                      >
                        <option value="">Select product</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">Quantity</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, "quantity", Number(e.target.value))}
                        required
                        className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={submitting}
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-gray-600 mb-1">Unit Cost</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unit_cost}
                        onChange={(e) => updateItem(item.id, "unit_cost", Number(e.target.value))}
                        required
                        className="w-full border rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        disabled={submitting}
                      />
                    </div>
                    <div className="col-span-1">
                      <label className="block text-xs text-gray-600 mb-1">Total</label>
                      <div className="px-3 py-2 text-sm text-gray-700 font-semibold">
                        {(item.quantity * item.unit_cost).toFixed(2)}
                      </div>
                    </div>
                    <div className="col-span-1">
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="w-full bg-red-100 text-red-700 px-2 py-2 rounded text-sm hover:bg-red-200"
                        disabled={submitting || items.length === 1}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 bg-gray-200 text-gray-800 px-4 py-2 rounded hover:bg-gray-300"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Create Purchase Order"}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
