"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { initializeStoreStock } from "@/lib/productsStock"
import { getActiveStoreId, setActiveStoreId } from "@/lib/storeSession"
import { retailPaths } from "@/lib/retail/routes"
import { useRouteGuard } from "@/lib/useRouteGuard"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"

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
  /** Session active store id (`all` = no single-store focus) */
  const [sessionActiveStoreId, setSessionActiveStoreId] = useState<string | null>(null)

  const syncSessionActiveStore = () => {
    if (typeof window === "undefined") return
    setSessionActiveStoreId(getActiveStoreId())
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    syncSessionActiveStore()
    const onStoreChanged = () => syncSessionActiveStore()
    window.addEventListener("storeChanged", onStoreChanged)
    return () => window.removeEventListener("storeChanged", onStoreChanged)
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
      <div className={RS.outer}>
        <div className={RS.containerWide}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        </div>
      </div>
    )
  }

  if (userRole !== "owner" && userRole !== "admin") {
    return (
      <div className={RS.outer}>
        <div className={RS.containerWide}>
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error || "Access denied"}
          </div>
          <button type="button" onClick={() => router.push("/retail/dashboard")} className={RS.primaryButton}>
            Back to dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={RS.outer}>
      <div className={RS.containerWide}>
        <div className={RS.headerBlock}>
          <button type="button" onClick={() => router.push("/retail/dashboard")} className={RS.backLink}>
            ← Back to Dashboard
          </button>
          <div className={RS.actionsRow}>
            <div>
              <h1 className={RS.title}>Stores</h1>
              <p className={RS.subtitle}>Branches and contact details. Open a store to set it active for POS and registers.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                cancelEdit()
                setShowAddForm(true)
              }}
              className={`${RS.primaryButton} shrink-0 self-start sm:self-auto`}
            >
              Add store
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        {showAddForm && (
          <div className={`${RS.formSectionCard} mb-6`}>
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={cancelEdit} className={RS.secondaryButton}>
                  Cancel
                </button>
                <button type="submit" className={RS.primaryButton}>
                  {editingId ? "Update store" : "Create store"}
                </button>
              </div>
            </form>
          </div>
        )}

        {stores.length === 0 ? (
          <div className={`${RS.card} ${RS.cardPad} text-center text-sm text-gray-500 dark:text-gray-400`}>
            No stores yet. Add your first branch to get started.
          </div>
        ) : (
          <div className="space-y-6">
            <div className={RS.listStack}>
              {stores.map((store) => (
                <div key={`m-${store.id}`} className={RS.listCard}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 font-medium text-gray-900 dark:text-white">
                        {store.name}
                        {sessionActiveStoreId &&
                          sessionActiveStoreId !== "all" &&
                          sessionActiveStoreId === store.id && (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:ring-emerald-800">
                              Active for POS
                            </span>
                          )}
                      </div>
                      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{store.location || "—"}</p>
                      <div className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        {store.phone && <div>{store.phone}</div>}
                        {store.email && <div>{store.email}</div>}
                        {!store.phone && !store.email && <span>—</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveStoreId(store.id, store.name)
                        router.push(retailPaths.adminStoreDetail(store.id))
                      }}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      Open store
                    </button>
                    <button type="button" onClick={() => startEdit(store)} className={RS.secondaryButton}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(store.id)}
                      className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className={RS.tableWrap}>
              <table className="w-full min-w-[640px]">
                <thead className="bg-gray-50 dark:bg-gray-800/80">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Store
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Location
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Contact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {stores.map((store) => (
                    <tr key={store.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                      <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">
                        <div className="flex flex-wrap items-center gap-2">
                          <span>{store.name}</span>
                          {sessionActiveStoreId &&
                            sessionActiveStoreId !== "all" &&
                            sessionActiveStoreId === store.id && (
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:ring-emerald-800">
                                Active for POS
                              </span>
                            )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-600 dark:text-gray-400">{store.location || "—"}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {store.phone && <div>{store.phone}</div>}
                        {store.email && <div>{store.email}</div>}
                        {!store.phone && !store.email && "—"}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveStoreId(store.id, store.name)
                              router.push(retailPaths.adminStoreDetail(store.id))
                            }}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                          >
                            Open store
                          </button>
                          <button type="button" onClick={() => startEdit(store)} className={`${RS.linkInline} text-sm`}>
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(store.id)}
                            className="text-sm font-medium text-red-600 hover:text-red-800 dark:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

