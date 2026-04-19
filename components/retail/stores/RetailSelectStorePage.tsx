"use client"

import { useState, useEffect, useMemo } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter, useSearchParams } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { setActiveStoreId } from "@/lib/storeSession"
import { getStores } from "@/lib/stores"
import { isCashierAuthenticated } from "@/lib/cashierSession"
import { retailPaths } from "@/lib/retail/routes"
import { normalizeRetailReturnUrl } from "@/lib/retail/normalizeRetailReturnUrl"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"

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
export default function RetailSelectStorePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [stores, setStores] = useState<Array<{ id: string; name: string; location: string | null }>>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string>("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  const returnUrl = useMemo(
    () => normalizeRetailReturnUrl(searchParams.get("return"), retailPaths.dashboard),
    [searchParams],
  )

  useEffect(() => {
    loadStores()
  }, [])

  const loadStores = async () => {
    try {
      setLoading(true)
      setError("")

      const cashierSession = isCashierAuthenticated()
      if (cashierSession) {
        router.push(retailPaths.pos)
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

      const role = await getUserRole(supabase, user.id, business.id)

      if (role === "cashier") {
        router.push(retailPaths.pos)
        return
      }

      const { autoBindSingleStore } = await import("@/lib/autoBindStore")
      const wasAutoBound = await autoBindSingleStore(supabase, user.id)

      if (wasAutoBound) {
        router.push(returnUrl)
        return
      }

      const allStores = await getStores(supabase, business.id)
      setStores(allStores)

      if (allStores.length === 0) {
        setError("No stores available. Please create a store first.")
        setLoading(false)
        return
      }

      if (allStores.length === 1) {
        setSelectedStoreId(allStores[0].id)
        setActiveStoreId(allStores[0].id, allStores[0].name)
        router.push(returnUrl)
        return
      }

      if (allStores.length > 0) {
        setSelectedStoreId(allStores[0].id)
      }

      setLoading(false)
    } catch (err: unknown) {
      console.error("Error loading stores:", err)
      setError(err instanceof Error ? err.message : "Failed to load stores")
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
      const selectedStore = stores.find((s) => s.id === selectedStoreId)
      if (!selectedStore) {
        setError("Selected store not found")
        setSubmitting(false)
        return
      }

      setActiveStoreId(selectedStoreId, selectedStore.name)

      router.push(returnUrl)
    } catch (err: unknown) {
      console.error("Error selecting store:", err)
      setError(err instanceof Error ? err.message : "Failed to select store")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className={RS.container}>
        <div className={RS.loadingCenter}>
          <div
            className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
            aria-hidden
          />
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Loading stores…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={RS.container}>
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Retail</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Choose your store</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            We remember this for POS, inventory, and reports in this browser until you switch.
          </p>
        </div>

        {error ? <div className={RS.alertError}>{error}</div> : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          <fieldset className={`${RS.formSectionCard} space-y-3`}>
            <legend className="sr-only">Store</legend>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Stores</p>
            <div className="grid gap-2">
              {stores.map((store) => {
                const selected = selectedStoreId === store.id
                return (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setSelectedStoreId(store.id)}
                    className={`flex w-full touch-manipulation flex-col rounded-lg border px-4 py-3.5 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${
                      selected
                        ? "border-blue-600 bg-blue-50/80 dark:border-blue-500 dark:bg-blue-950/35"
                        : "border-gray-200 bg-gray-50/80 hover:border-gray-300 hover:bg-white dark:border-gray-700 dark:bg-gray-900/50 dark:hover:border-gray-600"
                    }`}
                  >
                    <span className="font-semibold text-gray-900 dark:text-white">{store.name}</span>
                    {store.location ? (
                      <span className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{store.location}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={submitting || !selectedStoreId || stores.length === 0}
            className={`${RS.primaryButton} min-h-[48px] w-full touch-manipulation py-3 text-base font-semibold disabled:cursor-not-allowed`}
          >
            {submitting ? "Opening workspace…" : "Continue"}
          </button>

          <p className="text-center text-xs text-gray-500 dark:text-gray-400">
            Applies to this session only. Switch store anytime from Retail navigation.
          </p>
        </form>
      </div>
    </div>
  )
}
