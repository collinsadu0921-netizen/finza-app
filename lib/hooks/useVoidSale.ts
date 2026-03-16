"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { getAuthorityLevel, requiresOverride, REQUIRED_AUTHORITY } from "@/lib/authority"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

interface UseVoidSaleOptions {
  onSuccess?: () => void
  onError?: (error: string) => void
}

export function useVoidSale(options: UseVoidSaleOptions = {}) {
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [saleId, setSaleId] = useState<string | null>(null)
  const [cashierId, setCashierId] = useState<string | null>(null)
  const [error, setError] = useState("")

  const requestVoidSale = async (targetSaleId: string) => {
    setError("")
    
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in to void a sale.")
        options.onError?.("You must be logged in to void a sale.")
        return
      }

      // Check if sale exists
      const { data: sale, error: saleError } = await supabase
        .from("sales")
        .select("id, business_id")
        .eq("id", targetSaleId)
        .maybeSingle()

      if (saleError || !sale) {
        setError("Sale not found.")
        options.onError?.("Sale not found.")
        return
      }

      // AUTHORITY-BASED CHECK: Determine if override is required
      // Get user's role and authority level
      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found.")
        options.onError?.("Business not found.")
        return
      }

      const userRole = await getUserRole(supabase, user.id, business.id)
      const userAuthority = getAuthorityLevel(userRole as any)
      
      // ADMIN BYPASS: If user has admin authority (100), they bypass manager-level overrides
      // Only show override if user authority < required authority (50)
      if (requiresOverride(userAuthority, REQUIRED_AUTHORITY.VOID)) {
        // User needs override - show modal
        setSaleId(targetSaleId)
        setCashierId(user.id)
        setShowOverrideModal(true)
      } else {
        // User has sufficient authority - process void directly (no override needed)
        // Note: This hook is for showing override modal. Direct void should be handled by calling code.
        // For now, we'll still show the modal but the API will accept it without requiring supervisor PIN
        setSaleId(targetSaleId)
        setCashierId(user.id)
        setShowOverrideModal(true)
      }
    } catch (err: any) {
      const errorMsg = err.message || "Failed to initiate void sale."
      setError(errorMsg)
      options.onError?.(errorMsg)
    }
  }

  const handleOverrideSuccess = () => {
    setShowOverrideModal(false)
    setSaleId(null)
    setCashierId(null)
    setError("")
    options.onSuccess?.()
  }

  const handleOverrideClose = () => {
    setShowOverrideModal(false)
    setSaleId(null)
    setCashierId(null)
  }

  return {
    requestVoidSale,
    showOverrideModal,
    saleId,
    cashierId,
    handleOverrideClose,
    handleOverrideSuccess,
    error,
  }
}

