"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getStores } from "@/lib/stores"
import { getActiveStoreId, setActiveStoreId, getActiveStoreName } from "@/lib/storeSession"
import { getUserRole } from "@/lib/userRoles"
import { getCurrentBusiness } from "@/lib/business"
import { shouldShowStoreSelector, canAccessGlobalMode } from "@/lib/storeContext"
import { useToast } from "@/components/ui/ToastProvider"

type Store = {
  id: string
  name: string
  location: string | null
}

export default function StoreSwitcher() {
  const router = useRouter()
  const pathname = usePathname()
  const toast = useToast()
  const [stores, setStores] = useState<Store[]>([])
  const [activeStoreId, setActiveStoreIdState] = useState<string | null>(null)
  const [activeStoreName, setActiveStoreNameState] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStores()
    loadActiveStore()
    
    // Listen for store changes
    const handleStoreChange = (e: CustomEvent) => {
      setActiveStoreIdState(e.detail.storeId)
      setActiveStoreNameState(e.detail.storeName)
    }
    
    window.addEventListener('storeChanged', handleStoreChange as EventListener)
    
    return () => {
      window.removeEventListener('storeChanged', handleStoreChange as EventListener)
    }
  }, [])

  // Auto-select single store if not already selected (must be before any conditional returns)
  useEffect(() => {
    if (stores.length === 1) {
      const singleStore = stores[0]
      const currentStoreId = getActiveStoreId()
      // Only auto-select if no store is selected or "all" is selected
      if (!currentStoreId || currentStoreId === 'all') {
        setActiveStoreId(singleStore.id, singleStore.name)
        setActiveStoreIdState(singleStore.id)
        setActiveStoreNameState(singleStore.name)
      }
    }
  }, [stores])

  const loadStores = async () => {
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

      const role = await getUserRole(supabase, user.id, business.id)
      setUserRole(role)

      // Only load stores for owner/admin (they can switch stores)
      if (shouldShowStoreSelector(role)) {
        const allStores = await getStores(supabase, business.id)
        setStores(allStores)
        
        // For admin, if no store is selected, allow global mode (null)
        // Don't force them to select a store
        const currentStoreId = getActiveStoreId()
        if (!currentStoreId && canAccessGlobalMode(role)) {
          // Admin can work in global mode - don't auto-select a store
          setActiveStoreIdState(null)
          setActiveStoreNameState(null)
        }
      } else {
        // Store-bound users: get their assigned store
        const { data: userData } = await supabase
          .from("users")
          .select("store_id")
          .eq("id", user.id)
          .maybeSingle()

        if (userData?.store_id) {
          const { data: storeData } = await supabase
            .from("stores")
            .select("id, name, location")
            .eq("id", userData.store_id)
            .maybeSingle()

          if (storeData) {
            setStores([storeData])
            // Auto-set their store as active (they can't change it)
            setActiveStoreId(userData.store_id, storeData.name)
          }
        }
      }
    } catch (err) {
      console.error("Error loading stores:", err)
    } finally {
      setLoading(false)
    }
  }

  const loadActiveStore = () => {
    const storeId = getActiveStoreId()
    const storeName = getActiveStoreName()
    setActiveStoreIdState(storeId)
    setActiveStoreNameState(storeName)
  }

  const handleStoreChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedStoreId = e.target.value
    
    // Block "All Stores" selection on POS routes
    if (selectedStoreId === "all") {
      // If on POS route, prevent switching to "All Stores"
      if (pathname?.startsWith('/pos')) {
        toast.showToast("POS requires a specific store", "warning")
        // Reset to current store
        e.target.value = activeStoreId || "all"
        return
      }
      
      // Only allow "All Stores" for admin/owner
      if (userRole !== "admin" && userRole !== "owner") {
        toast.showToast("Only admins can view all stores", "warning")
        e.target.value = activeStoreId || "all"
        return
      }
      
      // Admin global mode - set to null (no store filter)
      setActiveStoreId(null, null)
      setActiveStoreIdState(null)
      setActiveStoreNameState(null)
      // Navigate to general retail dashboard when "All Stores" is selected
      // Only navigate if we're not already on a store-specific page
      if (!pathname?.includes('/store/')) {
        router.push('/admin/retail/analytics')
      } else {
        // If on a store page, go to analytics (global view)
        router.push('/admin/retail/analytics')
      }
    } else {
      const selectedStore = stores.find((s) => s.id === selectedStoreId)
      if (selectedStore) {
        setActiveStoreId(selectedStoreId, selectedStore.name)
        setActiveStoreIdState(selectedStoreId)
        setActiveStoreNameState(selectedStore.name)
        // Navigate to store-specific dashboard (unless on POS)
        if (!pathname?.startsWith('/pos')) {
          router.push(`/admin/retail/store/${selectedStoreId}`)
        }
      }
    }
  }

  if (loading) {
    return null
  }

  // Don't show switcher if no stores
  if (stores.length === 0) {
    return null
  }

  // For store-bound users, show read-only display (no selector)
  if (!shouldShowStoreSelector(userRole)) {
    if (activeStoreName) {
      return (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-600">Store:</span>
          <span className="font-medium">{activeStoreName}</span>
        </div>
      )
    }
    return null
  }

  // For owner/admin, show dropdown
  // On POS routes, hide "All Stores" option
  const isOnPOSRoute = pathname?.startsWith('/pos')
  
  // If only one store, don't show "All Stores" option
  const hasOnlyOneStore = stores.length === 1
  const shouldShowAllStores = !isOnPOSRoute && !hasOnlyOneStore && stores.length > 1
  
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="store-switcher" className="text-sm text-gray-600 whitespace-nowrap">
        Current Store:
      </label>
      <select
        id="store-switcher"
        value={activeStoreId === null ? "all" : activeStoreId}
        onChange={handleStoreChange}
        className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        {shouldShowAllStores && <option value="all">All Stores</option>}
        {stores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name} {store.location ? `(${store.location})` : ""}
          </option>
        ))}
      </select>
    </div>
  )
}



