"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getActiveStoreId } from "@/lib/storeSession"
import { getEffectiveStoreIdClient } from "@/lib/storeContext"
import { getAllOpenRegisterSessions } from "@/lib/registerStatus"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

export default function RetailDashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [business, setBusiness] = useState<any>(null)
  const [userStoreId, setUserStoreId] = useState<string | null>(null)
  const [stats, setStats] = useState({
    salesToday: 0,
    revenueToday: 0,
    registerStatus: "closed" as "open" | "closed",
  })
  const [currentBusinessId, setCurrentBusinessId] = useState<string>("")

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

      const businessData = await getCurrentBusiness(supabase, user.id)
      if (!businessData) {
        setLoading(false)
        return
      }

      setBusiness(businessData)
      setBusinessId(businessData.id)
      setCurrentBusinessId(businessData.id)

      // Get user role
      const role = await getUserRole(supabase, user.id, businessData.id)

      // Block cashiers from accessing dashboard
      if (role === "cashier") {
        router.push("/pos")
        return
      }

      // Also check for cashier PIN session
      const { isCashierAuthenticated } = await import("@/lib/cashierSession")
      if (isCashierAuthenticated()) {
        router.push("/pos")
        return
      }

      // Get user's assigned store (for managers/cashiers)
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()

      setUserStoreId(userData?.store_id || null)

      // Get effective store ID based on role
      const activeStoreId = getActiveStoreId()
      const effectiveStoreId = getEffectiveStoreIdClient(
        role,
        activeStoreId && activeStoreId !== "all" ? activeStoreId : null,
        userData?.store_id || null
      )

      // Load today's sales and revenue
      await loadTodayStats(businessData.id, effectiveStoreId)

      // Check register status
      // CRITICAL: Pass businessId explicitly as argument, not from state
      // React state updates are asynchronous - using state here causes timing bugs
      // where currentBusinessId might still be empty string when checkRegisterStatus runs
      await checkRegisterStatus(businessData.id, effectiveStoreId)

      setLoading(false)
    } catch (err: any) {
      console.error("Error loading dashboard data:", err)
      setLoading(false)
    }
  }

  const loadTodayStats = async (businessId: string, effectiveStoreId: string | null) => {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      let salesQuery = supabase
        .from("sales")
        .select("id, amount")
        .eq("business_id", businessId)
        .eq("payment_status", "paid")
        .gte("created_at", today.toISOString())

      // Filter by store if effective store ID is set
      // null = admin global mode (all stores), specific ID = filter by store
      if (effectiveStoreId) {
        salesQuery = salesQuery.eq("store_id", effectiveStoreId)
      }

      const { data: todaySales, error: salesError } = await salesQuery

      if (salesError) {
        // If store_id column doesn't exist, try without it
        if (salesError.message?.includes("store_id") || salesError.code === "42703") {
          const { data: allSales } = await supabase
            .from("sales")
            .select("id, amount")
            .eq("business_id", businessId)
            .eq("payment_status", "paid")
            .gte("created_at", today.toISOString())

          if (allSales) {
            const revenue = allSales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
            setStats((prev) => ({
              ...prev,
              salesToday: allSales.length,
              revenueToday: revenue,
            }))
          }
        } else {
          console.error("Error loading sales:", salesError)
        }
      } else if (todaySales) {
        const revenue = todaySales.reduce((sum, sale) => sum + Number(sale.amount || 0), 0)
        setStats((prev) => ({
          ...prev,
          salesToday: todaySales.length,
          revenueToday: revenue,
        }))
      }
    } catch (err) {
      console.error("Error loading today's stats:", err)
    }
  }

  // CRITICAL: businessId must be passed as explicit argument, not from React state
  // React state updates are asynchronous - using currentBusinessId state causes timing bugs
  // where the state might still be empty string when this function executes
  const checkRegisterStatus = async (businessId: string, effectiveStoreId: string | null) => {
    try {
      // CRITICAL: effectiveStoreId null means "ANY store" - query entire business
      // Do NOT return empty array - admin in "All stores" mode should see open status
      // if ANY register session is open in ANY store
      const openSessions = await getAllOpenRegisterSessions(supabase, businessId, effectiveStoreId)
      
      setStats((prev) => ({
        ...prev,
        registerStatus: openSessions.length > 0 ? "open" : "closed",
      }))
    } catch (err) {
      console.error("Error checking register status:", err)
    }
  }

  const handleOpenPOS = () => {
    router.push("/pos")
  }

  const { format } = useBusinessCurrency()
  const formatCurrency = (amount: number) => format(amount)

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
        <div className="max-w-7xl mx-auto">
          {/* Currency Setup Banner */}
          {!business?.default_currency && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-1">Currency Not Configured</h3>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400 mb-3">
                    Please set your business currency in Business Profile to display amounts correctly.
                  </p>
                  <button
                    onClick={() => router.push("/retail/settings/business-profile")}
                    className="text-sm font-medium text-yellow-800 dark:text-yellow-300 hover:text-yellow-900 dark:hover:text-yellow-200 underline"
                  >
                    Go to Business Profile →
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Retail Dashboard
            </h1>
            {business?.default_currency && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                All amounts in {business.default_currency}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {/* Sales Today Card - Clickable */}
            <button
              onClick={() => {
                const today = new Date().toISOString().split('T')[0]
                router.push(`/sales-history?date_from=${today}&date_to=${today}`)
              }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-lg transition-all duration-200 cursor-pointer text-left w-full hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Sales Today
                  </p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
                    {stats.salesToday}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Click to view</p>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                  <svg
                    className="w-8 h-8 text-blue-600 dark:text-blue-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                    />
                  </svg>
                </div>
              </div>
            </button>

            {/* Revenue Today Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Revenue Today
                  </p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
                    {formatCurrency(stats.revenueToday)}
                  </p>
                </div>
                <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
                  <svg
                    className="w-8 h-8 text-green-600 dark:text-green-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {/* Register Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Register Status
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                        stats.registerStatus === "open"
                          ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                      }`}
                    >
                      {stats.registerStatus === "open" ? "Open" : "Closed"}
                    </span>
                  </div>
                </div>
                <div
                  className={`p-3 rounded-full ${
                    stats.registerStatus === "open"
                      ? "bg-green-100 dark:bg-green-900"
                      : "bg-gray-100 dark:bg-gray-700"
                  }`}
                >
                  <svg
                    className={`w-8 h-8 ${
                      stats.registerStatus === "open"
                        ? "text-green-600 dark:text-green-400"
                        : "text-gray-600 dark:text-gray-400"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Open POS Button */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <button
              onClick={handleOpenPOS}
              className="w-full md:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition-colors duration-200 flex items-center justify-center gap-2"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              Open POS
            </button>
          </div>
        </div>
      </div>
  )
}
