"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { getActiveStoreId } from "@/lib/storeSession"
import { getUserRole } from "@/lib/userRoles"
import { getEffectiveStoreIdClient } from "@/lib/storeContext"
import { useConfirm } from "@/components/ui/ConfirmProvider"

type Register = {
  id: string
  name: string
  store_id: string | null
  created_at: string
  is_default?: boolean
}

export default function RegistersPage() {
  const router = useRouter()
  const { openConfirm } = useConfirm()
  const [registers, setRegisters] = useState<Register[]>([])
  const [businessId, setBusinessId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [newRegisterName, setNewRegisterName] = useState("")

  useEffect(() => {
    loadRegisters()
    
    // Reload when store changes
    const handleStoreChange = () => {
      if (businessId) {
        loadRegisters()
      }
    }
    
    window.addEventListener('storeChanged', handleStoreChange)
    
    return () => {
      window.removeEventListener('storeChanged', handleStoreChange)
    }
  }, [businessId])

  const loadRegisters = async () => {
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

      // Get role and effective store_id
      const role = await getUserRole(supabase, user.id, business.id)
      const activeStoreId = getActiveStoreId()
      
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()
      
      const effectiveStoreId = getEffectiveStoreIdClient(
        role,
        activeStoreId && activeStoreId !== 'all' ? activeStoreId : null,
        userData?.store_id || null
      )
      
      // For store users (manager), require store assignment
      if ((role === "manager" || role === "cashier") && !effectiveStoreId) {
        setError("You must be assigned to a store to manage registers.")
        setRegisters([])
        setLoading(false)
        return
      }
      
      // For admin, allow global mode (null = see all registers) or filter by selected store
      let registersQuery = supabase
        .from("registers")
        .select("*")
        .eq("business_id", business.id)
      
      // Filter by effective store_id if set (admin can see all if null)
      if (effectiveStoreId) {
        registersQuery = registersQuery.eq("store_id", effectiveStoreId)
      }
      
      // CRITICAL: Order by default first, then by creation date (not name)
      // Handle case where is_default column doesn't exist yet
      let regs: any[] | null = null
      let regsError: any = null
      
      try {
        const result = await registersQuery
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true })
        regs = result.data
        regsError = result.error
      } catch (err: any) {
        // If is_default column doesn't exist, order by created_at only
        if (err.message?.includes("is_default") || err.code === "42703") {
          const result = await registersQuery
            .order("created_at", { ascending: true })
          regs = result.data
          regsError = result.error
        } else {
          regsError = err
        }
      }

      if (regsError) {
        setError(`Error loading registers: ${regsError.message}`)
        setLoading(false)
        return
      }

      if (regsError) {
        setError(`Error loading registers: ${regsError.message}`)
        setLoading(false)
        return
      }

      setRegisters(regs || [])
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load registers")
      setLoading(false)
    }
  }

  const addRegister = async () => {
    setError("")
    setSuccess("")

    if (!newRegisterName.trim()) {
      setError("Please enter a register name")
      return
    }

    if (!businessId) {
      setError("Business not found. Please refresh the page.")
      return
    }

    // Get active store - REQUIRED for register creation
    const activeStoreId = getActiveStoreId()
    
    if (!activeStoreId || activeStoreId === 'all') {
      setError("Please select a store before creating a register. Go to Stores page and click 'Open Store'.")
      return
    }

    try {
      // CRITICAL: Check if this is the first register for the store
      // If so, set it as default
      const { data: existingRegisters } = await supabase
        .from("registers")
        .select("id")
        .eq("business_id", businessId)
        .eq("store_id", activeStoreId)
      
      const isFirstRegister = !existingRegisters || existingRegisters.length === 0
      
      // Build insert data - conditionally include is_default if column exists
      const insertData: any = {
        business_id: businessId,
        store_id: activeStoreId, // CRITICAL: Always assign to active store
        name: newRegisterName.trim(),
      }
      
      // Only include is_default if column exists (migration 127/128 applied)
      // Try to insert with is_default first, fallback if column doesn't exist
      try {
        const { error: insertError } = await supabase.from("registers").insert({
          ...insertData,
          is_default: isFirstRegister
        })
        
        if (insertError) {
          // If error is about missing column, retry without is_default
          if (insertError.message?.includes("is_default") || insertError.code === "42703") {
            const { error: retryError } = await supabase.from("registers").insert(insertData)
            if (retryError) throw retryError
          } else {
            throw insertError
          }
        }
      } catch (err: any) {
        // Fallback: try without is_default
        if (err.message?.includes("is_default") || err.code === "42703") {
          const { error: retryError } = await supabase.from("registers").insert(insertData)
          if (retryError) throw retryError
        } else {
          throw err
        }
      }

      setNewRegisterName("")
      setSuccess("Register created successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadRegisters()
    } catch (err: any) {
      setError(err.message || "Failed to add register")
    }
  }

  const startEdit = (register: Register) => {
    setEditingId(register.id)
    setEditName(register.name)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName("")
    setError("")
  }

  const saveEdit = async () => {
    setError("")
    setSuccess("")

    if (!editingId || !editName.trim()) {
      setError("Please enter a register name")
      return
    }

    // Verify register belongs to active store (prevent cross-store editing)
    const activeStoreId = getActiveStoreId()
    if (activeStoreId && activeStoreId !== 'all') {
      const register = registers.find(r => r.id === editingId)
      if (register && register.store_id !== activeStoreId) {
        setError("Access denied: This register belongs to a different store.")
        cancelEdit()
        return
      }
    }

    try {
      const { error: updateError } = await supabase
        .from("registers")
        .update({ name: editName.trim() })
        .eq("id", editingId)

      if (updateError) {
        setError(updateError.message || "Failed to update register")
        return
      }

      setSuccess("Register updated successfully!")
      setTimeout(() => setSuccess(""), 3000)
      cancelEdit()
      loadRegisters()
    } catch (err: any) {
      setError(err.message || "Failed to update register")
    }
  }

  const setRegisterAsDefault = async (id: string) => {
    setError("")
    setSuccess("")

    // Verify register belongs to active store (prevent cross-store operations)
    const activeStoreId = getActiveStoreId()
    if (activeStoreId && activeStoreId !== 'all') {
      const register = registers.find(r => r.id === id)
      if (register && register.store_id !== activeStoreId) {
        setError("Access denied: This register belongs to a different store.")
        return
      }
    }

    try {
      // Set this register as default - the database trigger will automatically clear other defaults
      // Handle case where is_default column doesn't exist yet
      const { error: updateError } = await supabase
        .from("registers")
        .update({ is_default: true })
        .eq("id", id)

      if (updateError) {
        // If column doesn't exist, show helpful message
        if (updateError.message?.includes("is_default") || updateError.code === "42703") {
          setError("The is_default column is not available. Please run migration 127 or 128 first.")
          return
        }
        setError(updateError.message || "Failed to set register as default")
        return
      }

      setSuccess("Register set as default successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadRegisters()
    } catch (err: any) {
      if (err.message?.includes("is_default") || err.code === "42703") {
        setError("The is_default column is not available. Please run migration 127 or 128 first.")
      } else {
        setError(err.message || "Failed to set register as default")
      }
    }
  }

  const deleteRegister = async (id: string) => {
    openConfirm({
      title: "Delete register",
      description: "Are you sure you want to delete this register? This action cannot be undone.",
      onConfirm: () => runDeleteRegister(id),
    })
  }

  const runDeleteRegister = async (id: string) => {
    // Verify register belongs to active store (prevent cross-store deletion)
    const activeStoreId = getActiveStoreId()
    if (activeStoreId && activeStoreId !== 'all') {
      const register = registers.find(r => r.id === id)
      if (register && register.store_id !== activeStoreId) {
        setError("Access denied: This register belongs to a different store.")
        return
      }
    }

    try {
      const { error: deleteError } = await supabase.from("registers").delete().eq("id", id)

      if (deleteError) {
        setError(deleteError.message || "Failed to delete register")
        return
      }

      setSuccess("Register deleted successfully!")
      setTimeout(() => setSuccess(""), 3000)
      loadRegisters()
    } catch (err: any) {
      setError(err.message || "Failed to delete register")
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="p-6">
          <p>Loading...</p>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="p-6 max-w-4xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">Register Management</h1>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/dashboard")}
              className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
            >
              Dashboard
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        {/* Add Register Form */}
        <div className="border p-4 rounded-lg mb-6 bg-gray-50">
          <h2 className="text-lg font-semibold mb-3">Add Register</h2>
          <div className="flex gap-2">
            <input
              className="border p-2 flex-1 rounded"
              placeholder="e.g., Till 1, Register 2, Counter 3"
              value={newRegisterName}
              onChange={(e) => setNewRegisterName(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") addRegister()
              }}
            />
            <button
              onClick={addRegister}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              Add Register
            </button>
          </div>
        </div>

        {/* Registers List */}
        <h2 className="text-xl font-bold mb-3">Your Registers</h2>

              {registers.length === 0 ? (
          <div className="border p-6 rounded-lg text-center text-gray-500">
            <p className="mb-2">No registers found for this store.</p>
            <p className="text-sm">Add your first register above to get started.</p>
            {!getActiveStoreId() || getActiveStoreId() === 'all' && (
              <p className="text-sm text-red-600 mt-2">
                Please select a store first from the Stores page.
              </p>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left py-3 px-4 font-semibold">Register Name</th>
                  <th className="text-left py-3 px-4 font-semibold">Status</th>
                  <th className="text-left py-3 px-4 font-semibold">Created</th>
                  <th className="text-right py-3 px-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {registers.map((register) => (
                  <tr key={register.id} className="border-b hover:bg-gray-50">
                    {editingId === register.id ? (
                      <>
                        <td className="py-3 px-4">
                          <input
                            className="border p-2 w-full rounded"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyPress={(e) => {
                              if (e.key === "Enter") saveEdit()
                            }}
                          />
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {register.is_default ? (
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-semibold">Default</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {new Date(register.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={saveEdit}
                              className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="bg-gray-300 text-gray-800 px-3 py-1 rounded text-sm hover:bg-gray-400"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 px-4 font-medium">{register.name}</td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {register.is_default ? (
                            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs font-semibold">Default</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">
                          {new Date(register.created_at).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex justify-end gap-2">
                            {!register.is_default && (
                              <button
                                onClick={() => setRegisterAsDefault(register.id)}
                                className="bg-purple-600 text-white px-3 py-1 rounded text-sm hover:bg-purple-700"
                                title="Set as default register"
                              >
                                Set Default
                              </button>
                            )}
                            <button
                              onClick={() => startEdit(register)}
                              className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteRegister(register.id)}
                              className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedLayout>
  )
}
















