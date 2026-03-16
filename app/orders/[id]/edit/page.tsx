"use client"

import { useState, useEffect } from "react"
import { useRouter, useParams, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import Toast from "@/components/Toast"

type OrderItem = {
  id?: string
  product_service_id?: string | null
  description: string
  quantity: number
  unit_price: number
}

type Order = {
  id: string
  customer_id: string | null
  status: string
  notes: string | null
}

export default function OrderEditPage() {
  const router = useRouter()
  const params = useParams()
  const pathname = usePathname()
  const orderId = (params?.id as string) || ""
  const isUnderService = pathname?.startsWith("/service") ?? false
  const Wrapper = isUnderService ? ({ children }: { children: React.ReactNode }) => <>{children}</> : ProtectedLayout

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [notes, setNotes] = useState("")
  const [selectedClientId, setSelectedClientId] = useState<string>("")
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)

  useEffect(() => {
    if (orderId) {
      loadOrder()
    }
  }, [orderId])

  const loadOrder = async () => {
    try {
      setLoading(true)
      setError("")

      const response = await fetch(`/api/orders/${orderId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to load order")
      }

      const data = await response.json()
      setOrder(data.order)
      setNotes(data.order.notes || "")
      setSelectedClientId(data.order.customer_id || "")
      
      // Load customers for dropdown
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        const business = await getCurrentBusiness(supabase, user.id)
        if (business) {
          const { data: customersData } = await supabase
            .from("customers")
            .select("id, name")
            .eq("business_id", business.id)
            .is("deleted_at", null)
            .order("name", { ascending: true })
          setClients(customersData || [])
        }
      }
      
      // Map items to editable format
      const mappedItems = (data.items || []).map((item: any) => ({
        id: item.id,
        product_service_id: item.product_service_id || null,
        description: item.description || "",
        quantity: Number(item.quantity || item.qty || 0),
        unit_price: Number(item.unit_price || 0),
      }))
      setItems(mappedItems.length > 0 ? mappedItems : [{ description: "", quantity: 1, unit_price: 0 }])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load order")
      setLoading(false)
    }
  }

  const handleAddItem = () => {
    setItems([...items, { description: "", quantity: 1, unit_price: 0 }])
  }

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index))
  }

  const handleItemChange = (index: number, field: keyof OrderItem, value: any) => {
    const newItems = [...items]
    // Handle quantity and unit_price as numbers, ensuring proper conversion
    if (field === "quantity" || field === "unit_price") {
      const numValue = value === "" || value === null || value === undefined ? 0 : Number(value)
      newItems[index] = { ...newItems[index], [field]: isNaN(numValue) ? 0 : numValue }
    } else {
      newItems[index] = { ...newItems[index], [field]: value }
    }
    setItems(newItems)
  }

  const handleSave = async () => {
    if (!order) return

    // Validate items
    if (items.length === 0) {
      setToast({ message: "Please add at least one item", type: "error" })
      return
    }

    const hasEmptyDescription = items.some((item) => !item.description.trim())
    if (hasEmptyDescription) {
      setToast({ message: "All items must have a description", type: "error" })
      return
    }

    try {
      setSaving(true)
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id: selectedClientId || null,
          notes,
          items: items.map((item) => {
            const mapped = {
              product_service_id: item.product_service_id || null,
              description: item.description,
              quantity: Number(item.quantity ?? 0),
              unit_price: Number(item.unit_price ?? 0),
            }
            console.log("💾 Saving order item:", JSON.stringify(mapped))
            return mapped
          }),
          apply_taxes: true,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setToast({ message: "Order updated successfully!", type: "success" })
        setTimeout(() => {
          router.push(`/service/orders/${orderId}/view`)
        }, 1000)
      } else {
        setToast({ message: data.error || "Failed to update order", type: "error" })
        setSaving(false)
      }
    } catch (err: any) {
      setToast({ message: "Error updating order. Please try again.", type: "error" })
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

  if (error || !order) {
    return (
      <Wrapper>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Unable to load this order."}
          </div>
          <button
            onClick={() => router.push(`/service/orders/${orderId}/view`)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Order
          </button>
        </div>
      </Wrapper>
    )
  }

  // Prevent editing invoiced orders
  if (order.status === "invoiced") {
    return (
      <Wrapper>
        <div className="p-6">
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded mb-4">
            This order has been converted to an invoice and cannot be edited.
          </div>
          <button
            onClick={() => router.push(`/service/orders/${orderId}/view`)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Back to Order
          </button>
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Edit Order</h1>
            <p className="text-gray-600 dark:text-gray-400">Update order details and items</p>
          </div>
          <button
            onClick={() => router.push(`/service/orders/${orderId}/view`)}
            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>

        {/* Customer Selection */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Customer</label>
          <select
            value={selectedClientId}
            onChange={(e) => setSelectedClientId(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">No Customer</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            placeholder="Add any notes or instructions for this order..."
          />
        </div>

        {/* Items */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold dark:text-white">Order Items</h2>
            <button
              onClick={handleAddItem}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
            >
              + Add Item
            </button>
          </div>

          <div className="space-y-4">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-12 gap-4 items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="col-span-5">
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => handleItemChange(index, "description", e.target.value)}
                    placeholder="Item description"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    value={item.quantity != null ? Number(item.quantity) : ""}
                    onChange={(e) => {
                      const val = e.target.value
                      handleItemChange(index, "quantity", val === "" ? 0 : Number(val))
                    }}
                    onBlur={(e) => {
                      // Ensure valid number on blur
                      const val = e.target.value
                      if (val === "" || isNaN(Number(val)) || Number(val) < 0) {
                        handleItemChange(index, "quantity", 1)
                      }
                    }}
                    min="0"
                    step="1"
                    placeholder="Qty"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="number"
                    value={item.unit_price != null ? item.unit_price : ""}
                    onChange={(e) => handleItemChange(index, "unit_price", e.target.value)}
                    min="0"
                    step="0.01"
                    placeholder="Unit Price"
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div className="col-span-1 text-right dark:text-white">
                  ₵{(item.quantity * item.unit_price).toFixed(2)}
                </div>
                <div className="col-span-1">
                  <button
                    onClick={() => handleRemoveItem(index)}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end gap-4">
          <button
            onClick={() => router.push(`/service/orders/${orderId}/view`)}
            className="bg-gray-600 text-white px-6 py-2 rounded-lg hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </div>
    </Wrapper>
  )
}

