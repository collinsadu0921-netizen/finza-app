"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import SupervisorOverrideModal from "./SupervisorOverrideModal"
import { getAuthorityLevel, requiresOverride, REQUIRED_AUTHORITY } from "@/lib/authority"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

interface CloseRegisterModalProps {
  isOpen: boolean
  onClose: () => void
  registerId: string
  sessionId: string
  cashierId: string
  onSuccess?: () => void
}

export default function CloseRegisterModal({
  isOpen,
  onClose,
  registerId,
  sessionId,
  cashierId,
  onSuccess,
}: CloseRegisterModalProps) {
  const { format, currencySymbol } = useBusinessCurrency()
  const [countedCash, setCountedCash] = useState("")
  const [expectedCash, setExpectedCash] = useState(0)
  const [variance, setVariance] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showOverrideModal, setShowOverrideModal] = useState(false)
  const [sessionData, setSessionData] = useState<any>(null)

  useEffect(() => {
    if (isOpen && sessionId) {
      loadSessionData()
    }
  }, [isOpen, sessionId])

  const loadSessionData = async () => {
    try {
      // Get session data
      const { data: session, error: sessionError } = await supabase
        .from("cashier_sessions")
        .select("*")
        .eq("id", sessionId)
        .single()

      if (sessionError) throw sessionError

      setSessionData(session)

      // Load business to get currency
      const {
        data: { user },
      } = await supabase.auth.getUser()

      // Calculate expected cash
      // Expected = opening_float + cash sales - cash drops
      const openingFloat = Number(session.opening_float || 0)

      // Get cash sales and change given for this session
      const { data: allSales, error: salesError } = await supabase
        .from("sales")
        .select("amount, cash_amount, change_given, payment_method")
        .eq("cashier_session_id", sessionId)
        .eq("payment_status", "paid")

      if (salesError) throw salesError

      // LEDGER-BASED: Expected cash = Cash account (1000) ledger balance
      const businessId = session.business_id
      if (!businessId) {
        throw new Error("Business ID not found for session")
      }

      // Get Cash account (account_code '1000')
      const { data: cashAccount } = await supabase
        .from("accounts")
        .select("id")
        .eq("business_id", businessId)
        .eq("code", "1000")
        .is("deleted_at", null)
        .single()

      if (!cashAccount) {
        // Fallback to opening float if cash account not found
        setExpectedCash(openingFloat)
        return
      }

      // Calculate Cash account balance: SUM(debit) - SUM(credit) for asset account
      const { data: cashLines } = await supabase
        .from("journal_entry_lines")
        .select(
          `
          debit,
          credit,
          journal_entries!inner (
            business_id
          )
        `
        )
        .eq("account_id", cashAccount.id)
        .eq("journal_entries.business_id", businessId)

      if (!cashLines) {
        // Fallback to opening float if no ledger entries
        setExpectedCash(openingFloat)
        return
      }

      // For asset accounts: balance = debit - credit
      const cashBalance = cashLines.reduce(
        (sum: number, line: any) => sum + Number(line.debit || 0) - Number(line.credit || 0),
        0
      )

      setExpectedCash(Math.max(0, cashBalance))
    } catch (err: any) {
      setError(err.message || "Failed to load session data")
    }
  }

  const handleCountedCashChange = (value: string) => {
    // Allow empty string for clearing
    if (value === "") {
      setCountedCash("")
      setVariance(0)
      return
    }

    // Only allow positive numbers
    const numValue = parseFloat(value)
    if (isNaN(numValue) || numValue < 0) {
      return // Don't update if invalid
    }

    setCountedCash(value)
    const varianceAmount = numValue - expectedCash
    setVariance(varianceAmount)
    setError("") // Clear error when user types
  }

  const handleCloseRegister = async () => {
    setError("")
    
    // Validate counted cash
    if (!countedCash || countedCash.trim() === "") {
      setError("Please enter the counted cash amount")
      return
    }

    const counted = parseFloat(countedCash)
    if (isNaN(counted) || counted < 0) {
      setError("Counted cash must be a valid positive number")
      return
    }

    setLoading(true)

    try {
      const varianceAmount = counted - expectedCash

      // AUTHORITY-BASED CHECK: Only require override if variance exists AND user lacks authority
      if (Math.abs(varianceAmount) > 0.01) { // Use small threshold for floating point comparison
        // Check if current user has sufficient authority to bypass override
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (user) {
          const business = await getCurrentBusiness(supabase, user.id)
          if (business) {
            const userRole = await getUserRole(supabase, user.id, business.id)
            const userAuthority = getAuthorityLevel(userRole as any)
            
            // ADMIN BYPASS: If user has admin authority (100), they bypass manager-level overrides
            // Only show override if user authority < required authority (50)
            if (requiresOverride(userAuthority, REQUIRED_AUTHORITY.REGISTER_VARIANCE)) {
              // User needs override - show modal
              setShowOverrideModal(true)
              setLoading(false)
              return
            }
            // User has sufficient authority - close directly with variance (no override needed)
            // Note: We still record the variance, but admin can approve it themselves
          }
        }
        
        // If we can't determine authority, require override for safety
        setShowOverrideModal(true)
        setLoading(false)
        return
      }

      // No variance, close directly
      await closeRegisterDirectly(counted)
    } catch (err: any) {
      setError(err.message || "Failed to close register")
      setLoading(false)
    }
  }

  const closeRegisterDirectly = async (counted: number) => {
    try {
      const response = await fetch("/api/register/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          register_id: registerId,
          session_id: sessionId,
          counted_cash: counted,
          expected_cash: expectedCash,
          variance_amount: 0,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to close register")
      }

      onSuccess?.()
      handleClose()
    } catch (err: any) {
      setError(err.message || "Failed to close register")
      setLoading(false)
    }
  }

  const handleOverrideSuccess = () => {
    setShowOverrideModal(false)
    onSuccess?.()
    handleClose()
  }

  const handleClose = () => {
    setCountedCash("")
    setVariance(0)
    setError("")
    setShowOverrideModal(false)
    onClose()
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
        <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
          <h2 className="text-xl font-bold mb-4">Close Register</h2>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Expected Cash
              </label>
              <div className="border p-3 rounded bg-gray-50">
                <span className="text-lg font-semibold">
                  {format(expectedCash)}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Opening float + Cash sales - Cash drops
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                Counted Cash *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={countedCash}
                onChange={(e) => handleCountedCashChange(e.target.value)}
                className="border p-3 rounded w-full"
                placeholder="0.00"
                disabled={loading}
                autoFocus
              />
            </div>

            {countedCash && (
              <div>
                <label className="block text-sm font-medium mb-2">
                  Variance ({currencySymbol ?? ""})
                </label>
                <div
                  className={`border p-3 rounded ${
                    variance !== 0
                      ? "bg-red-50 border-red-300 text-red-700"
                      : "bg-green-50 border-green-300 text-green-700"
                  }`}
                >
                  <span className="text-lg font-semibold">
                    {variance > 0 ? "+" : ""}
                    {format(variance)}
                  </span>
                </div>
                {variance !== 0 && (
                  <p className="text-xs text-red-600 mt-1">
                    Variance detected. Supervisor approval required.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <button
                onClick={handleClose}
                className="bg-gray-300 text-gray-800 px-4 py-2 rounded flex-1"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleCloseRegister}
                className="bg-blue-600 text-white px-4 py-2 rounded flex-1 disabled:bg-gray-400 disabled:cursor-not-allowed"
                disabled={loading || !countedCash || parseFloat(countedCash) < 0}
              >
                {loading ? "Processing..." : "Confirm Close"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showOverrideModal && (
        <SupervisorOverrideModal
          isOpen={showOverrideModal}
          onClose={() => setShowOverrideModal(false)}
          registerId={registerId}
          sessionId={sessionId}
          cashierId={cashierId}
          varianceAmount={variance}
          countedCash={parseFloat(countedCash) || 0}
          expectedCash={expectedCash}
          onSuccess={handleOverrideSuccess}
        />
      )}
    </>
  )
}


