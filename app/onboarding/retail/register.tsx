"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getActiveStoreId } from "@/lib/storeSession"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

interface RetailOnboardingRegisterProps {
  business: any
  businessId: string
  onComplete: () => void
}

type Register = {
  id: string
  name: string
  is_default?: boolean
}

export default function RetailOnboardingRegister({
  business,
  businessId,
  onComplete
}: RetailOnboardingRegisterProps) {
  const { currencySymbol } = useBusinessCurrency()
  const [registers, setRegisters] = useState<Register[]>([])
  const [selectedRegisterId, setSelectedRegisterId] = useState("")
  const [openingFloat, setOpeningFloat] = useState("0")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    loadRegisters()
  }, [])

  const loadRegisters = async () => {
    try {
      setLoading(true)
      const activeStoreId = getActiveStoreId()

      if (!activeStoreId) {
        setError("Please create a store first")
        setLoading(false)
        return
      }

      // Load registers for active store
      // Handle case where is_default column doesn't exist yet
      let registersData: any[] | null = null
      let registersError: any = null
      
      try {
        const result = await supabase
          .from("registers")
          .select("id, name, is_default")
          .eq("business_id", businessId)
          .eq("store_id", activeStoreId)
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true })
        registersData = result.data
        registersError = result.error
      } catch (err: any) {
        // If is_default column doesn't exist, select without it and order by created_at only
        if (err.message?.includes("is_default") || err.code === "42703") {
          const result = await supabase
            .from("registers")
            .select("id, name")
            .eq("business_id", businessId)
            .eq("store_id", activeStoreId)
            .order("created_at", { ascending: true })
          registersData = result.data
          registersError = result.error
        } else {
          registersError = err
        }
      }

      if (registersError) throw registersError

      // CRITICAL: Do NOT auto-create "Main Register" if registers already exist
      // User must explicitly create a register if they want one
      if (registersError) throw registersError

      if (!registersData || registersData.length === 0) {
        // No registers exist - user will need to create one
        setRegisters([])
        setSelectedRegisterId("")
      } else {
        setRegisters(registersData)
        // Preselect default register if available, otherwise first register
        const defaultRegister = registersData.find(r => r.is_default)
        setSelectedRegisterId(defaultRegister?.id || registersData[0].id)
      }
    } catch (err: any) {
      console.error("Error loading registers:", err)
      setError(err.message || "Failed to load registers")
    } finally {
      setLoading(false)
    }
  }

  const handleCreateRegister = async () => {
    setError("")
    
    const activeStoreId = getActiveStoreId()
    if (!activeStoreId) {
      setError("Please create a store first")
      return
    }

    try {
      // CRITICAL: Create register and set as default (first register for store)
      const { data: existingRegisters } = await supabase
        .from("registers")
        .select("id")
        .eq("business_id", businessId)
        .eq("store_id", activeStoreId)
      
      const isFirstRegister = !existingRegisters || existingRegisters.length === 0
      
      // Build insert data - conditionally include is_default if column exists
      const insertData: any = {
        business_id: businessId,
        store_id: activeStoreId,
        name: "Main Register",
      }
      
      // Try to insert with is_default first, fallback if column doesn't exist
      let newRegister: any = null
      let createError: any = null
      
      try {
        const result = await supabase
          .from("registers")
          .insert({
            ...insertData,
            is_default: isFirstRegister
          })
          .select()
          .single()
        newRegister = result.data
        createError = result.error
        
        // If error is about missing column, retry without is_default
        if (createError && (createError.message?.includes("is_default") || createError.code === "42703")) {
          const retryResult = await supabase
            .from("registers")
            .insert(insertData)
            .select()
            .single()
          newRegister = retryResult.data
          createError = retryResult.error
        }
      } catch (err: any) {
        // Fallback: try without is_default
        if (err.message?.includes("is_default") || err.code === "42703") {
          const retryResult = await supabase
            .from("registers")
            .insert(insertData)
            .select()
            .single()
          newRegister = retryResult.data
          createError = retryResult.error
        } else {
          createError = err
        }
      }

      if (createError) throw createError
      
      // Reload registers
      await loadRegisters()
      if (newRegister) {
        setSelectedRegisterId(newRegister.id)
      }
    } catch (err: any) {
      console.error("Error creating register:", err)
      setError(err.message || "Failed to create register")
    }
  }

  const handleOpenSession = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!selectedRegisterId) {
      setError("Please select a register")
      return
    }

    const floatAmount = parseFloat(openingFloat)
    if (isNaN(floatAmount) || floatAmount < 0) {
      setError("Opening float must be a valid number >= 0")
      return
    }

    setSubmitting(true)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in")
        setSubmitting(false)
        return
      }

      const activeStoreId = getActiveStoreId()
      if (!activeStoreId) {
        setError("Please select a store first")
        setSubmitting(false)
        return
      }

      // REGISTER-BASED: Check if THIS REGISTER already has an open session
      const { data: existingRegisterSession } = await supabase
        .from("cashier_sessions")
        .select("id")
        .eq("register_id", selectedRegisterId)
        .eq("status", "open")
        .maybeSingle()

      if (existingRegisterSession) {
        setError("This register already has an open session. Please close it first or select a different register.")
        setSubmitting(false)
        return
      }

      // Create session
      const { error: sessionError } = await supabase
        .from("cashier_sessions")
        .insert({
          register_id: selectedRegisterId,
          user_id: user.id,
          business_id: businessId,
          store_id: activeStoreId,
          opening_float: floatAmount,
          opening_cash: floatAmount,
          status: "open",
          started_at: new Date().toISOString(),
        })

      if (sessionError) throw sessionError

      // Proceed to next step
      onComplete()
    } catch (err: any) {
      console.error("Error opening session:", err)
      setError(err.message || "Failed to open register session")
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div>Loading registers...</div>
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
        Step 4: Open Register Session
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6">
        Open a register session to start processing sales at your POS terminal. Enter the starting cash amount in your register.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {registers.length === 0 && (
        <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
          <p className="text-blue-800 dark:text-blue-200 mb-2">
            No registers found for this store. Please create a register first.
          </p>
          <button
            type="button"
            onClick={handleCreateRegister}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Create Register
          </button>
        </div>
      )}

      <form onSubmit={handleOpenSession} className="space-y-4">
        {registers.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Register *
            </label>
            <select
              value={selectedRegisterId}
              onChange={(e) => setSelectedRegisterId(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              required
            >
              {registers.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Opening Float {currencySymbol ? `(${currencySymbol})` : ''} *
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={openingFloat}
            onChange={(e) => setOpeningFloat(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
            required
            placeholder="0.00"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Starting cash amount in your register
          </p>
        </div>

        <div className="flex gap-4 pt-4">
          <button
            type="submit"
            disabled={submitting || registers.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Opening Session..." : "Open Session"}
          </button>
          <button
            type="button"
            onClick={onComplete}
            className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 px-6 py-3 rounded-lg font-medium"
          >
            Skip for Now
          </button>
        </div>
      </form>
    </div>
  )
}















