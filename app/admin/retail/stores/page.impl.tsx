"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { initializeStoreStock } from "@/lib/productsStock"
import { setActiveStoreId } from "@/lib/storeSession"
import { useRouteGuard } from "@/lib/useRouteGuard"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type Store = {
  id: string
  name: string
  location: string | null
  phone: string | null
  email: string | null
  opening_hours: any
  created_at: string
}

export default function StoresPage() {
  const router = useRouter()
  useRouteGuard()
  const { openConfirm, confirmWithInput } = useConfirm()
  const [loading, setLoading] = useState(true)
  const [stores, setStores] = useState<Store[]>([])
  const [businessId, setBusinessId] = useState("")
  const [userRole, setUserRole] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    phone: "",
    email: "",
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      const role = await getUserRole(supabase, user.id, business.id)
      setUserRole(role)

      // Only owner/admin can manage stores
      // Check role using exact string comparison
      const isOwner = role === "owner"
      const isAdmin = role === "admin"
      
      if (!isOwner && !isAdmin) {
        setError("Access denied. Only owners and admins can manage stores.")
        setLoading(false)
        return
      }

      // Load stores
      const { data: storesData, error: storesError } = await supabase
        .from("stores")
        .select("*")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (storesError) throw storesError

      setStores(storesData || [])
    } catch (err: any) {
      setError(err.message || "Failed to load stores")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.name.trim()) {
      setError("Store name is required")
      return
    }

    try {
      if (editingId) {
        // Update existing store
        const { error: updateError } = await supabase
          .from("stores")
          .update({
            name: formData.name.trim(),
            location: formData.location.trim() || null,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingId)

        if (updateError) throw updateError
      } else {
        // Create new store
        const { error: insertError } = await supabase
          .from("stores")
          .insert({
            business_id: businessId,
            name: formData.name.trim(),
            location: formData.location.trim() || null,
            phone: formData.phone.trim() || null,
            email: formData.email.trim() || null,
          })

        if (insertError) throw insertError
        
        // Initialize products_stock rows for all products in the new store
        // Get the inserted store ID
        const { data: newStore } = await supabase
          .from("stores")
          .select("id")
          .eq("business_id", businessId)
          .eq("name", formData.name.trim())
          .order("created_at", { ascending: false })
          .limit(1)
          .single()
        
        if (newStore?.id) {
          await initializeStoreStock(supabase, businessId, newStore.id)
        }
      }

      // Reset form and reload
      setFormData({ name: "", location: "", phone: "", email: "" })
      setShowAddForm(false)
      setEditingId(null)
      loadData()
    } catch (err: any) {
      setError(err.message || "Failed to save store")
    }
  }

  const startEdit = (store: Store) => {
    setEditingId(store.id)
    setFormData({
      name: store.name,
      location: store.location || "",
      phone: store.phone || "",
      email: store.email || "",
    })
    setShowAddForm(true)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setFormData({ name: "", location: "", phone: "", email: "" })
    setShowAddForm(false)
  }

  const handleDelete = async (id: string) => {
    // Check for registers in this store
    const { data: registers, error: registersError } = await supabase
      .from("registers")
      .select("id, name")
      .eq("store_id", id)

    if (registersError) {
      setError(`Error checking registers: ${registersError.message}`)
      return
    }

    // Check for stock records in this store
    const { data: stockRecords, error: stockError } = await supabase
      .from("products_stock")
      .select("id, stock, stock_quantity")
      .eq("store_id", id)

    if (stockError) {
      setError(`Error checking stock: ${stockError.message}`)
      return
    }

    // Calculate total stock value
    const totalStockItems = stockRecords?.length || 0
    const totalStockQuantity = stockRecords?.reduce((sum: number, record: any) => {
      return sum + (record.stock_quantity || record.stock || 0)
    }, 0) || 0

    // Check for active cashier sessions
    const { data: activeSessions, error: sessionsError } = await supabase
      .from("cashier_sessions")
      .select("id")
      .eq("store_id", id)
      .eq("status", "open")

    if (sessionsError) {
      setError(`Error checking sessions: ${sessionsError.message}`)
      return
    }

    // Check for sales in this store
    const { data: salesData, error: salesError } = await supabase
      .from("sales")
      .select("id")
      .eq("store_id", id)
      .limit(1)

    if (salesError) {
      setError(`Error checking sales: ${salesError.message}`)
      return
    }

    const hasSales = (salesData?.length || 0) > 0

    // Build warning message
    let warningMessage = "🚨 CRITICAL WARNING: Deleting this store will PERMANENTLY DELETE:\n\n"
    
    if (registers && registers.length > 0) {
      warningMessage += `❌ ALL ${registers.length} REGISTER(S):\n`
      registers.forEach((r: any) => {
        warningMessage += `   • ${r.name}\n`
      })
      warningMessage += "\n"
    }
    
    if (totalStockItems > 0) {
      warningMessage += `❌ ALL STOCK RECORDS (${totalStockItems} product/variant combinations)\n`
      warningMessage += `   • Total quantity: ${totalStockQuantity} units\n`
      warningMessage += `   • ALL inventory data for this store will be LOST FOREVER\n\n`
    }
    
    if (hasSales) {
      warningMessage += `⚠️ Sales records will be kept but store reference will be removed\n\n`
    }
    
    if (activeSessions && activeSessions.length > 0) {
      warningMessage += `⚠️ ${activeSessions.length} ACTIVE CASHIER SESSION(S) will be closed\n\n`
    }
    
    warningMessage += "⚠️ THIS ACTION CANNOT BE UNDONE!\n"
    warningMessage += "⚠️ NO BACKUP OR RECOVERY POSSIBLE!\n\n"
    warningMessage += "Type 'DELETE' to confirm (case-sensitive):"

    confirmWithInput({
      title: "Delete store",
      description: warningMessage,
      expectedValue: "DELETE",
      inputLabel: "Type 'DELETE' to confirm (case-sensitive)",
      onConfirm: () => {
        if (activeSessions && activeSessions.length > 0) {
          setError(`Cannot delete store: There are ${activeSessions.length} active cashier session(s). Please close all sessions first.`)
          return
        }
        openConfirm({
          title: "Final confirmation",
          description: "Are you absolutely certain you want to delete this store and ALL associated data?",
          onConfirm: () => {
            supabase.from("stores").delete().eq("id", id).then(({ error }) => {
              if (error) {
                setError(error.message || "Failed to delete store")
              } else {
                loadData()
              }
            })
          },
        })
      },
    })
  }

  if (loading) {
    return (
      <>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </>
    )
  }

  if (userRole !== "owner" && userRole !== "admin") {
    return (
      <>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Access denied"}
          </div>
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="bg-blue-600 text-white px-4 py-2 rounded"
          >
            Back to Dashboard
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Dashboard
          </button>
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold mb-2">Stores Management</h1>
              <p className="text-gray-600">Manage your store locations and branches</p>
            </div>
            <button
              onClick={() => {
                cancelEdit()
                setShowAddForm(true)
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              + Add Store
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {showAddForm && (
          <div className="bg-white border rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">
              {editingId ? "Edit Store" : "Add New Store"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Store Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="e.g., Accra, Osu"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    placeholder="e.g., 0551234567"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-2"
                    placeholder="store@example.com"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
                >
                  {editingId ? "Update" : "Create"} Store
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="bg-gray-300 text-gray-800 px-6 py-2 rounded hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Store Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Location
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stores.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                    No stores found. Add your first store to get started.
                  </td>
                </tr>
              ) : (
                stores.map((store) => (
                  <tr key={store.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium">{store.name}</td>
                    <td className="px-6 py-4 text-gray-600">{store.location || "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {store.phone && <div>📞 {store.phone}</div>}
                      {store.email && <div>✉️ {store.email}</div>}
                      {!store.phone && !store.email && "—"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            // Set active store using helper function (single source of truth)
                            setActiveStoreId(store.id, store.name)
                            router.push(`/admin/retail/store/${store.id}`)
                          }}
                          className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 text-sm font-medium"
                        >
                          Open Store
                        </button>
                        <button
                          onClick={() => startEdit(store)}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(store.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

