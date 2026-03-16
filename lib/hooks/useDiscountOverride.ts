"use client"

import { useState } from "react"
import { supabase } from "@/lib/supabaseClient"

interface UseDiscountOverrideOptions {
  onSuccess?: () => void
  onError?: (error: string) => void
}

export function useDiscountOverride(options: UseDiscountOverrideOptions = {}) {
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [saleId, setSaleId] = useState<string | null>(null)
  const [cashierId, setCashierId] = useState<string | null>(null)
  const [discountPercent, setDiscountPercent] = useState<number | null>(null)
  const [error, setError] = useState("")

  const requestDiscountOverride = async (
    targetSaleId: string,
    discount: number
  ) => {
    setError("")
    
    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in to apply discounts.")
        options.onError?.("You must be logged in to apply discounts.")
        return
      }

      // Check if sale exists
      const { data: sale, error: saleError } = await supabase
        .from("sales")
        .select("id")
        .eq("id", targetSaleId)
        .maybeSingle()

      if (saleError || !sale) {
        setError("Sale not found.")
        options.onError?.("Sale not found.")
        return
      }

      // Show override modal
      setSaleId(targetSaleId)
      setCashierId(user.id)
      setDiscountPercent(discount)
      setShowOverrideModal(true)
    } catch (err: any) {
      const errorMsg = err.message || "Failed to initiate discount override."
      setError(errorMsg)
      options.onError?.(errorMsg)
    }
  }

  const handleOverrideSuccess = () => {
    setShowOverrideModal(false)
    setSaleId(null)
    setCashierId(null)
    setDiscountPercent(null)
    setError("")
    options.onSuccess?.()
  }

  const handleOverrideClose = () => {
    setShowOverrideModal(false)
    setSaleId(null)
    setCashierId(null)
    setDiscountPercent(null)
  }

  return {
    requestDiscountOverride,
    showOverrideModal,
    saleId,
    cashierId,
    discountPercent,
    handleOverrideClose,
    handleOverrideSuccess,
    error,
  }
}



