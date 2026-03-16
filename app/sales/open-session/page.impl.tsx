"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserStore } from "@/lib/stores"
import { getActiveStoreId } from "@/lib/storeSession"
import { useRouteGuard } from "@/lib/useRouteGuard"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Register = {
  id: string
  name: string
  is_default?: boolean
}

export default function OpenSessionPage() {
  const router = useRouter()
  // Route guard: Only managers/admins can access this page
  useRouteGuard()
  
  const [registers, setRegisters] = useState<Register[]>([])
  const [selectedRegisterId, setSelectedRegisterId] = useState("")
  const [openingFloat, setOpeningFloat] = useState("")
  const [businessId, setBusinessId] = useState("")
  const { format } = useBusinessCurrency()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
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

      // STRICT: Only admin/manager can open register (cashiers blocked)
      const { getUserRole } = await import("@/lib/userRoles")
      const role = await getUserRole(supabase, user.id, business.id)
      
      if (role === "cashier") {
        setError("Cashiers cannot open registers. Please contact a manager or admin.")
        setLoading(false)
        router.push("/pos")
        return
      }
      
      if (role !== "admin" && role !== "manager" && role !== "owner") {
        setError("Only managers and admins can open registers.")
        setLoading(false)
        router.push("/retail/dashboard")
        return
      }

      // Get active store from session (single source of truth)
      // NEVER use user.store_id after session is created
      const activeStoreId = getActiveStoreId()
      const storeIdForRegisters = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null

      // REGISTER-BASED: Check if the selected register already has an open session
      // (We'll check this after register selection, not here during load)
      // This allows multiple registers to be open simultaneously

      // Load registers (filter by active store)
      // CRITICAL: Use default register semantics, NOT alphabetical ordering
      let registersQuery = supabase
        .from("registers")
        .select("id, name, store_id, is_default")
        .eq("business_id", business.id)
      
      if (storeIdForRegisters) {
        registersQuery = registersQuery.eq("store_id", storeIdForRegisters)
      }
      
      // Order by default first, then by creation date (not name)
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

      if (regsError) throw regsError

      setRegisters(regs || [])
      
      // CRITICAL: Preselect default register if available
      const defaultRegister = regs?.find(r => r.is_default)
      if (defaultRegister) {
        setSelectedRegisterId(defaultRegister.id)
      } else if (regs && regs.length > 0) {
        // Fallback to first register if no default set
        setSelectedRegisterId(regs[0].id)
      }
      
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log("=== FORM SUBMITTED ===")
    console.log("Selected register:", selectedRegisterId)
    console.log("Opening float:", openingFloat)
    console.log("Business ID:", businessId)
    
    setError("")
    setSuccess("")
    setSubmitting(true)

    try {
      console.log("Starting session open process...")
      
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in")
        setSubmitting(false)
        return
      }

      if (!selectedRegisterId) {
        setError("Please select a register")
        setSubmitting(false)
        return
      }

      const floatAmount = Number(openingFloat)
      if (isNaN(floatAmount) || floatAmount < 0) {
        setError("Opening float must be a valid number >= 0")
        setSubmitting(false)
        return
      }

      console.log("Fetching register info...")
      
      // Get active store from session (single source of truth)
      const activeStoreId = getActiveStoreId()
      console.log("Active store ID:", activeStoreId)
      
      // Get register's store_id - handle case where column might not exist
      let register: any = null
      let registerError: any = null
      
      try {
        const result = await supabase
          .from("registers")
          .select("store_id")
          .eq("id", selectedRegisterId)
          .single()
        register = result.data
        registerError = result.error
      } catch (err: any) {
        console.warn("Could not fetch register store_id (column may not exist):", err)
        registerError = err
      }

      if (registerError && registerError.code !== "42703" && registerError.code !== "PGRST116") {
        console.error("Error fetching register:", registerError)
        // Continue anyway - store_id might not exist in schema yet
      }

      // CRITICAL: Register MUST belong to active store
      if (!activeStoreId || activeStoreId === 'all') {
        setError("Please select a store before opening a session. Go to Stores page and click 'Open Store'.")
        setSubmitting(false)
        return
      }
      
      // Verify register belongs to active store
      if (register?.store_id && register.store_id !== activeStoreId) {
        setError(`Access denied: Register "${selectedRegisterId}" does not belong to the selected store.`)
        setSubmitting(false)
        return
      }
      
      // If register has no store_id, this is an error (registers must be store-specific)
      if (register && !register.store_id) {
        setError(`Register "${selectedRegisterId}" is not assigned to a store. Please assign it to a store first in Register Settings.`)
        setSubmitting(false)
        return
      }
      
      const registerStoreId = activeStoreId
      console.log("Register store ID:", registerStoreId)

      console.log("Checking if register already has an open session...")
      
      // REGISTER-BASED: Check if THIS REGISTER already has an open session
      // (Not checking user - allows one user to open multiple registers)
      let existingRegisterSession: any = null
      
      try {
        const result = await supabase
          .from("cashier_sessions")
          .select("id, registers(name)")
          .eq("register_id", selectedRegisterId)
          .eq("status", "open")
          .maybeSingle()
        
        existingRegisterSession = result.data
        
        if (result.error && result.error.code !== "PGRST116" && result.error.code !== "42703") {
          console.error("Error checking register session:", result.error)
        }
      } catch (err: any) {
        console.warn("Error checking register session:", err)
      }

      if (existingRegisterSession) {
        const registerName = (existingRegisterSession.registers as any)?.name || 'Unknown'
        setError(`Register "${registerName}" already has an open session. Please close it first or select a different register.`)
        setSubmitting(false)
        return
      }
      
      console.log("Register is available, creating new session...")

      // Create new session
      // Build session data - only include store_id if it exists and is not null
      const sessionData: any = {
        register_id: selectedRegisterId,
        user_id: user.id,
        business_id: businessId,
        opening_float: floatAmount,
        opening_cash: floatAmount,
        status: "open",
        started_at: new Date().toISOString(),
      }
      
      // Only add store_id if we have one (column might not exist or might be null)
      if (registerStoreId) {
        sessionData.store_id = registerStoreId
      }

      console.log("Inserting session with data:", { ...sessionData, business_id: "[hidden]" })

      let session: any = null
      let sessionError: any = null
      
      try {
        const result = await supabase
          .from("cashier_sessions")
          .insert(sessionData)
          .select()
          .single()
        session = result.data
        sessionError = result.error
      } catch (err: any) {
        console.error("Error inserting session:", err)
        sessionError = err
      }

      if (sessionError) {
        console.error("Session insert error:", sessionError)
        // If error is about store_id column not existing, retry without it
        if (sessionError.message?.includes("store_id") || sessionError.code === "42703" || sessionError.message?.includes("column")) {
          console.warn("store_id column may not exist, retrying without it")
          const sessionDataWithoutStore = {
            register_id: selectedRegisterId,
            user_id: user.id,
            business_id: businessId,
            opening_float: floatAmount,
            opening_cash: floatAmount,
            status: "open",
            started_at: new Date().toISOString(),
          }
          
          const { data: retrySession, error: retryError } = await supabase
            .from("cashier_sessions")
            .insert(sessionDataWithoutStore)
            .select()
            .single()
          
          if (retryError) {
            console.error("Retry also failed:", retryError)
            throw retryError
          }
          
          console.log("Session created successfully (without store_id)")
          setSuccess("Register session opened successfully!")
          setSubmitting(false)
          
          // Redirect immediately
          console.log("Redirecting to POS...")
          router.push("/pos")
          return
        }
        throw sessionError
      }

      console.log("Session created successfully:", session?.id)
      setSuccess("Register session opened successfully!")
      setSubmitting(false)
      
      // Redirect immediately instead of waiting
      console.log("Redirecting to POS...")
      router.push("/pos")
    } catch (err: any) {
      console.error("Failed to open session:", err)
      setError(err.message || "Failed to open session")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Open Register Session</h1>
          <button
            onClick={() => router.push("/dashboard")}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
          >
            Dashboard
          </button>
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

        <form onSubmit={handleOpenSession} className="bg-white border border-gray-200 rounded-lg p-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Select Register <span className="text-red-600">*</span>
              </label>
              <select
                value={selectedRegisterId}
                onChange={(e) => setSelectedRegisterId(e.target.value)}
                className="w-full border rounded px-3 py-2"
                required
                disabled={submitting}
              >
                <option value="">-- Select a register --</option>
                {registers.map((reg) => (
                  <option key={reg.id} value={reg.id}>
                    {reg.name}
                  </option>
                ))}
              </select>
              {registers.length === 0 && (
                <p className="text-sm text-gray-500 mt-1">
                  No registers found. Please create a register in{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/retail/admin/registers")}
                    className="text-blue-600 hover:underline"
                  >
                    Register Settings
                  </button>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Opening Float <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="0.00"
                required
                disabled={submitting}
              />
              <p className="text-sm text-gray-500 mt-1">
                Enter the amount of cash in the register at the start of the session
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400 flex-1"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                onClick={(e) => {
                  console.log("Button clicked!", { selectedRegisterId, openingFloat, submitting })
                  if (!selectedRegisterId) {
                    e.preventDefault()
                    setError("Please select a register")
                    return
                  }
                  if (!openingFloat) {
                    e.preventDefault()
                    setError("Please enter opening float")
                    return
                  }
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 flex-1 disabled:bg-gray-400 disabled:cursor-not-allowed"
                disabled={submitting || !selectedRegisterId || !openingFloat}
              >
                {submitting ? "Opening..." : "Open Session"}
              </button>
            </div>
          </div>
        </form>
      </div>
  )
}
