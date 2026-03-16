"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import ProtectedLayout from "@/components/ProtectedLayout"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { setActiveStoreId } from "@/lib/storeSession"
import { getStores } from "@/lib/stores"
import { isCashierAuthenticated } from "@/lib/cashierSession"

/**
 * Store Selection Page
 * 
 * STORE CONTEXT LOGIC:
 * - Cashiers: Store is implicit from cashier session (redirected away)
 * - Managers: Must select a store (may not have store_id assigned)
 * - Admins/Owners: Can select a store or work in global mode (if route allows)
 * 
 * This page ensures Admin/Manager users have a valid store context before accessing
 * store-specific routes like Inventory, Reports, Analytics, POS, etc.
 */
export default function SelectStorePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [stores, setStores] = useState<Array<{ id: string; name: string; location: string | null }>>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState<string>("")

  // Get return URL from query params (where user was trying to go)
  const returnUrl = searchParams.get("return") || "/retail/dashboard"

  useEffect(() => {
    loadStores()
  }, [])

  const loadStores = async () => {
    try {
      setLoading(true)
      setError("")

      // STORE CONTEXT: Cashiers should never reach this page (store implicit from session)
      const cashierSession = isCashierAuthenticated()
      if (cashierSession) {
        router.push("/pos")
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/login")
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)

      // Check user role
      const role = await getUserRole(supabase, user.id, business.id)
      
      // Cashiers should not reach here (redirected above)
      if (role === "cashier") {
        router.push("/pos")
        return
      }

      // STORE CONTEXT AUTO-BIND: Auto-set activeStoreId if exactly one store exists
      // This prevents showing store picker for single-store users
      const { autoBindSingleStore } = await import("@/lib/autoBindStore")
      const wasAutoBound = await autoBindSingleStore(supabase, user.id)
      
      if (wasAutoBound) {
        // Store was auto-bound, redirect to return URL
        router.push(returnUrl)
        return
      }

      // Load all available stores
      const allStores = await getStores(supabase, business.id)
      setStores(allStores)

      if (allStores.length === 0) {
        setError("No stores available. Please create a store first.")
        setLoading(false)
        return
      }

      // STORE CONTEXT: Only show picker if multiple stores exist
      // Single store should have been auto-bound above
      if (allStores.length === 1) {
        // Should not reach here (auto-bound above), but handle gracefully
        setSelectedStoreId(allStores[0].id)
        // Auto-submit to set store and redirect
        setActiveStoreId(allStores[0].id, allStores[0].name)
        router.push(returnUrl)
        return
      }

      // Pre-select first store (multiple stores - user must choose)
      if (allStores.length > 0) {
        setSelectedStoreId(allStores[0].id)
      }

      setLoading(false)
    } catch (err: any) {
      console.error("Error loading stores:", err)
      setError(err.message || "Failed to load stores")
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSubmitting(true)

    if (!selectedStoreId) {
      setError("Please select a store")
      setSubmitting(false)
      return
    }

    try {
      // Find selected store to get name
      const selectedStore = stores.find((s) => s.id === selectedStoreId)
      if (!selectedStore) {
        setError("Selected store not found")
        setSubmitting(false)
        return
      }

      // STORE CONTEXT: Set active store in sessionStorage (persists for session)
      setActiveStoreId(selectedStoreId, selectedStore.name)

      // Redirect to return URL or default dashboard
      router.push(returnUrl)
    } catch (err: any) {
      console.error("Error selecting store:", err)
      setError(err.message || "Failed to select store")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading stores...</p>
          </div>
        </div>
      </ProtectedLayout>
    )
  }

  return (
    <ProtectedLayout>
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Select Store
            </h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Please select a store to continue. Your selection will be remembered for this session.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="store-select"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
              >
                Store *
              </label>
              <select
                id="store-select"
                value={selectedStoreId}
                onChange={(e) => setSelectedStoreId(e.target.value)}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
                disabled={submitting || stores.length === 0}
              >
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name} {store.location ? `(${store.location})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="submit"
                disabled={submitting || !selectedStoreId || stores.length === 0}
                className="flex-1 bg-blue-600 text-white font-semibold py-3 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Selecting..." : "Continue"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </ProtectedLayout>
  )
}

