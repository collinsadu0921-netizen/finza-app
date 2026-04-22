"use client"

import { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { calculateTaxes, getLegacyTaxAmounts } from "@/lib/taxEngine"
import { getTaxEngineCode, taxResultToJSONB } from "@/lib/taxEngine/helpers"
import { normalizeCountry, UNSUPPORTED_COUNTRY_MARKER } from "@/lib/payments/eligibility"
import { getUserStore, getStoreFilter, getStores } from "@/lib/stores"
import { getActiveStoreId, getActiveStoreName, setActiveStoreId } from "@/lib/storeSession"
import { getUserRole } from "@/lib/userRoles"
import { getEffectiveStoreIdClient } from "@/lib/storeContext"
import { getCashierSession, clearCashierSession } from "@/lib/cashierSession"
import { getOpenRegisterSession, getAllOpenRegisterSessions, getCurrentUserOpenSession, type OpenRegisterSession } from "@/lib/registerStatus"
import PaymentModal, { PaymentLine, PaymentResult } from "@/components/PaymentModal"
import type { RetailMomoCartSnapshot } from "@/lib/retail/pos/retailMomoCartFingerprint"
import { isRetailMtnSandboxMomoPublicEnvEnabled } from "@/lib/retail/pos/isRetailMtnSandboxMomoPublicEnvEnabled"
import ParkedSalesList from "@/components/ParkedSalesList"
import { getStockStatus } from "@/lib/inventory"
import VariantSelectorModal from "@/components/VariantSelectorModal"
import Toast from "@/components/Toast"
import Modal from "@/components/ui/Modal"
import { useConfirm } from "@/components/ui/ConfirmProvider"
import { printRetailSaleReceiptInBrowser } from "@/app/retail/lib/printRetailSaleReceiptBrowser"
import BarcodeMatchSelector from "@/components/BarcodeMatchSelector"
import LoadingSpinner from "@/components/LoadingSpinner"
import ErrorAlert from "@/components/ErrorAlert"
import { debounce } from "@/lib/debounce"
import StorePickerModal from "@/components/StorePickerModal"
import { formatMoney } from "@/lib/money"
import { calculateDiscounts, type LineDiscount, type CartDiscount } from "@/lib/discounts/calculator"
import { addOfflineTransaction, getPendingCount, initOfflineQueue } from "@/lib/offline/indexedDb"
import { isOnline, setupOfflineSyncListener, syncOfflineTransactions } from "@/lib/offline/sync"
import { NativeSelect } from "@/components/ui/NativeSelect"

type Product = {
  id: string
  name: string
  price: number
  stock?: number
  stock_quantity?: number
  low_stock_threshold?: number
  track_stock?: boolean
  barcode?: string
  category_id?: string
  image_url?: string | null
  hasVariants?: boolean
  tax_category?: string | null
}

type Category = {
  id: string
  name: string
  vat_type?: "standard" | "zero" | "exempt"
}

type CartItem = {
  id: string // Unique ID for this cart line
  product: Product
  quantity: number
  note?: string
  variantId?: string | null
  variantName?: string
  variantPrice?: number
  modifiers?: Array<{ id: string; name: string; price: number }>
  // Discount fields (Phase 1 - Advanced Discounts)
  discount_type?: 'none' | 'percent' | 'amount'
  discount_value?: number
}

export default function POSPage() {
  const router = useRouter()
  const { openConfirm } = useConfirm()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [businessId, setBusinessId] = useState("")
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  /** Per-variant on-hand for current store context (variant_id -> qty). */
  const [variantStockById, setVariantStockById] = useState<Record<string, number>>({})
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [showParkedSales, setShowParkedSales] = useState(false)
  const [parkingSale, setParkingSale] = useState(false)
  /** `/api/sales/park` requires Supabase user; hide/disable Park when PIN-only (no auth user). */
  const [parkSaleClientAvailable, setParkSaleClientAvailable] = useState(true)
  const [quickKeys, setQuickKeys] = useState<Product[]>([])
  // Retail Mode ALWAYS uses VAT-inclusive pricing
  const [retailVatInclusive, setRetailVatInclusive] = useState(true)
  const [showVariantModal, setShowVariantModal] = useState(false)
  const [selectedProductForVariant, setSelectedProductForVariant] = useState<Product | null>(null)
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null)
  const [currentStoreId, setCurrentStoreId] = useState<string | null>(null)
  const [barcodeMatches, setBarcodeMatches] = useState<Array<{
    id: string
    name: string
    price: number
    type: "product" | "variant"
    variantName?: string
    productId: string
    variantId?: string
  }> | null>(null)
  const [scannedBarcode, setScannedBarcode] = useState("")
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [loadingCart, setLoadingCart] = useState(false)
  const [showStorePicker, setShowStorePicker] = useState(false)
  const [availableStores, setAvailableStores] = useState<Array<{ id: string; name: string; location: string | null }>>([])
  const [hasValidStore, setHasValidStore] = useState(false)
  const [currentStoreName, setCurrentStoreName] = useState<string | null>(null)
  const [currencyCode, setCurrencyCode] = useState<string | null>(null)
  const [registerSession, setRegisterSession] = useState<OpenRegisterSession | null>(null)
  const [allOpenSessions, setAllOpenSessions] = useState<OpenRegisterSession[]>([])
  const [showRegisterPicker, setShowRegisterPicker] = useState(false)
  const [registerStatusLoading, setRegisterStatusLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<{ 
    id: string
    name: string
    phone?: string
    email?: string
    status?: string
    notes?: string
    is_frequent?: boolean
    is_vip?: boolean
    is_credit_risk?: boolean
    requires_special_handling?: boolean
    default_discount_percent?: number | null
  } | null>(null)
  const [customerHistory, setCustomerHistory] = useState<Array<{
    sale_id: string
    sale_date: string
    sale_amount: number
    sale_description: string | null
    item_count: number
    payment_method: string
  }>>([])
  const [customerStats, setCustomerStats] = useState<{
    total_sales_count: number
    total_spend: number
    average_basket_size: number
    last_purchase_date: string | null
  } | null>(null)
  const [loadingCustomerHistory, setLoadingCustomerHistory] = useState(false)
  const [showCustomerInfo, setShowCustomerInfo] = useState(false)
  const [showCustomerSelector, setShowCustomerSelector] = useState(false)
  const [customerSearchQuery, setCustomerSearchQuery] = useState("")
  const [customerSearchResults, setCustomerSearchResults] = useState<Array<{ 
    id: string
    name: string
    phone?: string
    email?: string
    status?: string
    notes?: string
    is_frequent?: boolean
    is_vip?: boolean
    is_credit_risk?: boolean
    requires_special_handling?: boolean
    default_discount_percent?: number | null
  }>>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)
  const [newCustomerName, setNewCustomerName] = useState("")
  const [newCustomerPhone, setNewCustomerPhone] = useState("")
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  // Discount state (Phase 1 - Advanced Discounts)
  const [cartDiscountType, setCartDiscountType] = useState<'none' | 'percent' | 'amount'>('none')
  const [cartDiscountValue, setCartDiscountValue] = useState<number>(0)
  const [showCartDiscount, setShowCartDiscount] = useState(false)
  /** Expanded NHIL/GETFund/VAT breakdown in cart (default collapsed for checkout speed) */
  const [showCartTaxDetails, setShowCartTaxDetails] = useState(false)
  // Offline mode state (Phase 4 - Offline POS Mode)
  const [isOffline, setIsOffline] = useState(false)
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0)
  const [syncingOffline, setSyncingOffline] = useState(false)
  /** After online sale success: summary for modal (cart cleared; stay on POS) */
  const [saleSuccess, setSaleSuccess] = useState<{
    saleId: string
    receiptNumber: string
    total: number
    paymentMethodLabel: string
    customerName: string | null
  } | null>(null)
  const [printingReceipt, setPrintingReceipt] = useState(false)
  const [cashierDisplayName, setCashierDisplayName] = useState<string | null>(null)
  const [hasCashierPinSession, setHasCashierPinSession] = useState(false)
  const productSearchInputRef = useRef<HTMLInputElement>(null)

  // Store selected register session ID in sessionStorage
  const getSelectedRegisterSessionId = (): string | null => {
    if (typeof window === 'undefined') return null
    return sessionStorage.getItem('finza_selected_register_session_id')
  }
  
  const setSelectedRegisterSessionId = (sessionId: string | null): void => {
    if (typeof window === 'undefined') return
    if (sessionId) {
      sessionStorage.setItem('finza_selected_register_session_id', sessionId)
    } else {
      sessionStorage.removeItem('finza_selected_register_session_id')
    }
  }

  const focusPosProductSearchInput = useCallback(() => {
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        productSearchInputRef.current?.focus({ preventScroll: true })
      }, 10)
    })
  }, [])

  const posCatalogEligibleForScanFocus = useCallback(() => {
    if (loading || loadingProducts || registerStatusLoading || !businessId || !registerSession) return false
    if (
      showPaymentModal ||
      saleSuccess ||
      showParkedSales ||
      showVariantModal ||
      barcodeMatches !== null ||
      showStorePicker ||
      showRegisterPicker ||
      showCustomerSelector ||
      showCreateCustomer ||
      showCartDiscount
    ) {
      return false
    }
    return true
  }, [
    loading,
    loadingProducts,
    registerStatusLoading,
    businessId,
    registerSession,
    showPaymentModal,
    saleSuccess,
    showParkedSales,
    showVariantModal,
    barcodeMatches,
    showStorePicker,
    showRegisterPicker,
    showCustomerSelector,
    showCreateCustomer,
    showCartDiscount,
  ])

  useLayoutEffect(() => {
    if (posCatalogEligibleForScanFocus()) {
      focusPosProductSearchInput()
    }
  }, [posCatalogEligibleForScanFocus, focusPosProductSearchInput])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    ;(async () => {
      const cashierSession = getCashierSession()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      const id = cashierSession?.cashierId ?? user?.id
      if (!id) return
      const { data } = await supabase
        .from("users")
        .select("full_name, email")
        .eq("id", id)
        .maybeSingle()
      if (cancelled) return
      const label =
        data?.full_name?.trim() ||
        (data?.email ? data.email.split("@")[0] : null) ||
        (cashierSession ? "Cashier" : "Staff")
      setCashierDisplayName(label)
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  useEffect(() => {
    const readPinSession = () => setHasCashierPinSession(!!getCashierSession())
    readPinSession()
    window.addEventListener("cashierSessionChanged", readPinSession)
    return () => window.removeEventListener("cashierSessionChanged", readPinSession)
  }, [])

  const handleEndCashierPinSession = () => {
    clearCashierSession()
    router.replace("/retail/pos/pin")
  }

  useEffect(() => {
    loadData()
    
    // Setup store change listener
    const handleStoreChange = async (e: Event) => {
      const customEvent = e as CustomEvent
      const newStoreId = customEvent.detail?.storeId
      const newStoreName = customEvent.detail?.storeName
      
      // POS Access Guard: Block if store becomes invalid
      if (!newStoreId || newStoreId === 'all') {
        setCurrentStoreId(null)
        setCurrentStoreName(null)
        setHasValidStore(false)
        setShowStorePicker(true)
        return
      }
      
      setCurrentStoreId(newStoreId)
      setCurrentStoreName(newStoreName)
      setHasValidStore(true)
      if (businessId) {
        // Check register status when store changes
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await checkRegisterStatus(businessId, newStoreId, user.id)
        } else {
          const cashierSession = getCashierSession()
          if (cashierSession) {
            await checkRegisterStatus(businessId, newStoreId, cashierSession.cashierId)
          }
        }
        loadProductsForStore(businessId, newStoreId)
      }
    }
    
    window.addEventListener('storeChanged', handleStoreChange)
    
    return () => {
      window.removeEventListener('storeChanged', handleStoreChange)
    }
  }, [businessId])

  // Phase 4: Initialize offline queue and monitor online/offline status
  useEffect(() => {
    const initOffline = async () => {
      try {
        await initOfflineQueue()
        updatePendingCount()
      } catch (error) {
        console.error("Failed to initialize offline queue:", error)
      }
    }

    initOffline()

    // Monitor online/offline status
    const handleOnline = () => {
      setIsOffline(false)
      updatePendingCount()
      // Auto-sync when coming back online
      if (pendingOfflineCount > 0) {
        handleSyncOffline()
      }
    }

    const handleOffline = () => {
      setIsOffline(true)
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Check initial status
    setIsOffline(!isOnline())

    // Setup auto-sync listener
    const cleanup = setupOfflineSyncListener(
      (result) => {
        setToast({
          message: `Synced ${result.synced_count} offline transaction(s)`,
          type: "success",
        })
        updatePendingCount()
        setSyncingOffline(false)
      },
      (error) => {
        setToast({
          message: `Sync failed: ${error.message}`,
          type: "error",
        })
        setSyncingOffline(false)
      }
    )

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      cleanup()
    }
  }, [pendingOfflineCount])

  // Update pending offline transaction count
  const updatePendingCount = async () => {
    try {
      const count = await getPendingCount()
      setPendingOfflineCount(count)
    } catch (error) {
      console.error("Failed to get pending count:", error)
    }
  }

  // Manual sync trigger
  const handleSyncOffline = async () => {
    if (syncingOffline || pendingOfflineCount === 0) return

    setSyncingOffline(true)
    try {
      const result = await syncOfflineTransactions()
      setToast({
        message: `Synced ${result.synced_count} transaction(s). ${result.failed_count > 0 ? `${result.failed_count} failed.` : ""}`,
        type: result.failed_count > 0 ? "error" : "success",
      })
      updatePendingCount()
    } catch (error: any) {
      setToast({
        message: `Sync failed: ${error.message}`,
        type: "error",
      })
    } finally {
      setSyncingOffline(false)
    }
  }

  // Debounced search handler
  const debouncedSearch = useMemo(
    () =>
      debounce((query: string) => {
        // Search is handled by filteredProducts, no need for separate API call
      }, 300),
    []
  )

  // Customer search handler
  const searchCustomers = async (query: string) => {
    if (!businessId || query.trim().length < 1) {
      setCustomerSearchResults([])
      return
    }

    setLoadingCustomers(true)
    try {
      const response = await fetch(`/api/customers?search=${encodeURIComponent(query)}&limit=10`)
      if (response.ok) {
        const data = await response.json()
        setCustomerSearchResults(data.customers || [])
      } else {
        setCustomerSearchResults([])
      }
    } catch (error) {
      console.error("Error searching customers:", error)
      setCustomerSearchResults([])
    } finally {
      setLoadingCustomers(false)
    }
  }

  // Load full customer details (Phase 2 - Customer Enhancements)
  const loadCustomerDetails = async (customerId: string) => {
    try {
      const response = await fetch(`/api/customers/${customerId}`)
      if (response.ok) {
        const data = await response.json()
        return data.customer
      }
      return null
    } catch (error) {
      console.error("Error loading customer details:", error)
      return null
    }
  }

  // Load customer sale history (Phase 2 - Customer Enhancements)
  const loadCustomerHistory = async (customerId: string) => {
    if (!customerId || !businessId) return

    setLoadingCustomerHistory(true)
    try {
      const response = await fetch(`/api/customers/${customerId}/history?limit=10`)
      if (response.ok) {
        const data = await response.json()
        setCustomerHistory(data.saleHistory || [])
        setCustomerStats(data.stats || null)
      }
    } catch (error) {
      console.error("Error loading customer history:", error)
    } finally {
      setLoadingCustomerHistory(false)
    }
  }

  // Auto-apply default customer discount (Phase 2 - Customer Enhancements)
  const applyDefaultCustomerDiscount = async (
    customer: { default_discount_percent?: number | null },
    userRole: string | null
  ) => {
    if (!customer.default_discount_percent || customer.default_discount_percent <= 0) {
      return // No default discount
    }

    if (!businessId) {
      return // Business not loaded
    }

    try {
      // Fetch business discount caps and role limits
      const { data: businessData } = await supabase
        .from("businesses")
        .select("max_discount_percent, max_discount_per_sale_percent, discount_role_limits")
        .eq("id", businessId)
        .maybeSingle()

      const defaultDiscount = customer.default_discount_percent

      // Check role-based limit
      const roleLimits = businessData?.discount_role_limits as Record<string, { max_percent?: number | null }> | null | undefined
      const roleLimit = roleLimits?.[userRole || '']?.max_percent

      if (roleLimit !== null && roleLimit !== undefined && defaultDiscount > roleLimit) {
        setToast({
          message: `Customer default discount (${defaultDiscount}%) exceeds your role limit (${roleLimit}%). Discount not applied.`,
          type: "error",
        })
        return
      }

      // Check per-sale cap
      const saleCap = businessData?.max_discount_per_sale_percent ?? businessData?.max_discount_percent ?? null
      if (saleCap !== null && saleCap !== undefined && defaultDiscount > saleCap) {
        setToast({
          message: `Customer default discount (${defaultDiscount}%) exceeds business maximum (${saleCap}%). Discount not applied.`,
          type: "error",
        })
        return
      }

      // Check global cap
      const globalCap = businessData?.max_discount_percent ?? null
      if (globalCap !== null && globalCap !== undefined && defaultDiscount > globalCap) {
        setToast({
          message: `Customer default discount (${defaultDiscount}%) exceeds global maximum (${globalCap}%). Discount not applied.`,
          type: "error",
        })
        return
      }

      // Apply as cart discount (percentage)
      setCartDiscountType('percent')
      setCartDiscountValue(defaultDiscount)
      setShowCartDiscount(true)

      setToast({
        message: `Applied customer default discount: ${defaultDiscount}%`,
        type: "info",
      })
    } catch (error) {
      console.error("Error applying default customer discount:", error)
      // Don't block sale if discount application fails
    }
  }

  // Debounced customer search
  const debouncedCustomerSearch = useMemo(
    () => debounce((query: string) => {
      searchCustomers(query)
    }, 300),
    [businessId]
  )

  // Create new customer
  const createCustomer = async () => {
    if (!newCustomerName.trim()) {
      setError("Customer name is required")
      return
    }

    if (!businessId) {
      setError("Business not found")
      return
    }

    setCreatingCustomer(true)
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || null,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        const newCustomer = data.customer
        setSelectedCustomer(newCustomer)
        // Load customer history (will be empty for new customer)
        loadCustomerHistory(newCustomer.id)
        // Auto-apply default discount if present (unlikely for new customer)
        await applyDefaultCustomerDiscount(newCustomer, userRole)
        setShowCreateCustomer(false)
        setShowCustomerSelector(false)
        setNewCustomerName("")
        setNewCustomerPhone("")
        setToast({ message: "Customer created", type: "success" })
      } else {
        const errorData = await response.json()
        setError(errorData.error || "Failed to create customer")
      }
    } catch (error: any) {
      setError(error.message || "Failed to create customer")
    } finally {
      setCreatingCustomer(false)
    }
  }

  const loadData = async () => {
    try {
      setLoading(true)
      
      // Check for cashier PIN authentication first
      const cashierSession = getCashierSession()
      
      // Check for Supabase auth session (admin/manager)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      // If no cashier session and no Supabase auth, redirect to PIN login
      if (!cashierSession && !user) {
        router.push("/retail/pos/pin")
        return
      }

      // If cashier session exists, use it
      if (cashierSession) {
        setParkSaleClientAvailable(!!user)
        // Verify business exists
        const { data: business } = await supabase
          .from("businesses")
          .select("id, industry, address_country, default_currency")
          .eq("id", cashierSession.businessId)
          .maybeSingle()

        if (!business) {
          router.push("/retail/pos/pin")
          return
        }

        setBusinessId(business.id)
        setBusinessCountry(business.address_country || null)
        setCurrencyCode(business.default_currency || null)
        
        // Set store context from cashier session
        const { data: storeData } = await supabase
          .from("stores")
          .select("name")
          .eq("id", cashierSession.storeId)
          .maybeSingle()

        if (storeData) {
          setActiveStoreId(cashierSession.storeId, storeData.name)
        } else {
          setActiveStoreId(cashierSession.storeId, null)
        }

        setCurrentStoreId(cashierSession.storeId)
        setCurrentStoreName(storeData?.name || null)
        setHasValidStore(true)

        // Retail Mode ALWAYS uses VAT-inclusive pricing
        setRetailVatInclusive(true)

        // Check register status for cashier
        setUserRole("cashier")
        await checkRegisterStatus(business.id, cashierSession.storeId, cashierSession.cashierId)

        // Load products for cashier's store
        await loadProductsForStore(business.id, cashierSession.storeId)
        setLoading(false)
        return
      }

      // Continue with regular auth flow for admin/manager
      if (!user) {
        setLoading(false)
        return
      }

      setParkSaleClientAvailable(true)

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      
      // Get business country and currency
      const { data: businessDetails } = await supabase
        .from("businesses")
        .select("address_country, default_currency")
        .eq("id", business.id)
        .single()
      setBusinessCountry(businessDetails?.address_country || null)
      
      // Get currency from business (no fallback - null if not set)
      const businessCurrency = businessDetails?.default_currency || null
      setCurrencyCode(businessCurrency)
      
      // Get role and effective store_id (role-based store context)
      const role = await getUserRole(supabase, user.id, business.id)
      const activeStoreId = getActiveStoreId()
      
      // Get user's assigned store_id from database
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()
      
      // Load all available stores for the picker
      const allStores = await getStores(supabase, business.id)
      setAvailableStores(allStores)
      
      // Get effective store_id based on role
      // Admin: can use selected store or null (but POS requires a store)
      // Manager/Cashier: locked to assigned store
      const effectiveStoreId = getEffectiveStoreIdClient(
        role,
        activeStoreId && activeStoreId !== 'all' ? activeStoreId : null,
        userData?.store_id || null
      )
      
      // POS Access Guard: Check if store is valid (not null, not "all", not undefined)
      const isValidStore = effectiveStoreId && effectiveStoreId !== 'all' && effectiveStoreId !== null
      
      if (!isValidStore) {
        // Check if user has exactly one store - auto-select it
        if (allStores.length === 1) {
          const singleStore = allStores[0]
          setActiveStoreId(singleStore.id, singleStore.name)
          setCurrentStoreId(singleStore.id)
          setCurrentStoreName(singleStore.name)
          setHasValidStore(true)
          
          // Retail Mode ALWAYS uses VAT-inclusive pricing
          setRetailVatInclusive(true)
          
          // Check register status
          setUserRole(role)
          await checkRegisterStatus(business.id, singleStore.id, user.id)
          
          // Load products for the auto-selected store
          await loadProductsForStore(business.id, singleStore.id)
          setLoading(false)
          return
        }
        
        // For admin/owner/manager: Show store picker if stores exist
        // Managers may not have store_id assigned but can select a store to work with
        if ((role === "owner" || role === "admin" || role === "manager") && allStores.length > 0) {
          setShowStorePicker(true)
          setLoading(false)
          return
        }
        
        // No stores available - cannot use POS
        if (allStores.length === 0) {
          setError("No stores available. Please create a store before using POS.")
          setLoading(false)
          return
        }
        
        // Fallback: Store users without store_id and no stores available
        setError("You must select a store to use POS. Please contact your administrator if no stores are available.")
        setLoading(false)
        return
      }
      
      // Valid store found - proceed with POS
      setCurrentStoreId(effectiveStoreId)
      setHasValidStore(true)
      
      // Get store name for header
      let storeName = getActiveStoreName()
      if (!storeName || (role === "owner" || role === "admin") && activeStoreId !== effectiveStoreId) {
        // Fetch store name if not in session or if store changed
        const { data: storeData } = await supabase
          .from("stores")
          .select("name")
          .eq("id", effectiveStoreId)
          .maybeSingle()
        
        if (storeData) {
          storeName = storeData.name
          // Update session with store name
          if (role === "owner" || role === "admin") {
            setActiveStoreId(effectiveStoreId, storeData.name)
          }
        }
      }
      
      if (storeName) {
        setCurrentStoreName(storeName)
      }
      
      // Retail Mode ALWAYS uses VAT-inclusive pricing
      // Product prices already include all taxes (NHIL, GETFund, VAT)
      setRetailVatInclusive(true)

      // Check register status
      setUserRole(role)
      await checkRegisterStatus(business.id, effectiveStoreId, user.id)

      // Load products with stock from products_stock table for the effective store
      // CRITICAL: Use effectiveStoreId to ensure correct store stock is loaded
      await loadProductsForStore(business.id, effectiveStoreId)

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }
  
  const handleStoreSelected = async (storeId: string) => {
    setCurrentStoreId(storeId)
    setHasValidStore(true)
    setShowStorePicker(false)
    
    // Get store name for header
    const storeName = getActiveStoreName()
    if (storeName) {
      setCurrentStoreName(storeName)
    } else {
      // Fetch store name if not in session
      const { data: storeData } = await supabase
        .from("stores")
        .select("name")
        .eq("id", storeId)
        .maybeSingle()
      
      if (storeData) {
        setCurrentStoreName(storeData.name)
      }
    }
    
    // Check register status and load products for the selected store
    if (businessId) {
      // Get current user for register status check
      const {
        data: { user },
      } = await supabase.auth.getUser()
      
      if (user) {
        await checkRegisterStatus(businessId, storeId, user.id)
      }
      
      await loadProductsForStore(businessId, storeId)
    }
  }

  // Check register status for store
  const checkRegisterStatus = async (businessId: string, storeId: string | null, userId: string) => {
    if (!storeId) {
      setRegisterSession(null)
      setAllOpenSessions([])
      setRegisterStatusLoading(false)
      return
    }

    try {
      setRegisterStatusLoading(true)
      
      // Get ALL open register sessions for this store (supports multiple registers)
      const sessions = await getAllOpenRegisterSessions(supabase, businessId, storeId)
      setAllOpenSessions(sessions)
      
      if (sessions.length === 0) {
        // No open sessions
        setRegisterSession(null)
        setSelectedRegisterSessionId(null)
      } else if (sessions.length === 1) {
        // Only one session - auto-select it
        setRegisterSession(sessions[0])
        setSelectedRegisterSessionId(sessions[0].id)
        setShowRegisterPicker(false)
      } else {
        // Multiple sessions - check if one is already selected
        const selectedSessionId = getSelectedRegisterSessionId()
        const selectedSession = sessions.find(s => s.id === selectedSessionId)
        
        if (selectedSession) {
          // Use previously selected session
          setRegisterSession(selectedSession)
          setShowRegisterPicker(false)
        } else {
          // No selection yet - show picker or auto-select first
          // For cashiers: auto-select first (they can't choose)
          // For admin/manager: show picker
          if (userRole === "cashier") {
            setRegisterSession(sessions[0])
            setSelectedRegisterSessionId(sessions[0].id)
            setShowRegisterPicker(false)
          } else {
            // Admin/Manager: show picker to select register
            setShowRegisterPicker(true)
            // Auto-select first as default
            setRegisterSession(sessions[0])
            setSelectedRegisterSessionId(sessions[0].id)
          }
        }
      }
    } catch (err: any) {
      console.error("Error checking register status:", err)
      setRegisterSession(null)
      setAllOpenSessions([])
    } finally {
      setRegisterStatusLoading(false)
    }
  }

  // Monitor register status periodically (check every 30 seconds)
  useEffect(() => {
    if (!businessId || !currentStoreId || !userRole) return

    const interval = setInterval(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await checkRegisterStatus(businessId, currentStoreId, user.id)
      } else {
        const cashierSession = getCashierSession()
        if (cashierSession) {
          await checkRegisterStatus(businessId, currentStoreId, cashierSession.cashierId)
        }
      }
    }, 30000) // Check every 30 seconds

    return () => clearInterval(interval)
  }, [businessId, currentStoreId, userRole])

  // Load products for a specific store (or all stores)
  const loadProductsForStore = async (businessId: string, storeId: string | null) => {
    try {
      setLoadingProducts(true)
      
      // Load all products for this business (include tax_category for sale-time tax wiring)
      let allProducts: any[] | null = null
      let productsError: any = null
      const prodsRes = await supabase
        .from("products")
        .select("id, name, price, stock_quantity, stock, low_stock_threshold, track_stock, barcode, category_id, image_url, tax_category")
        .eq("business_id", businessId)
        .order("name", { ascending: true })
      allProducts = prodsRes.data ?? null
      productsError = prodsRes.error
      if (productsError && (String(productsError.message || "").includes("tax_category") || String(productsError.message || "").includes("schema cache"))) {
        const fallback = await supabase
          .from("products")
          .select("id, name, price, stock_quantity, stock, low_stock_threshold, track_stock, barcode, category_id, image_url")
          .eq("business_id", businessId)
          .order("name", { ascending: true })
        allProducts = fallback.data ?? null
        productsError = fallback.error
      }
      if (productsError) {
        console.error("Error loading products:", productsError)
        setProducts([])
        setLoadingProducts(false)
        return
      }

      if (!allProducts || allProducts.length === 0) {
        setProducts([])
        setLoadingProducts(false)
        return
      }

      // Load stock from products_stock table
      let stockQuery = supabase
        .from("products_stock")
        .select("product_id, variant_id, stock, stock_quantity")
        .in("product_id", allProducts.map((p: any) => p.id))
        .is("variant_id", null) // Only base products, not variants

      // Filter by store_id if a specific store is selected
      if (storeId && storeId !== 'all') {
        stockQuery = stockQuery.eq("store_id", storeId)
      }
      // If storeId is "all" or null, load all stock records (will aggregate)

      const { data: stockData, error: stockError } = await stockQuery

      if (stockError) {
        console.error("Error loading stock:", stockError)
      }

      // Create stock map: product_id -> total stock
      const stockMap: Record<string, number> = {}
      
      if (stockData) {
        stockData.forEach((s: any) => {
          const stockQty = Math.floor(
            s.stock_quantity !== null && s.stock_quantity !== undefined
              ? Number(s.stock_quantity)
              : s.stock !== null && s.stock !== undefined
              ? Number(s.stock)
              : 0
          )
          
          if (storeId === 'all') {
            // Aggregate stock across all stores
            stockMap[s.product_id] = (stockMap[s.product_id] || 0) + stockQty
          } else {
            // Single store - use the stock value (will overwrite if multiple records exist)
            stockMap[s.product_id] = stockQty
          }
        })
      }

      // Check which products have variants
      const productsWithVariants = new Set<string>()
      if (allProducts && allProducts.length > 0) {
        try {
          const { data: variantsData } = await supabase
            .from("products_variants")
            .select("product_id")
            .in("product_id", allProducts.map((p: any) => p.id))

          if (variantsData) {
            variantsData.forEach((v: any) => {
              productsWithVariants.add(v.product_id)
            })
          }
        } catch (err: any) {
          // If table doesn't exist or permission denied, continue without variants check
          if (
            err?.code !== "42P01" &&
            err?.code !== "42501" &&
            !err?.message?.includes("does not exist") &&
            !err?.message?.includes("schema cache")
          ) {
            console.error("Error checking variants:", err)
          }
        }
      }

      const variantStockMap: Record<string, number> = {}
      const parentIdsWithVariants = [...productsWithVariants]
      if (parentIdsWithVariants.length > 0) {
        try {
          const { data: variantRows } = await supabase
            .from("products_variants")
            .select("id")
            .in("product_id", parentIdsWithVariants)
          const variantIds = (variantRows || []).map((r: { id: string }) => r.id)
          if (variantIds.length > 0) {
            let vq = supabase
              .from("products_stock")
              .select("variant_id, stock, stock_quantity")
              .in("variant_id", variantIds)
            if (storeId && storeId !== "all") {
              vq = vq.eq("store_id", storeId)
            }
            const { data: vStockRows } = await vq
            if (vStockRows) {
              for (const row of vStockRows as Array<{
                variant_id: string | null
                stock?: number | null
                stock_quantity?: number | null
              }>) {
                const vid = row.variant_id
                if (!vid) continue
                const sq = Math.floor(
                  row.stock_quantity != null && row.stock_quantity !== undefined
                    ? Number(row.stock_quantity)
                    : row.stock != null && row.stock !== undefined
                      ? Number(row.stock)
                      : 0
                )
                variantStockMap[vid] = (variantStockMap[vid] || 0) + sq
              }
            }
          }
        } catch (err: unknown) {
          console.error("Error loading variant stock map:", err)
        }
      }
      setVariantStockById(variantStockMap)

      // Filter products: show products with stock > 0 OR if no stock records exist yet (initial state)
      // If active_store_id = "all", show products with any stock across stores
      // If active_store_id is a specific store, only show products with stock > 0 for that store
      // IMPORTANT: If products_stock table is empty (new setup), show all products to allow stock initialization
      // IMPORTANT: Products with variants should always show (even if parent stock is 0) because variants have their own stock
      const hasAnyStockRecords = stockData && stockData.length > 0
      
      const productsWithStock = allProducts
        .map((p: any) => {
          const stockQty = stockMap[p.id] !== undefined ? stockMap[p.id] : 0
          const hasVariants = productsWithVariants.has(p.id)
          
          return {
            ...p,
            price: Number(p.price || 0),
            stock: stockQty,
            stock_quantity: stockQty,
            low_stock_threshold: p.low_stock_threshold ? Number(p.low_stock_threshold) : 5,
            track_stock: p.track_stock !== undefined ? p.track_stock : true,
            barcode: p.barcode || undefined,
            category_id: p.category_id || undefined,
            image_url: p.image_url || undefined,
            hasVariants: hasVariants,
            tax_category: p.tax_category ?? undefined,
          } as Product
        })
        .filter((p: Product) => {
          // If track_stock is false, always show (service items, etc.)
          if (p.track_stock === false) {
            return true
          }
          
          // If no stock records exist yet (new setup), show all products
          // This allows users to add stock for the first time
          if (!hasAnyStockRecords) {
            return true
          }
          
          // Products with variants should always show (variants have their own stock)
          if (productsWithVariants.has(p.id)) {
            return true
          }
          
          // Otherwise, only show products with stock > 0
          return (p.stock || 0) > 0
        })

      setProducts(productsWithStock)
      
      // Load categories (optional - not required for checkout)
      try {
        const { data: categoriesData, error: categoriesError } = await supabase
        .from("categories")
        .select("id, name, vat_type")
        .eq("business_id", businessId)

        if (categoriesError) {
          // Log error but don't block - categories are optional
          console.warn("Categories not loaded (non-blocking):", categoriesError.message)
          setCategories([])
        } else {
          setCategories(categoriesData || [])
        }
      } catch (err: any) {
        // Categories loading failed - non-blocking, continue with empty array
        console.warn("Error loading categories (non-blocking):", err?.message || err)
        setCategories([])
      }

      // Load quick keys after products are loaded
      await loadQuickKeys(businessId, productsWithStock)
      
      setLoadingProducts(false)
    } catch (err: any) {
      console.error("Error loading products for store:", err)
      setError(err.message || "Failed to load products")
      setLoadingProducts(false)
    }
  }

  // Load quick keys from table or auto-populate top 6 most-sold products
  const loadQuickKeys = async (businessId: string, allProducts: Product[]) => {
    try {
      // First, try to load from quick_keys table
      const { data: quickKeysData, error: quickKeysError } = await supabase
        .from("quick_keys")
        .select("product_id, display_name, order_index, products(*)")
        .eq("business_id", businessId)
        .order("order_index", { ascending: true })
        .limit(6)

      if (!quickKeysError && quickKeysData && quickKeysData.length > 0) {
        // Use quick keys from table
        const keys = quickKeysData
          .map((qk: any) => {
            const product = qk.products
            if (!product || !product.id) return null
            const price = Number(product.price || 0)
            if (isNaN(price) || price <= 0) return null
            // Ensure stock values are properly converted to integers
            const stockQty = Math.floor(
              product.stock_quantity !== null && product.stock_quantity !== undefined
                ? Number(product.stock_quantity)
                : product.stock !== null && product.stock !== undefined
                ? Number(product.stock)
                : 0
            )
            return {
              ...product,
              price: price,
              stock: stockQty,
              stock_quantity: stockQty,
              barcode: product.barcode || undefined,
              category_id: product.category_id || undefined,
            } as Product
          })
          .filter((p: Product | null): p is Product => p !== null && Number(p.price || 0) > 0)
        setQuickKeys(keys)
        return
      }

      // If no quick keys in table, auto-populate top 6 most-sold products
      // First get sales for this business
      const { data: salesData } = await supabase
        .from("sales")
        .select("id")
        .eq("business_id", businessId)
        .limit(100) // Get recent sales

      if (salesData && salesData.length > 0) {
        const saleIds = salesData.map((s: any) => s.id)
        
        // Get sale_items for these sales and aggregate by product
        // Batch the query if there are too many sale IDs (Supabase has URL length limits)
        let saleItemsData: any[] = []
        const BATCH_SIZE = 100
        
        for (let i = 0; i < saleIds.length; i += BATCH_SIZE) {
          const batch = saleIds.slice(i, i + BATCH_SIZE)
          const { data: batchItems, error: itemsError } = await supabase
            .from("sale_items")
            .select("product_id, qty") // Use 'qty' not 'quantity' - that's the actual column name
            .in("sale_id", batch)
          
          if (itemsError) {
            console.error(`Error loading sale items batch ${i / BATCH_SIZE + 1}:`, itemsError)
            // Continue with other batches even if one fails
          } else if (batchItems) {
            saleItemsData = saleItemsData.concat(batchItems)
          }
        }

        if (saleItemsData && saleItemsData.length > 0) {
          // Aggregate by product_id to get total quantities
          const productTotals: Record<string, number> = {}
          saleItemsData.forEach((item: any) => {
            if (item.product_id) {
              // Use 'qty' not 'quantity' - that's the actual column name
              productTotals[item.product_id] = (productTotals[item.product_id] || 0) + Number(item.qty || 1)
            }
          })

          // Sort by total quantity and get top 6 product IDs
          const topProductIds = Object.entries(productTotals)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 6)
            .map(([productId]) => productId)

          if (topProductIds.length > 0) {
            const topProducts = allProducts.filter((p) => topProductIds.includes(p.id))
            // Maintain order from topProductIds
            const orderedProducts = topProductIds
              .map((id) => topProducts.find((p) => p.id === id))
              .filter((p): p is Product => p !== undefined)
            setQuickKeys(orderedProducts)
            return
          }
        }
      }

      // Fallback: use first 6 products
      setQuickKeys(allProducts.slice(0, 6))
    } catch (err) {
      // On error, use first 6 products as fallback
      setQuickKeys(allProducts.slice(0, 6))
    }
  }

  // Check if product has variants or modifiers
  const checkProductVariants = async (productId: string): Promise<boolean> => {
    try {
      const [variantsResult, modifiersResult] = await Promise.all([
        supabase
          .from("products_variants")
          .select("id")
          .eq("product_id", productId)
          .limit(1),
        supabase
          .from("product_modifiers")
          .select("id")
          .eq("product_id", productId)
          .limit(1),
      ])

      // Handle 404 errors gracefully (table might not exist)
      const hasVariants = !variantsResult.error || variantsResult.error.code !== "PGRST116" 
        ? (variantsResult.data && variantsResult.data.length > 0) 
        : false
      
      const hasModifiers = !modifiersResult.error || modifiersResult.error.code !== "PGRST116"
        ? (modifiersResult.data && modifiersResult.data.length > 0)
        : false

      return Boolean(hasVariants || hasModifiers)
    } catch {
      return false
    }
  }

  // Add item to cart - increments quantity if already in cart, otherwise adds new line
  const addToCart = async (product: Product) => {
    if (!product || !product.id) return

    // STORE CONTEXT VALIDATION: Ensure valid store before adding to cart
    if (!currentStoreId || currentStoreId === 'all' || !hasValidStore) {
      setError("Cannot add items: No store selected. Please select a store first.")
      setShowStorePicker(true)
      return
    }

    // Check if register is open
    if (!registerSession) {
      setError("Register is closed. Open register to start selling.")
      return
    }

    // Validate price
    const price = Number(product.price || 0)
    if (isNaN(price) || price <= 0) {
      setError(`Product "${product.name || 'Unknown'}" has invalid price`)
      return
    }

    // Check if product has variants or modifiers
    const hasVariantsOrModifiers = await checkProductVariants(product.id)

    if (hasVariantsOrModifiers) {
      // Show variant selector modal
      setSelectedProductForVariant(product)
      setShowVariantModal(true)
      return
    }

    // No variants/modifiers - add directly to cart
    addProductToCart(product, null, product.name, price, [])
  }

  // Internal function to actually add product to cart
  const addProductToCart = (
    product: Product,
    variantId: string | null,
    displayName: string,
    finalPrice: number,
    modifiers: Array<{ id: string; name: string; price: number }>
  ) => {
    const variantKey = variantId ?? null
    const modsKey = JSON.stringify(modifiers)

    setCart((prev) => {
      const existingItem = prev.find(
        (item) =>
          item.product.id === product.id &&
          (item.variantId ?? null) === variantKey &&
          JSON.stringify(item.modifiers || []) === modsKey
      )

      if (existingItem) {
        return prev.map((item) =>
          item.id === existingItem.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      }

      const lineStockQty = variantKey
        ? Math.floor(variantStockById[variantKey] ?? 0)
        : Math.floor(
            product.stock_quantity != null && product.stock_quantity !== undefined
              ? Number(product.stock_quantity)
              : product.stock != null && product.stock !== undefined
                ? Number(product.stock)
                : 0
          )
      const thresh =
        product.low_stock_threshold != null && product.low_stock_threshold !== undefined
          ? Number(product.low_stock_threshold)
          : 5

      const newCartItem: CartItem = {
        id: `${product.id}-${variantKey || "base"}-${Date.now()}-${Math.random()}`,
        product: {
          id: product.id,
          name: displayName,
          price: finalPrice,
          stock: lineStockQty,
          stock_quantity: lineStockQty,
          low_stock_threshold: thresh,
          track_stock: product.track_stock !== undefined ? product.track_stock : true,
          barcode: product.barcode,
          category_id: product.category_id,
          tax_category: product.tax_category ?? undefined,
        },
        quantity: 1,
        note: undefined,
        variantId: variantKey,
        variantName: variantKey ? displayName : undefined,
        variantPrice: variantKey ? finalPrice : undefined,
        modifiers: modifiers.length > 0 ? modifiers : undefined,
      }
      return [...prev, newCartItem]
    })

    if (posCatalogEligibleForScanFocus()) {
      focusPosProductSearchInput()
    }
  }

  // Handle variant selection from modal
  const handleVariantSelected = (
    variantId: string | null,
    variantName: string,
    variantPrice: number,
    modifiers: Array<{ id: string; name: string; price: number }>
  ) => {
    if (!selectedProductForVariant) return

    addProductToCart(selectedProductForVariant, variantId, variantName, variantPrice, modifiers)
    setShowVariantModal(false)
    setSelectedProductForVariant(null)
    setSearchQuery("")
  }

  // Handle barcode / variant SKU scan (Enter on main POS field)
  const handleBarcodeScan = async (codeRaw: string) => {
    const code = codeRaw.trim()
    if (!code) return

    try {
      /**
       * Exact code resolution order for checkout (USB / Bluetooth scanners behave like keyboard + Enter):
       * 1) Variant barcode — `products_variants.barcode`
       * 2) Base product barcode — `products.barcode` (only products without variants; avoids parent/child ambiguity)
       * 3) Variant SKU — `products_variants.sku` (rows not already matched in step 1)
       *
       * Multiple rows across these steps → cashier picks in `BarcodeMatchSelector`.
       */
      const filterVariantsToBusiness = async (
        rows: Array<{
          id: string
          product_id: string
          variant_name: string
          price: number | null
          stock_quantity: number | null
          stock: number | null
          barcode: string | null
          sku: string | null
        }> | null
      ) => {
        if (!rows?.length) return []
        const productIds = [...new Set(rows.map((v) => v.product_id))]
        const { data: variantProducts } = await supabase
          .from("products")
          .select("id")
          .eq("business_id", businessId)
          .in("id", productIds)
        const valid = new Set((variantProducts ?? []).map((p) => p.id))
        return rows.filter((v) => valid.has(v.product_id))
      }

      const { data: variantsByBarcodeRaw, error: variantBarcodeErr } = await supabase
        .from("products_variants")
        .select("id, product_id, variant_name, price, stock_quantity, stock, barcode, sku")
        .eq("barcode", code)

      if (variantBarcodeErr) console.error("Error searching variants by barcode:", variantBarcodeErr)

      const variantsByBarcode = await filterVariantsToBusiness(variantsByBarcodeRaw ?? null)
      const matchedVariantIds = new Set(variantsByBarcode.map((v) => v.id))

      const { data: productMatches, error: productError } = await supabase
        .from("products")
        .select("id, name, price, stock_quantity, stock")
        .eq("business_id", businessId)
        .eq("barcode", code)

      if (productError) console.error("Error searching products:", productError)

      const { data: variantsBySkuRaw, error: variantSkuErr } = await supabase
        .from("products_variants")
        .select("id, product_id, variant_name, price, stock_quantity, stock, barcode, sku")
        .eq("sku", code)

      if (variantSkuErr) console.error("Error searching variants by SKU:", variantSkuErr)

      const variantsBySkuAll = await filterVariantsToBusiness(variantsBySkuRaw ?? null)
      const variantsBySku = variantsBySkuAll.filter((v) => !matchedVariantIds.has(v.id))

      const allMatches: Array<{
        id: string
        name: string
        price: number
        type: "product" | "variant"
        variantName?: string
        productId: string
        variantId?: string
      }> = []

      for (const variant of variantsByBarcode) {
        const product = products.find((p) => p.id === variant.product_id)
        if (product) {
          const variantPrice = variant.price !== null ? variant.price : product.price
          allMatches.push({
            id: variant.id,
            name: product.name,
            price: variantPrice,
            type: "variant",
            variantName: variant.variant_name,
            productId: product.id,
            variantId: variant.id,
          })
        }
      }

      if (productMatches && productMatches.length > 0) {
        for (const product of productMatches) {
          const hasVariants = await checkProductVariants(product.id)
          if (!hasVariants) {
            allMatches.push({
              id: product.id,
              name: product.name,
              price: product.price,
              type: "product",
              productId: product.id,
            })
          }
        }
      }

      for (const variant of variantsBySku) {
        const product = products.find((p) => p.id === variant.product_id)
        if (product) {
          const variantPrice = variant.price !== null ? variant.price : product.price
          allMatches.push({
            id: variant.id,
            name: product.name,
            price: variantPrice,
            type: "variant",
            variantName: variant.variant_name,
            productId: product.id,
            variantId: variant.id,
          })
        }
      }

      if (allMatches.length === 0) {
        setToast({
          message: `No matching product, variant barcode, or variant SKU for "${code}"`,
          type: "error",
        })
        return
      }

      if (allMatches.length === 1) {
        const match = allMatches[0]
        await addBarcodeMatchToCart(match)
        setSearchQuery("")
      } else {
        setBarcodeMatches(allMatches)
        setScannedBarcode(code)
      }
    } catch (err: any) {
      console.error("Error handling barcode scan:", err)
      setToast({ message: `Error scanning barcode: ${err.message}`, type: "error" })
    }
  }

  // Add a barcode match to cart
  const addBarcodeMatchToCart = async (match: {
    id: string
    name: string
    price: number
    type: "product" | "variant"
    variantName?: string
    productId: string
    variantId?: string
  }) => {
    // Check if register is open
    if (!registerSession) {
      setError("Register is closed. Open register to start selling.")
      return
    }

    try {
      // Find the product in our products list
      const product = products.find((p) => p.id === match.productId)
      if (!product) {
        setToast({ message: "Product not found in current list", type: "error" })
        return
      }

      if (match.type === "variant") {
        // It's a variant - check if it has modifiers
        const hasModifiers = await checkProductVariants(match.productId)
        if (hasModifiers) {
          // Show variant selector modal (which will handle modifiers too)
          setSelectedProductForVariant(product)
          setShowVariantModal(true)
          setSearchQuery("")
        } else {
          // No modifiers, add variant directly
          addProductToCart(product, match.variantId || null, match.variantName || match.name, match.price, [])
          setSearchQuery("")
          setToast({ message: `Added ${match.name} to cart`, type: "success" })
        }
      } else {
        // It's a product - check if it has variants/modifiers
        const hasVariantsOrModifiers = await checkProductVariants(match.productId)
        if (hasVariantsOrModifiers) {
          // Show variant selector modal
          setSelectedProductForVariant(product)
          setShowVariantModal(true)
          setSearchQuery("")
        } else {
          // No variants/modifiers, add directly
          addProductToCart(product, null, match.name, match.price, [])
          setSearchQuery("")
          setToast({ message: `Added ${match.name} to cart`, type: "success" })
        }
      }
    } catch (err: any) {
      console.error("Error adding barcode match to cart:", err)
      setToast({ message: `Error adding item to cart: ${err.message}`, type: "error" })
    }
  }

  // Handle barcode match selection
  const handleBarcodeMatchSelect = async (match: {
    id: string
    name: string
    price: number
    type: "product" | "variant"
    variantName?: string
    productId: string
    variantId?: string
  }) => {
    setBarcodeMatches(null)
    setScannedBarcode("")
    await addBarcodeMatchToCart(match)
    setSearchQuery("")
  }

  // Update quantity for a specific cart item
  const updateQuantity = (itemId: string, newQuantity: number) => {
    const quantity = Math.max(1, Math.floor(newQuantity)) // Ensure minimum 1 and integer

    setCart((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, quantity } : item
      )
    )
  }

  // Remove item from cart
  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== itemId))
  }

  // Update note for a cart item
  const updateNote = (itemId: string, note: string) => {
    setCart((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, note: note || undefined } : item
      )
    )
  }

  // Update discount for a cart item
  const updateItemDiscount = (itemId: string, discountType: 'none' | 'percent' | 'amount', discountValue: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              discount_type: discountType,
              discount_value: discountType !== 'none' ? discountValue : undefined,
            }
          : item
      )
    )
  }

  // Calculate cart totals using existing VAT logic
  const cartTotals = useMemo(() => {
    if (!cart || cart.length === 0) {
      return {
        subtotal: 0,
        tax: 0,
        total: 0,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
      }
    }

    try {
      // Filter out invalid items
      const validCartItems = cart.filter(
        (item) =>
          item &&
          item.product &&
          !isNaN(Number(item.product.price || 0)) &&
          Number(item.product.price || 0) > 0 &&
          item.quantity > 0
      )

      if (validCartItems.length === 0) {
        return {
          subtotal: 0,
          tax: 0,
          total: 0,
          nhil: 0,
          getfund: 0,
          covid: 0,
          vat: 0,
        }
      }

      // ============================================================================
      // DISCOUNT CALCULATION (Phase 1 - Ledger-Safe Pricing)
      // ============================================================================
      // Calculate discounts BEFORE tax calculation
      // ============================================================================
      
      // Prepare line items for discount calculation
      const lineItemsForDiscount = validCartItems.map((item) => {
        const modifierTotal = item.modifiers
          ? item.modifiers.reduce((sum, m) => sum + m.price, 0)
          : 0
        const finalPrice = (item.variantPrice ?? item.product.price ?? 0) + modifierTotal
        
        return {
          quantity: Math.max(1, Math.floor(item.quantity || 1)),
          unit_price: finalPrice,
          discount: item.discount_type && item.discount_type !== 'none'
            ? {
                discount_type: item.discount_type,
                discount_value: Number(item.discount_value || 0),
              }
            : undefined,
        }
      })

      // Prepare cart discount
      const cartDiscount: CartDiscount | undefined = cartDiscountType && cartDiscountType !== 'none'
        ? {
            discount_type: cartDiscountType,
            discount_value: cartDiscountValue,
          }
        : undefined

      // Calculate discounts
      const discountResult = calculateDiscounts(lineItemsForDiscount, cartDiscount)

      // Retail Mode: VAT-inclusive pricing
      // Subtotal before discount (for display)
      const subtotalBeforeDiscount = discountResult.subtotal_before_discount
      // Subtotal after discounts (net base for tax calculation)
      const subtotalAfterDiscount = discountResult.subtotal_after_discount

      // Filter to only taxable items (tax_category = taxable).
      // Default NULL tax_category to 'taxable' for backward compatibility (existing products).
      // Exclude exempt and zero_rated.
      const taxableCartItems = validCartItems.filter((item) => {
        const taxCategory = (item.product.tax_category || "taxable").toLowerCase()
        return taxCategory === "taxable"
      })

      let nhil = 0,
        getfund = 0,
        covid = 0,
        vat = 0
      if (taxableCartItems.length > 0 && businessCountry) {
        // Calculate tax on NET amounts after discounts
        // Map taxable items with their net prices after discounts
        const lineItems = taxableCartItems.map((item) => {
          const modifierTotal = item.modifiers
            ? item.modifiers.reduce((sum, m) => sum + m.price, 0)
            : 0
          const finalPrice = (item.variantPrice ?? item.product.price ?? 0) + modifierTotal
          
          // Find corresponding discount result
          const originalIndex = validCartItems.findIndex((ci) => ci.id === item.id)
          const lineDiscountResult = originalIndex >= 0 ? discountResult.lineItems[originalIndex] : null
          
          // Net price per unit after line discount
          const grossLine = finalPrice * (item.quantity || 1)
          const netLine = lineDiscountResult?.net_line || grossLine
          const netUnitPrice = (item.quantity || 1) > 0 ? netLine / (item.quantity || 1) : finalPrice
          
          return {
            quantity: Math.max(1, Math.floor(item.quantity || 1)),
            unit_price: netUnitPrice, // Use net price after line discount
            discount_amount: 0, // Discounts already applied to unit_price
          }
        })
        
        // Apply cart discount proportionally to taxable items for tax calculation
        // The tax engine needs the final net unit prices after all discounts
        if (cartDiscount && discountResult.cart_discount_amount > 0 && discountResult.subtotal_after_line_discounts > 0) {
          const cartDiscountProportion = discountResult.cart_discount_amount / discountResult.subtotal_after_line_discounts
          
          // Adjust each line item's unit price by its share of cart discount
          lineItems.forEach((lineItem) => {
            const originalNetLine = lineItem.unit_price * lineItem.quantity
            const cartDiscountAllocation = originalNetLine * cartDiscountProportion
            const finalNetLine = originalNetLine - cartDiscountAllocation
            lineItem.unit_price = lineItem.quantity > 0 ? finalNetLine / lineItem.quantity : lineItem.unit_price
          })
        }
        try {
          const effectiveDate = new Date().toISOString()
          const taxCalculationResult = calculateTaxes(
            lineItems,
            businessCountry,
            effectiveDate,
            true
          )
          const legacyTaxAmounts = getLegacyTaxAmounts(taxCalculationResult)
          nhil = legacyTaxAmounts.nhil
          getfund = legacyTaxAmounts.getfund
          covid = 0 // RETAIL: COVID Levy removed
          vat = legacyTaxAmounts.vat
        } catch {
          // Missing/unsupported country; leave tax at zero
        }
      }

      // Total is subtotal after discounts (VAT-inclusive, so no tax addition)
      const total = subtotalAfterDiscount

      return {
        subtotal: isNaN(subtotalAfterDiscount) ? 0 : subtotalAfterDiscount,
        subtotal_before_discount: isNaN(subtotalBeforeDiscount) ? 0 : subtotalBeforeDiscount,
        total_discount: isNaN(discountResult.total_discount) ? 0 : discountResult.total_discount,
        tax: 0,
        total: isNaN(total) ? 0 : total,
        nhil: isNaN(nhil) ? 0 : nhil,
        getfund: isNaN(getfund) ? 0 : getfund,
        covid: isNaN(covid) ? 0 : covid,
        vat: isNaN(vat) ? 0 : vat,
      }
    } catch (err) {
      console.error("Error calculating cart totals:", err)
      return {
        subtotal: 0,
        tax: 0,
        total: 0,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
      }
    }
  }, [cart, businessCountry, cartDiscountType, cartDiscountValue])

  const cartItemUnits = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 0), 0),
    [cart]
  )

  const retailMomoCartSnapshot = useMemo((): RetailMomoCartSnapshot => {
    const items = cart.map((item) => {
      const modifierTotal = item.modifiers
        ? item.modifiers.reduce((sum, m) => sum + m.price, 0)
        : 0
      const unit = (item.variantPrice ?? item.product.price ?? 0) + modifierTotal
      return {
        product_id: item.product.id,
        variant_id: item.variantId || null,
        quantity: item.quantity,
        unit_price: unit,
        discount_type: item.discount_type || "none",
        discount_value: item.discount_value || 0,
      }
    })
    return {
      items,
      cart_discount_type: cartDiscountType !== "none" ? cartDiscountType : undefined,
      cart_discount_value: cartDiscountType !== "none" ? cartDiscountValue : undefined,
    }
  }, [cart, cartDiscountType, cartDiscountValue])

  const retailMomoRegisterContext = useMemo(() => {
    const store = getActiveStoreId() || currentStoreId
    if (
      !registerSession?.register_id ||
      !registerSession?.id ||
      !store ||
      store === "all"
    ) {
      return null
    }
    return {
      register_id: registerSession.register_id,
      cashier_session_id: registerSession.id,
      store_id: store,
    }
  }, [registerSession, currentStoreId])

  useEffect(() => {
    if (cart.length === 0) setShowCartTaxDetails(false)
  }, [cart.length])

  // Filter products by search query
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products

    const query = searchQuery.toLowerCase()
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.barcode?.toLowerCase().includes(query)
    )
  }, [products, searchQuery])

  const getCartLineStockHint = (
    item: CartItem
  ): { level: "low" | "out"; message: string } | null => {
    if (item.product.track_stock === false) return null
    const fromProduct =
      item.product.stock_quantity != null && item.product.stock_quantity !== undefined
        ? Number(item.product.stock_quantity)
        : item.product.stock != null && item.product.stock !== undefined
          ? Number(item.product.stock)
          : NaN
    let raw: number
    if (item.variantId) {
      raw =
        variantStockById[item.variantId] !== undefined
          ? variantStockById[item.variantId]!
          : fromProduct
    } else {
      raw = fromProduct
    }
    if (Number.isNaN(raw)) return null
    const avail = Math.floor(raw)
    const thresh = item.product.low_stock_threshold ?? 5
    if (item.quantity > avail) {
      return { level: "out", message: `Qty exceeds available stock (${avail})` }
    }
    if (avail === 0) return { level: "out", message: "Out of stock" }
    if (avail <= thresh) return { level: "low", message: `Low stock (${avail} left)` }
    return null
  }

  const requestClearCart = () => {
    if (cart.length === 0) return
    openConfirm({
      title: "Clear cart?",
      description: "Remove all items from this sale. This cannot be undone.",
      confirmLabel: "Clear cart",
      cancelLabel: "Keep items",
      onConfirm: () => {
        setCart([])
        setCartDiscountType("none")
        setCartDiscountValue(0)
        setShowCartDiscount(false)
        setToast({ message: "Cart cleared", type: "info" })
      },
    })
  }

  if (loading) {
    return (
      <>
        <LoadingSpinner fullScreen text="Loading POS..." />
      </>
    )
  }

  // POS Access Guard: Block rendering if no valid store
  // STORE CONTEXT VALIDATION: POS requires a valid store_id before any operations
  // - Cashiers: Always have store from cashier session
  // - Managers/Admins: Must select a store via store picker modal
  if (!hasValidStore || !currentStoreId || currentStoreId === 'all') {
    return (
      <>
        <StorePickerModal
          isOpen={showStorePicker}
          stores={availableStores}
          selectedStoreId={currentStoreId}
          onStoreSelect={handleStoreSelected}
        />
        {!showStorePicker && (
          <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
            <div className="text-center max-w-md px-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 border border-gray-200 dark:border-gray-700">
                <div className="mb-4">
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  Store Selection Required
                </h2>
                <p className="text-gray-600 dark:text-gray-400 mb-4">
                  POS requires a specific store to operate. Please select a store to continue.
                </p>
                {error && (
                  <div className="mt-4">
                    <ErrorAlert message={error} onDismiss={() => setError("")} />
                  </div>
                )}
                {availableStores.length > 0 && (
                  <button
                    onClick={() => setShowStorePicker(true)}
                    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    Select Store
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden lg:flex-row">
        {/* Left Panel - Products */}
        <div className="relative flex min-h-0 w-full flex-1 flex-col border-r lg:w-2/3 lg:flex-[2]">
          <div className="border-b bg-white shrink-0 z-30 shadow-sm">
            <div className="p-4 pb-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">Retail POS</h1>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-800">
                      Store: {currentStoreName || "—"}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-800">
                      Register: {registerSession?.registers?.name || (registerStatusLoading ? "…" : "—")}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-800">
                      Cashier: {cashierDisplayName || "—"}
                    </span>
                    {isOffline ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-900 ring-1 ring-amber-300">
                        Offline
                        {pendingOfflineCount > 0 ? ` · ${pendingOfflineCount} pending` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800 ring-1 ring-emerald-200">
                        Online
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                  {hasCashierPinSession && (
                    <button
                      type="button"
                      onClick={handleEndCashierPinSession}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      title="End PIN cashier session and return to PIN entry"
                    >
                      End session / switch cashier
                    </button>
                  )}
                  {isOffline && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900">
                      <span className="text-xs font-semibold">Sync queue</span>
                      {pendingOfflineCount > 0 && (
                        <span className="text-xs font-bold">({pendingOfflineCount})</span>
                      )}
                    </div>
                  )}
                  {!isOffline && pendingOfflineCount > 0 && (
                    <button
                      type="button"
                      onClick={handleSyncOffline}
                      disabled={syncingOffline}
                      className="flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-blue-900 hover:bg-blue-100 disabled:opacity-50"
                    >
                      {syncingOffline ? "Syncing…" : `Sync ${pendingOfflineCount} pending`}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="sticky top-0 z-20 border-t border-slate-100 bg-white px-4 pb-3 pt-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Main scan / search
              </label>
              <div className="flex gap-2">
                <input
                  ref={productSearchInputRef}
                  data-retail-pos-scan-input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Search products or scan barcode / variant SKU"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    debouncedSearch(e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      const q = searchQuery.trim()
                      if (q.length > 0) void handleBarcodeScan(q)
                    }
                  }}
                  className="min-h-[48px] flex-1 rounded-lg border-2 border-slate-200 px-3 text-base shadow-inner focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Type to filter by product name or product barcode. Press Enter for an exact match on product barcode,
                variant barcode, or variant SKU.
              </p>
            </div>
          </div>

          {/* Quick Keys Panel */}
          {quickKeys.length > 0 && (
            <div className="border-b border-l-4 border-amber-400 bg-gradient-to-r from-amber-50 to-white p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">
                  Quick keys
                </h3>
                <span className="text-xs font-medium text-amber-800/80">Tap to add</span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {quickKeys.map((product) => {
                  const quantity = cart
                    .filter((item) => item.product.id === product.id)
                    .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)

                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => addToCart(product)}
                      className="min-h-[88px] rounded-xl border-2 border-amber-300 bg-white p-3 text-center shadow-sm transition hover:border-amber-500 hover:shadow-md active:scale-[0.98]"
                    >
                      <div className="mb-1 line-clamp-2 text-xs font-semibold leading-tight">
                        {product.name}
                      </div>
                      <div className="text-sm font-bold text-blue-600">
                        {formatMoney(product.price, currencyCode)}
                      </div>
                      {quantity > 0 && (
                        <div className="mt-1 text-xs font-bold tabular-nums text-emerald-700">In cart: {quantity}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Products Grid */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            {error && <ErrorAlert message={error} onDismiss={() => setError("")} />}
            
            {/* Register Picker Modal - When multiple registers are open (cashiers cannot access) */}
            {showRegisterPicker && allOpenSessions.length > 1 && userRole !== "cashier" && (
              <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                    Select Register
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Multiple registers are open. Select which register to use:
                  </p>
                  <div className="space-y-2">
                    {allOpenSessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => {
                          setRegisterSession(session)
                          setSelectedRegisterSessionId(session.id)
                          setShowRegisterPicker(false)
                        }}
                        className={`w-full text-left p-3 rounded-lg border-2 transition ${
                          registerSession?.id === session.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                        }`}
                      >
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {session.registers?.name || 'Register'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Opened {new Date(session.started_at).toLocaleTimeString()}
                        </div>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowRegisterPicker(false)}
                    className="mt-4 w-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Register Status Blocking Overlay */}
            {!registerStatusLoading && !registerSession && allOpenSessions.length === 0 && (
              <div className="absolute inset-0 bg-white/90 dark:bg-gray-900/90 z-50 flex items-center justify-center">
                <div className="bg-white dark:bg-gray-800 border-2 border-red-300 dark:border-red-700 rounded-lg p-8 max-w-md text-center shadow-xl">
                  <svg className="w-16 h-16 text-red-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Register is Closed</h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-2">
                    A manager or admin must open the register for this store before sales can continue on this terminal.
                  </p>
                  {(userRole === "cashier" || hasCashierPinSession) && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      Ask a manager or admin to sign in and use Open register from the POS cart strip or the register session page.
                    </p>
                  )}
                  {(userRole === "admin" || userRole === "manager" || userRole === "owner") && (
                    <button
                      onClick={() => router.push("/sales/open-session")}
                      className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 font-semibold"
                    >
                      Open Register
                    </button>
                  )}
                </div>
              </div>
            )}

            {loadingProducts ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner size="md" text="Loading products..." />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {searchQuery ? "No products found matching your search." : "No products available."}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className="bg-white border rounded-lg p-2 hover:bg-blue-50 hover:border-blue-300 transition text-left flex flex-col"
                  >
                    {/* Product Image - Always shows placeholder, image loads on top */}
                    <div className="w-full aspect-square mb-2 bg-gray-100 rounded overflow-hidden flex items-center justify-center relative pointer-events-none">
                      {/* Default placeholder - always visible as fallback */}
                      <div className="absolute inset-0 w-full h-full flex items-center justify-center text-gray-400">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      {/* Product image - loads on top, hides on error */}
                      {product.image_url && (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          loading="lazy"
                          className="w-full h-full object-cover relative z-10"
                          onError={(e) => {
                            // Hide broken image, placeholder remains visible
                            const target = e.target as HTMLImageElement
                            target.style.display = 'none'
                          }}
                          onLoad={(e) => {
                            // Image loaded successfully - it will cover the placeholder
                            // No action needed, image is already visible
                          }}
                        />
                      )}
                    </div>
                    
                    {/* Product Info */}
                    <div className="flex-1 flex flex-col">
                      <div className="flex items-start justify-between mb-1 gap-1">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm line-clamp-2">{product.name}</div>
                          {product.barcode && (
                            <div className="text-xs text-gray-500 mt-0.5">
                              Barcode: {product.barcode}
                            </div>
                          )}
                        </div>
                        {(() => {
                          // Show variant badge if product has variants
                          if (product.hasVariants) {
                            return (
                              <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200 flex-shrink-0" title="This product has variants">
                                Variants
                              </span>
                            )
                          }
                          
                          // Otherwise show stock badges for non-variant products
                          const stockQty = Math.floor(
                            product.stock_quantity !== null && product.stock_quantity !== undefined
                              ? Number(product.stock_quantity)
                              : product.stock !== null && product.stock !== undefined
                              ? Number(product.stock)
                              : 0
                          )
                          const stockStatus = getStockStatus(stockQty, product.low_stock_threshold, product.track_stock)
                          if (stockStatus.status === "low_stock" || stockStatus.status === "out_of_stock") {
                            return (
                              <span className={`px-1.5 py-0.5 rounded text-xs font-bold text-white ml-1 flex-shrink-0 ${stockStatus.badgeColor}`}>
                                {stockStatus.label}
                              </span>
                            )
                          }
                          return null
                        })()}
                      </div>
                      <div className="text-lg font-bold text-blue-600">
                        {formatMoney(product.price, currencyCode)}
                      </div>
                      {(() => {
                        // If product has variants, show "Stock managed per variant" instead of numeric stock
                        if (product.hasVariants) {
                          return (
                            <div className="text-xs text-gray-500 mt-1">
                              Stock managed per variant
                            </div>
                          )
                        }
                        
                        // Otherwise, show stock if available
                        if (product.stock !== undefined) {
                          return (
                            <div className="text-xs text-gray-500 mt-1">
                              Stock: {product.stock}
                            </div>
                          )
                        }
                        return null
                      })()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel — retail checkout terminal: header / scroll lines / totals / sticky payment */}
        <div className="relative flex h-full min-h-0 w-full flex-1 flex-col border-t border-slate-200 bg-white lg:w-1/3 lg:max-h-none lg:flex-none lg:border-l lg:border-t-0">
          {/* 1. Header */}
          <div className="shrink-0 border-b border-slate-100 px-3 py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-base font-bold leading-tight text-slate-900">Cart</h2>
              <span className="text-right text-[11px] font-medium tabular-nums text-slate-500">
                {cart.length} line{cart.length !== 1 ? "s" : ""}
                {cart.length > 0 ? ` · ${cartItemUnits} item${cartItemUnits !== 1 ? "s" : ""}` : ""}
              </span>
            </div>

            {!registerStatusLoading && !registerSession && (
              <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-red-700">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-semibold">Register closed</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">Manager or admin must open a register for this store.</span>
                  {(userRole === "admin" || userRole === "manager" || userRole === "owner") && (
                    <button
                      type="button"
                      onClick={() => router.push("/sales/open-session")}
                      className="font-medium text-blue-600 underline hover:text-blue-800"
                    >
                      Open register
                    </button>
                  )}
                </div>
                {(userRole === "cashier" || hasCashierPinSession) && (
                  <span className="text-[10px] font-normal text-slate-600">
                    Cashier terminals cannot open registers — ask a manager or admin.
                  </span>
                )}
              </div>
            )}

            {registerSession && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-700">
                <span className="font-semibold text-slate-900">
                  {registerSession.registers?.name || "Register"}
                </span>
                <span className="text-emerald-700">Open</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-500">Ready to sell</span>
                {allOpenSessions.length > 1 && userRole !== "cashier" && (
                  <button
                    type="button"
                    onClick={() => setShowRegisterPicker(true)}
                    className="ml-0.5 text-blue-600 underline hover:text-blue-800"
                    title="Switch register"
                  >
                    Switch
                  </button>
                )}
              </div>
            )}

            {/* Customer summary */}
            <div className="mt-1.5 border-t border-dashed border-slate-200 pt-1.5">
              {selectedCustomer ? (
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="truncate text-xs font-semibold text-slate-900">
                          {selectedCustomer.name}
                        </span>
                        {selectedCustomer.is_vip && (
                          <span className="rounded bg-yellow-100 px-1 py-0 text-[9px] font-bold text-yellow-900">
                            VIP
                          </span>
                        )}
                        {selectedCustomer.is_frequent && (
                          <span className="rounded bg-blue-100 px-1 py-0 text-[9px] font-bold text-blue-900">
                            F
                          </span>
                        )}
                        {selectedCustomer.is_credit_risk && (
                          <span className="rounded bg-red-100 px-1 py-0 text-[9px] font-bold text-red-900">
                            Risk
                          </span>
                        )}
                        {selectedCustomer.requires_special_handling && (
                          <span className="rounded bg-purple-100 px-1 py-0 text-[9px] font-bold text-purple-900">
                            Sp
                          </span>
                        )}
                      </div>
                      {selectedCustomer.phone && (
                        <div className="truncate text-[10px] text-slate-500">{selectedCustomer.phone}</div>
                      )}
                      {selectedCustomer.default_discount_percent &&
                        selectedCustomer.default_discount_percent > 0 && (
                          <div className="text-[10px] font-medium text-emerald-700">
                            Default {selectedCustomer.default_discount_percent}% off
                          </div>
                        )}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      <button
                        type="button"
                        onClick={() => setShowCustomerSelector(true)}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:underline"
                        title="Change customer"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCustomerInfo(!showCustomerInfo)}
                        className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-slate-50"
                        title="Customer details"
                      >
                        Info
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(null)
                          setShowCustomerSelector(false)
                          setCustomerHistory([])
                          setCustomerStats(null)
                          setShowCustomerInfo(false)
                        }}
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-700 hover:bg-red-50"
                        title="Remove customer"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  {showCustomerInfo && (
                    <div className="max-h-28 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 text-[10px] text-slate-700">
                      {selectedCustomer.notes && (
                        <div className="mb-1">
                          <span className="font-semibold">Notes:</span> {selectedCustomer.notes}
                        </div>
                      )}
                      {customerStats && (
                        <div className="grid grid-cols-2 gap-1 border-t border-slate-200 pt-1">
                          <div>Sales: {customerStats.total_sales_count}</div>
                          <div>Spend: {formatMoney(customerStats.total_spend, currencyCode || "GHS")}</div>
                          <div>Avg: {formatMoney(customerStats.average_basket_size, currencyCode || "GHS")}</div>
                          <div>
                            Last:{" "}
                            {customerStats.last_purchase_date
                              ? new Date(customerStats.last_purchase_date).toLocaleDateString()
                              : "—"}
                          </div>
                        </div>
                      )}
                      {loadingCustomerHistory ? (
                        <div className="text-slate-500">Loading history…</div>
                      ) : customerHistory.length > 0 ? (
                        <div className="mt-1 border-t border-slate-200 pt-1">
                          <span className="font-semibold">Recent:</span>
                          <div className="mt-0.5 space-y-0.5">
                            {customerHistory.slice(0, 4).map((sale) => (
                              <div key={sale.sale_id} className="flex justify-between gap-2">
                                <span>{new Date(sale.sale_date).toLocaleDateString()}</span>
                                <span>{formatMoney(sale.sale_amount, currencyCode || "GHS")}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : customerStats && customerStats.total_sales_count === 0 ? (
                        <div className="mt-1 text-slate-500">No purchase history</div>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCustomerSelector(true)}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  + Add customer
                </button>
              )}
            </div>

            {/* Secondary actions */}
            <div className="mt-1.5 grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => setShowCartDiscount(true)}
                disabled={cart.length === 0}
                className="rounded-md border border-slate-200 bg-slate-50 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Discount
              </button>
              <button
                type="button"
                onClick={() => void handleParkSale()}
                disabled={
                  cart.length === 0 ||
                  parkingSale ||
                  processingPayment ||
                  !registerSession ||
                  !parkSaleClientAvailable
                }
                title={
                  !parkSaleClientAvailable
                    ? "Park sale requires a signed-in staff session"
                    : undefined
                }
                className="rounded-md border border-amber-300 bg-amber-50 py-1.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {parkingSale ? "…" : "Park"}
              </button>
              <button
                type="button"
                onClick={requestClearCart}
                disabled={cart.length === 0 || processingPayment}
                className="rounded-md border border-red-200 bg-red-50 py-1.5 text-[11px] font-semibold text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>

            {cart.length > 0 && showCartDiscount && (
              <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                <div className="flex flex-wrap items-center gap-1">
                  <NativeSelect
                    size="sm"
                    wrapperClassName="min-w-0 flex-1"
                    value={cartDiscountType}
                    onChange={(e) => {
                      setCartDiscountType(e.target.value as "none" | "percent" | "amount")
                      if (e.target.value === "none") {
                        setCartDiscountValue(0)
                      }
                    }}
                    className="text-[11px]"
                  >
                    <option value="none">No cart discount</option>
                    <option value="percent">Percent</option>
                    <option value="amount">Fixed amount</option>
                  </NativeSelect>
                  {cartDiscountType !== "none" && (
                    <input
                      type="number"
                      min="0"
                      max={cartDiscountType === "percent" ? 100 : undefined}
                      step={cartDiscountType === "percent" ? 1 : 0.01}
                      value={cartDiscountValue}
                      onChange={(e) => setCartDiscountValue(Number(e.target.value) || 0)}
                      placeholder={cartDiscountType === "percent" ? "%" : "Amt"}
                      className="w-16 rounded border border-slate-200 bg-white py-1 text-[11px]"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowCartDiscount(false)
                      setCartDiscountType("none")
                      setCartDiscountValue(0)
                    }}
                    className="text-[11px] text-red-600 hover:underline"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCartDiscount(false)}
                    className="text-[11px] font-medium text-slate-600 hover:underline"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Customer Selector Modal */}
          {showCustomerSelector && (
            <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl max-h-[80vh] flex flex-col">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                  {showCreateCustomer ? "Create Customer" : "Select Customer"}
                </h3>

                {!showCreateCustomer ? (
                  <>
                    <input
                      type="text"
                      placeholder="Search by name, phone, or email..."
                      value={customerSearchQuery}
                      onChange={(e) => {
                        setCustomerSearchQuery(e.target.value)
                        debouncedCustomerSearch(e.target.value)
                      }}
                      className="w-full border p-2 rounded mb-4 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      autoFocus
                    />

                    {loadingCustomers ? (
                      <div className="text-center py-4 text-gray-500">Searching...</div>
                    ) : customerSearchResults.length > 0 ? (
                      <div className="flex-1 overflow-y-auto space-y-2 mb-4">
                        {customerSearchResults.map((customer) => {
                          // Safely check status (may not exist if migration hasn't run)
                          const isBlocked = customer.status === "blocked"
                          return (
                            <button
                              key={customer.id}
                              onClick={() => {
                                if (isBlocked) {
                                  setError("Cannot select blocked customer. Please unblock the customer first.")
                                  return
                                }
                                setSelectedCustomer(customer)
                                setShowCustomerSelector(false)
                                setCustomerSearchQuery("")
                                setCustomerSearchResults([])
                              }}
                              disabled={isBlocked}
                              className={`w-full text-left p-3 rounded-lg border-2 transition ${
                                isBlocked
                                  ? "border-red-200 bg-red-50 opacity-50 cursor-not-allowed"
                                  : "border-gray-200 hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                              }`}
                            >
                              <div className="font-semibold text-gray-900 dark:text-white flex items-center justify-between">
                                <span>{customer.name}</span>
                                {isBlocked && (
                                  <span className="px-2 py-1 rounded text-xs font-semibold bg-red-100 text-red-800">
                                    Blocked
                                  </span>
                                )}
                              </div>
                              {customer.phone && (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {customer.phone}
                                </div>
                              )}
                              {customer.email && (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {customer.email}
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    ) : customerSearchQuery.trim().length > 0 ? (
                      <div className="text-center py-4 text-gray-500">
                        No customers found
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-500">
                        Start typing to search customers
                      </div>
                    )}

                    <button
                      onClick={() => setShowCreateCustomer(true)}
                      className="w-full bg-green-600 text-white py-2 rounded font-semibold hover:bg-green-700 mb-2"
                    >
                      Create New Customer
                    </button>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Name *
                      </label>
                      <input
                        type="text"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        placeholder="Customer name"
                        className="w-full border p-2 rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Phone
                      </label>
                      <input
                        type="text"
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        placeholder="Phone number (optional)"
                        className="w-full border p-2 rounded dark:bg-gray-700 dark:text-white dark:border-gray-600"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={createCustomer}
                        disabled={creatingCustomer || !newCustomerName.trim()}
                        className="flex-1 bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700 disabled:bg-gray-300"
                      >
                        {creatingCustomer ? "Creating..." : "Create"}
                      </button>
                      <button
                        onClick={() => {
                          setShowCreateCustomer(false)
                          setNewCustomerName("")
                          setNewCustomerPhone("")
                        }}
                        className="flex-1 bg-gray-200 text-gray-800 py-2 rounded font-semibold hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => {
                    setShowCustomerSelector(false)
                    setShowCreateCustomer(false)
                    setCustomerSearchQuery("")
                    setCustomerSearchResults([])
                    setNewCustomerName("")
                    setNewCustomerPhone("")
                  }}
                  className="mt-4 w-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* 2. Main scrollable line items */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5">
            {cart.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                <p className="font-medium">No items yet</p>
                <p className="mt-1 text-xs">Add products from the left</p>
              </div>
            ) : (
              <div className="space-y-1">
                {cart.map((item) => (
                  <CartItemRow
                    key={item.id}
                    item={item}
                    stockHint={getCartLineStockHint(item)}
                    onQuantityChange={(newQty) => updateQuantity(item.id, newQty)}
                    onRemove={() => removeFromCart(item.id)}
                    onNoteChange={(note) => updateNote(item.id, note)}
                    onDiscountChange={(type, value) => updateItemDiscount(item.id, type, value)}
                    currencyCode={currencyCode}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 3–4. Compact totals + sticky checkout footer */}
          <div className="sticky bottom-0 z-20 shrink-0 border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.1)]">
            {cart.length > 0 && (
              <div className="space-y-1 text-[11px] text-slate-700">
                {(cartTotals.total_discount ?? 0) > 0 && (
                  <>
                    <div className="flex justify-between text-slate-600">
                      <span>Before discount</span>
                      <span className="tabular-nums">
                        {formatMoney(cartTotals.subtotal_before_discount || cartTotals.subtotal, currencyCode)}
                      </span>
                    </div>
                    <div className="flex justify-between font-medium text-red-600">
                      <span>Discount</span>
                      <span className="tabular-nums">-{formatMoney(cartTotals.total_discount ?? 0, currencyCode)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-semibold text-slate-900">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatMoney(cartTotals.subtotal, currencyCode)}</span>
                </div>
                {(cartTotals.nhil > 0 ||
                  cartTotals.getfund > 0 ||
                  cartTotals.vat > 0 ||
                  cartTotals.covid > 0) &&
                  (showCartTaxDetails ? (
                    <div className="space-y-0.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[10px] text-slate-700">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1">
                        <span className="font-semibold text-slate-600">Tax detail (estimate)</span>
                        <button
                          type="button"
                          onClick={() => setShowCartTaxDetails(false)}
                          className="shrink-0 font-medium text-blue-700 hover:underline"
                        >
                          Hide
                        </button>
                      </div>
                      {cartTotals.nhil > 0 && (
                        <div className="flex justify-between tabular-nums">
                          <span>NHIL</span>
                          <span>{formatMoney(cartTotals.nhil, currencyCode)}</span>
                        </div>
                      )}
                      {cartTotals.getfund > 0 && (
                        <div className="flex justify-between tabular-nums">
                          <span>GETFund</span>
                          <span>{formatMoney(cartTotals.getfund, currencyCode)}</span>
                        </div>
                      )}
                      {cartTotals.covid > 0 && (
                        <div className="flex justify-between tabular-nums">
                          <span>COVID</span>
                          <span>{formatMoney(cartTotals.covid, currencyCode)}</span>
                        </div>
                      )}
                      {cartTotals.vat > 0 && (
                        <div className="flex justify-between tabular-nums">
                          <span>VAT</span>
                          <span>{formatMoney(cartTotals.vat, currencyCode)}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-600">
                      <span>Tax included in prices</span>
                      <button
                        type="button"
                        onClick={() => setShowCartTaxDetails(true)}
                        className="shrink-0 font-semibold text-blue-700 hover:underline"
                      >
                        View tax details
                      </button>
                    </div>
                  ))}
                <div className="flex justify-between border-t border-slate-200 pt-1.5 text-lg font-bold text-slate-900">
                  <span>Total</span>
                  <span className="tabular-nums text-blue-600">{formatMoney(cartTotals.total, currencyCode)}</span>
                </div>
              </div>
            )}

            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={() => setShowParkedSales(true)}
                disabled={processingPayment}
                className="text-[10px] font-semibold text-emerald-700 underline decoration-emerald-400/70 underline-offset-2 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Resume parked sale
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowPaymentModal(true)}
              disabled={cart.length === 0 || processingPayment || !registerSession || registerStatusLoading}
              className="mt-3 min-h-[52px] w-full rounded-xl bg-blue-600 py-3.5 text-lg font-bold text-white shadow-lg ring-2 ring-blue-500/25 transition hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:opacity-60 disabled:ring-0"
            >
              {processingPayment ? "Processing…" : "Take payment"}
            </button>
          </div>
        </div>

        {/* Payment Modal */}
        <PaymentModal
          isOpen={showPaymentModal}
          onClose={() => setShowPaymentModal(false)}
          totalPayable={cartTotals.total}
          onComplete={handleCompletePayment}
          currencyCode={currencyCode}
          businessCountry={businessCountry}
          selectedCustomer={selectedCustomer}
          isOffline={isOffline}
          emphasizeCashFlow
          retailMtnSandboxMomo={isRetailMtnSandboxMomoPublicEnvEnabled()}
          retailMomoCartSnapshot={retailMomoCartSnapshot}
          retailMomoRegisterContext={retailMomoRegisterContext}
          saleProcessing={processingPayment}
        />

        {/* Sale success — stay on POS */}
        <Modal
          isOpen={!!saleSuccess}
          onClose={() => setSaleSuccess(null)}
          title="Sale completed"
          size="md"
          closeOnOverlayClick={false}
        >
          {saleSuccess && (
            <div className="space-y-4">
              <dl className="space-y-2 text-sm text-gray-700 dark:text-gray-200">
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 dark:text-gray-400">Receipt No.</dt>
                  <dd className="font-mono font-medium">{saleSuccess.receiptNumber}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 dark:text-gray-400">Total</dt>
                  <dd className="font-semibold">
                    {currencyCode
                      ? formatMoney(saleSuccess.total, currencyCode)
                      : saleSuccess.total.toFixed(2)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-gray-500 dark:text-gray-400">Payment</dt>
                  <dd>{saleSuccess.paymentMethodLabel}</dd>
                </div>
                {saleSuccess.customerName ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500 dark:text-gray-400">Customer</dt>
                    <dd className="text-right">{saleSuccess.customerName}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => setSaleSuccess(null)}
                  className="w-full rounded-lg bg-blue-600 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-blue-700 sm:flex-1"
                >
                  New Sale
                </button>
                <button
                  type="button"
                  disabled={printingReceipt}
                  onClick={async () => {
                    setPrintingReceipt(true)
                    try {
                      const r = await printRetailSaleReceiptInBrowser(saleSuccess.saleId)
                      if (!r.ok) {
                        setToast({ message: r.message, type: "error" })
                      }
                    } finally {
                      setPrintingReceipt(false)
                    }
                  }}
                  className="w-full rounded-lg border-2 border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 sm:flex-1"
                >
                  {printingReceipt ? "Printing…" : "Print Receipt"}
                </button>
                <a
                  href={`/retail/pos/receipt/${encodeURIComponent(saleSuccess.saleId)}?from=pos`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full rounded-lg border-2 border-gray-300 bg-white px-4 py-3 text-center text-sm font-medium text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700 sm:flex-1"
                >
                  View Receipt
                </a>
              </div>
            </div>
          )}
        </Modal>

        {/* Parked Sales Modal */}
        {showParkedSales && (
          <ParkedSalesList
            businessId={businessId}
            currencyCode={currencyCode}
            onClose={() => setShowParkedSales(false)}
            onResume={async (parkedSale) => {
              // Categories are optional - can proceed without them (defaults to standard VAT)
              // Reload products to get current category_id
              const cartData = parkedSale.cart_json as CartItem[]
              const productIds = cartData.map((item: CartItem) => item.product.id).filter(Boolean)
              
              if (productIds.length > 0) {
                const { data: currentProducts } = await supabase
                  .from("products")
                  .select("id, category_id, tax_category")
                  .in("id", productIds)

                // Update cart items with current category_id and tax_category (authoritative from DB)
                const updatedCartData = cartData.map((item: CartItem) => {
                  const currentProduct = currentProducts?.find((p: any) => p.id === item.product.id)
                  return {
                    ...item,
                    product: {
                      ...item.product,
                      category_id: currentProduct?.category_id || item.product.category_id,
                      tax_category:
                        currentProduct?.tax_category != null
                          ? currentProduct.tax_category
                          : item.product.tax_category,
                    },
                  }
                })

                // Cart totals will be recalculated by useMemo using shared tax engine
                
                setCart(updatedCartData)
              } else {
                setCart(cartData)
              }
              
              setShowParkedSales(false)
            }}
          />
        )}

        {/* Variant Selector Modal */}
        {showVariantModal && selectedProductForVariant && (
          <VariantSelectorModal
            productId={selectedProductForVariant.id}
            productName={selectedProductForVariant.name}
            productPrice={selectedProductForVariant.price}
            currencyCode={currencyCode}
            onSelect={handleVariantSelected}
            onClose={() => {
              setShowVariantModal(false)
              setSelectedProductForVariant(null)
              setSearchQuery("")
            }}
          />
        )}

        {barcodeMatches && barcodeMatches.length > 0 && (
          <BarcodeMatchSelector
            matches={barcodeMatches}
            barcode={scannedBarcode}
            currencyCode={currencyCode}
            onSelect={(m) => void handleBarcodeMatchSelect(m)}
            onClose={() => {
              setBarcodeMatches(null)
              setScannedBarcode("")
              setSearchQuery("")
            }}
          />
        )}
        
        {/* Store Picker Modal - shown when no valid store */}
        <StorePickerModal
          isOpen={showStorePicker}
          stores={availableStores}
          selectedStoreId={currentStoreId}
          onStoreSelect={handleStoreSelected}
        />
      </div>
    </>
  )

  async function handleParkSale() {
    if (!parkSaleClientAvailable) {
      setToast({
        message: "Park sale needs a staff sign-in. Use a signed-in device or ask a supervisor.",
        type: "info",
      })
      return
    }

    if (!businessId) {
      setError("Business not found")
      return
    }
    
    if (cart.length === 0) {
      setError("Cannot park an empty cart")
      return
    }

    setParkingSale(true)
    setError("")

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("You must be logged in.")
        setParkingSale(false)
        return
      }

      // Get active store - POS requires a specific store
      const activeStoreId = currentStoreId || getActiveStoreId()
      if (!activeStoreId || activeStoreId === 'all') {
        setError("Cannot park sale: Please select a store first.")
        setParkingSale(false)
        return
      }

      const response = await fetch("/api/sales/park", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          cashier_id: user.id,
          store_id: activeStoreId,
          cart_json: cart,
          subtotal: cartTotals.subtotal,
          taxes: cartTotals.tax,
          total: cartTotals.total,
        }),
      })

      // Check if response has content before parsing JSON
      const responseText = await response.text()
      let data: any = {}
      
      if (responseText) {
        try {
          data = JSON.parse(responseText)
        } catch (parseError) {
          console.error("Failed to parse JSON response:", parseError)
          throw new Error(`Invalid response from server: ${responseText.substring(0, 100)}`)
        }
      }

      if (!response.ok) {
        throw new Error(data.error || `Failed to park sale (${response.status})`)
      }

      // Clear cart after parking
      setCart([])
      setError("")
    } catch (err: any) {
      setError(err.message || "Failed to park sale")
    } finally {
      setParkingSale(false)
    }
  }

  async function handleCompletePayment(result: PaymentResult) {
    const {
      payments,
      cash_received,
      change_given,
      is_layaway,
      deposit_amount,
      retail_mtn_sandbox_payment_reference,
    } = result
    // Foreign currency fields removed - FX not fully supported end-to-end
    
    console.log("handleCompletePayment called with:", {
      payments,
      businessId,
      cartLength: cart.length,
      registerSession: registerSession?.id
    })
    
    if (!businessId || cart.length === 0) {
      console.error("Cannot complete payment: missing businessId or empty cart", { businessId, cartLength: cart.length })
      setError("Cannot complete payment: Missing business or cart is empty")
      return
    }

    setProcessingPayment(true)
    setError("")

    try {
      // Check if cashier is logged in via PIN
      const cashierSession = getCashierSession()
      
      // Get user - use cashier ID if cashier session exists, otherwise use Supabase auth user
      let userId: string | null = null
      let user: any = null
      
      if (cashierSession) {
        // Cashier logged in via PIN - use cashier's ID
        userId = cashierSession.cashierId
        // Create a minimal user object for compatibility
        user = { id: cashierSession.cashierId }
      } else {
        // Admin/Manager logged in via Supabase auth
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser()
        
        if (!authUser) {
          setError("You must be logged in.")
          setProcessingPayment(false)
          return
        }
        
        user = authUser
        userId = authUser.id
      }

      // REGISTER-BASED: Use the currently selected register session
      // (Not user-based - supports multiple registers open simultaneously)
      if (!registerSession || !registerSession.register_id) {
        setError("No active register session. Please open a register session first.")
        setProcessingPayment(false)
        return
      }

      // Verify the selected session is still open
      const { data: sessionVerify, error: sessionError } = await supabase
        .from("cashier_sessions")
        .select("id, register_id, status")
        .eq("id", registerSession.id)
        .eq("status", "open")
        .maybeSingle()

      if (sessionError && sessionError.code !== "PGRST116") {
        console.error("Session error:", sessionError)
        setError(`Failed to verify register session: ${sessionError.message}`)
        setProcessingPayment(false)
        return
      }

      if (!sessionVerify) {
        setError("Register session has been closed. Please select an open register.")
        setProcessingPayment(false)
        // Refresh register status
        await checkRegisterStatus(businessId, currentStoreId, user.id)
        return
      }

      // Use the verified session
      const session = {
        id: registerSession.id,
        register_id: registerSession.register_id
      }
      
      const sessionStoreId = getActiveStoreId()

      // ============================================================================
      // DISCOUNT CALCULATION (Phase 1 - Ledger-Safe Pricing)
      // ============================================================================
      // Calculate discounts BEFORE preparing sale items and tax calculation
      // ============================================================================
      
      // Prepare line items for discount calculation
      const lineItemsForDiscount = cart.map((item) => {
        const modifierTotal = item.modifiers
          ? item.modifiers.reduce((sum, m) => sum + m.price, 0)
          : 0
        const finalPrice = (item.variantPrice ?? item.product.price ?? 0) + modifierTotal
        
        return {
          quantity: Math.max(1, Math.floor(item.quantity || 1)),
          unit_price: finalPrice,
          discount: item.discount_type && item.discount_type !== 'none'
            ? {
                discount_type: item.discount_type,
                discount_value: Number(item.discount_value || 0),
              }
            : undefined,
        }
      })

      // Prepare cart discount
      const cartDiscount: CartDiscount | undefined = cartDiscountType && cartDiscountType !== 'none'
        ? {
            discount_type: cartDiscountType,
            discount_value: cartDiscountValue,
          }
        : undefined

      // Calculate discounts
      const discountResult = calculateDiscounts(lineItemsForDiscount, cartDiscount)

      // Prepare cart items for sale (with discount fields)
      const saleItems = cart.map((item, index) => {
        // Calculate final price including modifiers
        const modifierTotal = item.modifiers
          ? item.modifiers.reduce((sum, m) => sum + m.price, 0)
          : 0
        const finalPrice = (item.variantPrice || item.product.price) + modifierTotal

        return {
          product_id: item.product.id,
          product_name: item.variantName || item.product.name,
          quantity: item.quantity,
          unit_price: finalPrice,
          note: item.note,
          variant_id: item.variantId || null,
          // Discount fields (Phase 1 - Advanced Discounts)
          discount_type: item.discount_type || 'none',
          discount_value: item.discount_value || 0,
        }
      })

      // Sale-time tax: compute canonical tax_lines on NET amounts after discounts
      // Default NULL tax_category to 'taxable' for backward compatibility (existing products).
      // Include ONLY products with tax_category = 'taxable'; exclude exempt and zero_rated.
      const validCartItems = cart.filter(
        (item) =>
          item?.product &&
          !isNaN(Number(item.product.price || 0)) &&
          Number(item.product.price || 0) > 0 &&
          item.quantity > 0
      )
      const taxableCartItems = validCartItems.filter((item) => {
        const taxCategory = (item.product.tax_category || "taxable").toLowerCase()
        return taxCategory === "taxable"
      })

      let apply_taxes = false
      let tax_lines: Record<string, unknown> | null = null
      let tax_engine_code: string | null = null
      let tax_engine_effective_from: string | null = null
      let tax_jurisdiction: string | null = null

      if (taxableCartItems.length > 0) {
        // Calculate tax on NET amounts after discounts
        const lineItems = taxableCartItems.map((item) => {
          const modifierTotal = item.modifiers
            ? item.modifiers.reduce((sum, m) => sum + m.price, 0)
            : 0
          const finalPrice = (item.variantPrice ?? item.product.price ?? 0) + modifierTotal
          
          // Find corresponding discount result
          const originalIndex = validCartItems.findIndex((ci) => ci.id === item.id)
          const lineDiscountResult = originalIndex >= 0 ? discountResult.lineItems[originalIndex] : null
          
          // Net price per unit after line discount
          const grossLine = finalPrice * (item.quantity || 1)
          const netLine = lineDiscountResult?.net_line || grossLine
          const netUnitPrice = (item.quantity || 1) > 0 ? netLine / (item.quantity || 1) : finalPrice
          
          return {
            quantity: Math.max(1, Math.floor(item.quantity || 1)),
            unit_price: netUnitPrice, // Use net price after line discount
            discount_amount: 0, // Discounts already applied to unit_price
          }
        })
        
        // Apply cart discount proportionally to taxable items for tax calculation
        if (cartDiscount && discountResult.cart_discount_amount > 0 && discountResult.subtotal_after_line_discounts > 0) {
          const cartDiscountProportion = discountResult.cart_discount_amount / discountResult.subtotal_after_line_discounts
          
          // Adjust each line item's unit price by its share of cart discount
          lineItems.forEach((lineItem) => {
            const originalNetLine = lineItem.unit_price * lineItem.quantity
            const cartDiscountAllocation = originalNetLine * cartDiscountProportion
            const finalNetLine = originalNetLine - cartDiscountAllocation
            lineItem.unit_price = lineItem.quantity > 0 ? finalNetLine / lineItem.quantity : lineItem.unit_price
          })
        }
        try {
          const effectiveDate = new Date().toISOString()
          const effectiveDateYmd = effectiveDate.split("T")[0]
          const result = calculateTaxes(
            lineItems,
            businessCountry ?? null,
            effectiveDate,
            true
          )
          if (result.taxLines.length > 0) {
            const jurisdiction = normalizeCountry(businessCountry ?? null)
            if (jurisdiction && jurisdiction !== UNSUPPORTED_COUNTRY_MARKER) {
              apply_taxes = true
              tax_lines = taxResultToJSONB(result)
              tax_engine_code = getTaxEngineCode(jurisdiction)
              tax_engine_effective_from = effectiveDateYmd
              tax_jurisdiction = jurisdiction
            }
          }
        } catch (e) {
          console.error("Sale-time tax calculation failed:", e)
          setError(
            "Tax calculation failed. Please ensure your business country is set and try again."
          )
          setProcessingPayment(false)
          return
        }
      }

      // Calculate payment totals
      const cashTotal = payments
        .filter((p) => p.method === "cash")
        .reduce((sum, p) => sum + p.amount, 0)
      const momoTotal = payments
        .filter((p) => p.method === "momo")
        .reduce((sum, p) => sum + p.amount, 0)
      const cardTotal = payments
        .filter((p) => p.method === "card")
        .reduce((sum, p) => sum + p.amount, 0)

      // Determine primary payment method (for backward compatibility)
      const primaryMethod =
        payments.length === 1
          ? payments[0].method
          : cashTotal > 0
          ? "cash"
          : momoTotal > 0
          ? "momo"
          : "card"

      /** Multiple tenders → receipt + sales row use `split` so receipt shows payment breakdown */
      const positivePaymentLines = payments.filter((p) => Number(p.amount) > 0.001)
      const paymentMethodForSale =
        positivePaymentLines.length > 1 ? "split" : positivePaymentLines[0]?.method ?? primaryMethod

      // STORE CONTEXT VALIDATION: Ensure valid store before creating sale
      // Get active store from session (prioritize over currentStoreId)
      const activeStoreId = sessionStoreId || currentStoreId || getActiveStoreId()
      
      // CRITICAL: Validate store_id before creating sale
      // This prevents 403 NO_STORE_ASSIGNED errors by blocking invalid sales client-side
      if (!activeStoreId || activeStoreId === 'all' || !hasValidStore) {
        setError("Cannot create sale: No store selected. Please select a store first.")
        setShowStorePicker(true)
        setProcessingPayment(false)
        setShowPaymentModal(false) // Close payment modal to show store picker
        return
      }
      
      // Build sale payload. Always send apply_taxes; when true, send canonical tax_lines + metadata.
      const salePayload: Record<string, unknown> = {
        business_id: businessId,
        user_id: userId,
        store_id: activeStoreId,
        active_store_id: activeStoreId,
        cashier_session_id: session?.id || null,
        register_id: session?.register_id || null,
        amount: cartTotals.total,
        subtotal: cartTotals.subtotal,
        description: cart.map((item) => `${item.product.name} x${item.quantity}`).join(", "),
        payment_method: paymentMethodForSale,
        payment_status: is_layaway ? "pending" : "paid", // Layaway sales are pending until completed
        payments,
        cash_amount: cashTotal,
        momo_amount: momoTotal,
        card_amount: cardTotal,
        cash_received: cash_received,
        change_given: change_given,
        sale_items: saleItems,
        apply_taxes,
        customer_id: selectedCustomer?.id || null,
        // Cart discount (Phase 1 - Advanced Discounts)
        cart_discount_type: cartDiscountType !== 'none' ? cartDiscountType : undefined,
        // Layaway fields (Phase 2 - Layaway/Installments)
        is_layaway: is_layaway || false,
        deposit_amount: is_layaway ? deposit_amount : undefined,
        cart_discount_value: cartDiscountType !== 'none' ? cartDiscountValue : undefined,
      }
      
      // Note: Discount amounts are computed server-side from discount_type and discount_value
      // The API will calculate and store the immutable discount_amount values
      if (apply_taxes && tax_lines && tax_engine_code && tax_engine_effective_from && tax_jurisdiction) {
        salePayload.tax_lines = tax_lines
        salePayload.tax_engine_code = tax_engine_code
        salePayload.tax_engine_effective_from = tax_engine_effective_from
        salePayload.tax_jurisdiction = tax_jurisdiction
      }

      if (retail_mtn_sandbox_payment_reference) {
        salePayload.retail_mtn_sandbox_payment_reference = retail_mtn_sandbox_payment_reference
      }

      // Phase 4: Check if offline - store transaction locally instead of posting
      const currentlyOffline = !isOnline()
      if (currentlyOffline) {
          // Store transaction in offline queue
          try {
            const entryDate = new Date().toISOString() // Original timestamp
            const localId = await addOfflineTransaction({
              business_id: businessId,
              store_id: activeStoreId,
              register_id: session?.register_id || "",
              cashier_id: userId,
              type: "sale",
              payload: salePayload,
              entry_date: entryDate,
            })

            // Update pending count
            await updatePendingCount()

            // Clear cart and show offline receipt
            setCart([])
            setSelectedCustomer(null)
            setCartDiscountType('none')
            setCartDiscountValue(0)
            setShowCartDiscount(false)
            setShowPaymentModal(false)
            setProcessingPayment(false)

            // Show offline receipt with actual localId
            router.push(`/sales/offline/${encodeURIComponent(localId)}?entry_date=${encodeURIComponent(entryDate)}&amount=${cartTotals.total}`)
            
            setToast({
              message: "Sale saved offline. Will sync when connection is restored.",
              type: "info",
            })
            return
          } catch (error: any) {
            console.error("Failed to save offline transaction:", error)
            setError(`Failed to save offline transaction: ${error.message}`)
            setProcessingPayment(false)
            return
          }
      }

      const response = await fetch("/api/sales/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(salePayload),
      })

      // Check if response has content before parsing JSON
      const responseText = await response.text()
      let data: any = {}
      
      console.log("API Response status:", response.status)
      console.log("API Response text (full):", responseText)
      console.log("API Response text length:", responseText.length)
      
      if (responseText && responseText.trim()) {
        try {
          data = JSON.parse(responseText)
          console.log("Parsed response data:", JSON.stringify(data, null, 2))
        } catch (parseError) {
          console.error("Failed to parse JSON response:", parseError)
          console.error("Response text that failed to parse:", responseText)
          setProcessingPayment(false)
          setError(`Invalid response from server: ${responseText.substring(0, 100)}`)
          return
        }
      } else {
        console.warn("Empty response text from API")
        data = {}
      }

      if (!response.ok) {
        console.error("API returned error:", response.status)
        console.error("Error response data:", JSON.stringify(data, null, 2))
        console.error("Error response keys:", Object.keys(data))
        console.error("Error response text (raw):", responseText)
        
        // Try to extract error message from various possible fields
        let errorMessage = data?.error || data?.message || data?.details
        
        // If still no error message, check if it's a known 403 issue
        if (!errorMessage && response.status === 403) {
          if (data?.code === "NO_STORE_ASSIGNED") {
            errorMessage = "Cannot create sale: You must be assigned to a store. Please contact your administrator."
          } else if (data?.code === "STORE_MISMATCH") {
            errorMessage = `Access denied: You can only create sales for your assigned store. Your store: ${data?.assignedStoreId || 'unknown'}, Requested: ${data?.requestedStoreId || 'unknown'}`
          } else {
            errorMessage = "Access denied: You don't have permission to create this sale. Please check your store assignment."
          }
        }
        
        // Fallback error message
        if (!errorMessage) {
          errorMessage = `Failed to create sale (HTTP ${response.status}). Please check the server console for details.`
        }
        
        console.error("Final error message:", errorMessage)
        
        setProcessingPayment(false)
        setError(errorMessage)
        return // Don't throw, just show error
      }

      // Log sale creation response for debugging
      console.log("Sale creation response:", {
        success: data.success,
        sale_id: data.sale_id,
        message: data.message,
        warning: data.warning
      })

      if (data.sale_id) {
        const receiptNumber = data.sale_id
          .replace(/-/g, "")
          .substring(0, 12)
          .toUpperCase()
        const pmLabel =
          positivePaymentLines.length > 1
            ? "Split payment"
            : primaryMethod === "cash"
              ? "Cash"
              : primaryMethod === "momo"
                ? "Mobile money"
                : primaryMethod === "card"
                  ? "Card"
                  : String(primaryMethod)

        setSaleSuccess({
          saleId: data.sale_id,
          receiptNumber,
          total: cartTotals.total,
          paymentMethodLabel: pmLabel,
          customerName: selectedCustomer?.name?.trim() || null,
        })

        setCart([])
        setSelectedCustomer(null)
        setCartDiscountType("none")
        setCartDiscountValue(0)
        setShowCartDiscount(false)
        setShowPaymentModal(false)
        setProcessingPayment(false)
      } else {
        // Sale might have been created but no sale_id returned
        console.error("Sale creation response missing sale_id:", data)
        setError("Sale may have been created but receipt is unavailable. Please check Sales History.")
        setCart([])
        setShowPaymentModal(false)
        setProcessingPayment(false)
        // Don't redirect - let user see the error and manually check
      }
    } catch (err: any) {
      setError(err.message || "Failed to process payment")
      setProcessingPayment(false)
    }
  }
}

// Cart Item Row Component
function CartItemRow({
  item,
  stockHint,
  onQuantityChange,
  onRemove,
  onNoteChange,
  onDiscountChange,
  currencyCode,
}: {
  item: CartItem
  stockHint?: { level: "low" | "out"; message: string } | null
  onQuantityChange: (quantity: number) => void
  onRemove: () => void
  onNoteChange: (note: string) => void
  onDiscountChange: (type: 'none' | 'percent' | 'amount', value: number) => void
  currencyCode: string | null
}) {
  const [showNote, setShowNote] = useState(false)
  const [noteValue, setNoteValue] = useState(item.note || "")
  const [showDiscount, setShowDiscount] = useState(false)
  const [discountType, setDiscountType] = useState<'none' | 'percent' | 'amount'>(item.discount_type || 'none')
  const [discountValue, setDiscountValue] = useState<number>(item.discount_value || 0)

  // Update noteValue when item.note changes externally
  useEffect(() => {
    setNoteValue(item.note || "")
  }, [item.note])

  // Update discount state when item discount changes externally
  useEffect(() => {
    setDiscountType(item.discount_type || 'none')
    setDiscountValue(item.discount_value || 0)
  }, [item.discount_type, item.discount_value])

  // Calculate line totals with discount
  const modifierTotal = item.modifiers
    ? item.modifiers.reduce((sum, m) => sum + m.price, 0)
    : 0
  const unitPrice = (item.variantPrice ?? item.product?.price ?? 0) + modifierTotal
  const grossLineTotal = unitPrice * (item.quantity || 1)
  
  let lineDiscountAmount = 0
  if (discountType === 'percent' && discountValue > 0) {
    lineDiscountAmount = (grossLineTotal * Math.min(100, discountValue)) / 100
  } else if (discountType === 'amount' && discountValue > 0) {
    lineDiscountAmount = Math.min(discountValue, grossLineTotal)
  }
  
  const netLineTotal = Math.max(0, grossLineTotal - lineDiscountAmount)

  const handleNoteBlur = () => {
    onNoteChange(noteValue.trim())
    if (!noteValue.trim()) {
      setShowNote(false)
    }
  }

  const handleNoteKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleNoteBlur()
    }
    if (e.key === "Escape") {
      setShowNote(false)
      setNoteValue(item.note || "")
    }
  }

  return (
    <div
      className={`rounded border bg-white px-1.5 py-1 text-[10px] leading-tight shadow-sm ${
        stockHint?.level === "out"
          ? "border-red-300 ring-1 ring-red-200"
          : stockHint?.level === "low"
            ? "border-amber-300 ring-1 ring-amber-100"
            : "border-slate-200"
      }`}
    >
      {/* Row 1: name + line total + remove (checkout-terminal density) */}
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-1 font-semibold text-slate-900">{item.product.name}</div>
          {(item.variantName && item.variantName !== item.product.name) || (item.modifiers && item.modifiers.length > 0) ? (
            <div className="truncate text-[9px] text-slate-500">
              {item.variantName && item.variantName !== item.product.name ? (
                <span className="text-violet-800">{item.variantName}</span>
              ) : null}
              {item.variantName && item.variantName !== item.product.name && item.modifiers && item.modifiers.length > 0
                ? " · "
                : null}
              {item.modifiers && item.modifiers.length > 0 ? item.modifiers.map((m) => m.name).join(", ") : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="text-right tabular-nums">
            {lineDiscountAmount > 0 ? (
              <>
                <div className="text-[9px] text-slate-400 line-through">{formatMoney(grossLineTotal, currencyCode)}</div>
                <div className="text-xs font-bold leading-none text-red-600">{formatMoney(netLineTotal, currencyCode)}</div>
              </>
            ) : (
              <div className="text-xs font-bold leading-none text-slate-900">{formatMoney(grossLineTotal, currencyCode)}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded border border-red-200 text-xs font-bold text-red-700 hover:bg-red-50"
            aria-label={`Remove ${item.product.name}`}
          >
            ×
          </button>
        </div>
      </div>

      {/* Row 2: stock hint (single compact line) */}
      {stockHint && (
        <div
          className={`mt-0.5 truncate rounded px-1 py-0 text-[9px] font-semibold ${
            stockHint.level === "out" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"
          }`}
        >
          {stockHint.message}
        </div>
      )}

      {/* Row 3: qty + unit (one row, minimal height) */}
      <div className="mt-0.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-0.5">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onQuantityChange(item.quantity - 1)}
            disabled={item.quantity <= 1}
            className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-bold leading-none hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            −
          </button>
          <input
            type="number"
            min="1"
            value={Number(item.quantity)}
            onChange={(e) => {
              const val = parseInt(e.target.value)
              if (!isNaN(val) && val >= 1) {
                onQuantityChange(val)
              }
            }}
            onBlur={(e) => {
              const val = parseInt(e.target.value)
              if (isNaN(val) || val < 1) {
                onQuantityChange(1)
              }
            }}
            className="h-6 w-9 rounded border border-slate-200 text-center text-[11px] font-bold leading-none"
          />
          <button
            type="button"
            onClick={() => onQuantityChange(item.quantity + 1)}
            className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-bold leading-none hover:bg-slate-100"
          >
            +
          </button>
        </div>
        <div className="shrink-0 text-[9px] tabular-nums text-slate-600">
          <span className="text-slate-400">@</span>
          <span className="font-semibold text-slate-800">{formatMoney(unitPrice, currencyCode)}</span>
        </div>
      </div>

      {/* Collapsed: one row for line actions */}
      {!showDiscount && !showNote && (
        <div className="mt-0.5 flex items-center gap-2 border-t border-slate-50 pt-0.5">
          <button
            type="button"
            onClick={() => setShowDiscount(true)}
            className="text-[9px] font-semibold text-blue-600 hover:underline"
          >
            Disc.
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="text-[9px] font-semibold text-blue-600 hover:underline"
          >
            Note
          </button>
        </div>
      )}

      {showDiscount && (
        <div className="mt-0.5 rounded border border-slate-200 bg-slate-50 p-1">
          <div className="flex flex-wrap items-center gap-0.5">
            <NativeSelect
              size="sm"
              wrapperClassName="min-w-0 flex-1"
              value={discountType}
              onChange={(e) => {
                const newType = e.target.value as 'none' | 'percent' | 'amount'
                setDiscountType(newType)
                if (newType === 'none') {
                  setDiscountValue(0)
                  onDiscountChange('none', 0)
                }
              }}
              className="text-[9px] leading-tight"
            >
              <option value="none">No line discount</option>
              <option value="percent">%</option>
              <option value="amount">Amt</option>
            </NativeSelect>
            {discountType !== 'none' && (
              <input
                type="number"
                min="0"
                max={discountType === 'percent' ? 100 : grossLineTotal}
                step={discountType === 'percent' ? 1 : 0.01}
                value={discountValue}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0
                  setDiscountValue(val)
                  onDiscountChange(discountType, val)
                }}
                placeholder={discountType === 'percent' ? "0-100" : "Amount"}
                className="w-12 rounded border border-slate-200 bg-white py-0.5 text-[9px]"
              />
            )}
            <button
              type="button"
              onClick={() => {
                setShowDiscount(false)
                setDiscountType('none')
                setDiscountValue(0)
                onDiscountChange('none', 0)
              }}
              className="text-[9px] text-red-600 hover:underline"
            >
              Clear
            </button>
          </div>
          {lineDiscountAmount > 0 && (
            <div className="mt-0.5 text-[9px] text-slate-600">−{formatMoney(lineDiscountAmount, currencyCode)}</div>
          )}
          {!showNote && (
            <button
              type="button"
              onClick={() => setShowNote(true)}
              className="mt-0.5 text-[9px] font-semibold text-blue-600 hover:underline"
            >
              + Note
            </button>
          )}
        </div>
      )}

      {showNote && (
        <div className="mt-0.5">
          <textarea
            value={noteValue}
            onChange={(e) => setNoteValue(e.target.value)}
            onBlur={handleNoteBlur}
            onKeyDown={handleNoteKeyDown}
            placeholder="Line note…"
            className="w-full resize-none rounded border border-slate-200 p-1 text-[9px]"
            rows={2}
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              setShowNote(false)
              setNoteValue("")
              onNoteChange("")
            }}
            className="mt-0.5 text-[9px] text-slate-500 hover:text-slate-800"
          >
            Cancel
          </button>
          {!showDiscount && (
            <button
              type="button"
              onClick={() => setShowDiscount(true)}
              className="mt-0.5 block text-[9px] font-semibold text-blue-600 hover:underline"
            >
              + Line discount
            </button>
          )}
        </div>
      )}

      {/* Display note if it exists */}
      {item.note && !showNote && (
        <div className="mt-0.5 truncate rounded bg-slate-50 px-1 py-0.5 text-[9px] italic text-slate-600">
          Note: {item.note}
        </div>
      )}
    </div>
  )
}

