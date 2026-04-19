"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getActiveStoreId } from "@/lib/storeSession"
import { getEffectiveStoreIdClient } from "@/lib/storeContext"
import { getAllOpenRegisterSessions, type OpenRegisterSession } from "@/lib/registerStatus"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { retailSettingsShell as RS } from "@/lib/retail/retailSettingsShell"
import { retailPaths } from "@/lib/retail/routes"

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
  /** Open till sessions (same source as register open/closed badge) */
  const [openRegisterSessions, setOpenRegisterSessions] = useState<OpenRegisterSession[]>([])
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
      setOpenRegisterSessions(openSessions)

      setStats((prev) => ({
        ...prev,
        registerStatus: openSessions.length > 0 ? "open" : "closed",
      }))
    } catch (err) {
      console.error("Error checking register status:", err)
      setOpenRegisterSessions([])
    }
  }

  const handleOpenPOS = () => {
    router.push("/pos")
  }

  const { format } = useBusinessCurrency()
  const formatCurrency = (amount: number) => format(amount)

  if (loading) {
    return (
      <div className={RS.containerWide}>
        <div className={RS.loadingCenter}>
          <div
            className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600 dark:border-gray-700 dark:border-t-blue-500"
            aria-hidden
          />
          <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Loading dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className={RS.containerWide}>
          {/* Currency Setup Banner */}
          {!business?.default_currency && (
            <div className={RS.alertWarning}>
              <div className="flex items-start gap-3">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <h3 className="mb-1 text-sm font-semibold text-amber-950 dark:text-amber-50">Set default currency</h3>
                  <p className="mb-3 text-sm text-amber-900/90 dark:text-amber-100/90">
                    Add your default currency in Business profile so amounts display correctly everywhere in Retail.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push(retailPaths.settingsBusinessProfile)}
                    className="text-sm font-medium text-amber-950 underline hover:no-underline dark:text-amber-50"
                  >
                    Open business profile
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="mb-6 flex flex-col gap-2 border-b border-gray-200 pb-6 dark:border-gray-800 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className={RS.pageTitle}>Retail dashboard</h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Today at a glance and quick access to POS.</p>
            </div>
            {business?.default_currency && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Amounts in {business.default_currency}
              </p>
            )}
          </div>

          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            {/* Sales Today Card - Clickable */}
            <button
              type="button"
              onClick={() => {
                const today = new Date().toISOString().split("T")[0]
                router.push(`${retailPaths.salesHistory}?date_from=${today}&date_to=${today}`)
              }}
              className="w-full cursor-pointer rounded-lg border border-gray-200 bg-white p-6 text-left shadow-sm transition-shadow hover:border-gray-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Sales today
                  </p>
                  <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">
                    {stats.salesToday}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">View in sales history</p>
                </div>
                <div className="rounded-lg bg-blue-50 p-2.5 dark:bg-blue-950/50">
                  <svg
                    className="h-7 w-7 text-blue-600 dark:text-blue-400"
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
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Revenue today
                  </p>
                  <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">
                    {formatCurrency(stats.revenueToday)}
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-2.5 dark:bg-emerald-950/40">
                  <svg
                    className="h-7 w-7 text-emerald-600 dark:text-emerald-400"
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
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Till status
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
                  {stats.registerStatus === "open" && openRegisterSessions.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-700">
                      {openRegisterSessions.map((s) => {
                        const registerLabel = s.registers?.name?.trim() || "Register"
                        const storeLabel = s.stores?.name?.trim()
                        return (
                          <li
                            key={s.id}
                            className="text-sm text-gray-700 dark:text-gray-300 truncate"
                            title={`${registerLabel}${storeLabel ? ` · ${storeLabel}` : ""} · opened ${new Date(s.started_at).toLocaleString()}`}
                          >
                            <span className="font-medium text-gray-900 dark:text-white">{registerLabel}</span>
                            {storeLabel ? (
                              <span className="text-gray-500 dark:text-gray-400"> · {storeLabel}</span>
                            ) : null}
                            <span className="block text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                              Opened {new Date(s.started_at).toLocaleString()}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
                <div
                  className={`ml-2 shrink-0 rounded-lg p-2.5 ${
                    stats.registerStatus === "open"
                      ? "bg-emerald-50 dark:bg-emerald-950/40"
                      : "bg-gray-100 dark:bg-gray-800"
                  }`}
                >
                  <svg
                    className={`h-7 w-7 ${
                      stats.registerStatus === "open"
                        ? "text-emerald-600 dark:text-emerald-400"
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

          {/* Open POS */}
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">Primary action</p>
            <button
              type="button"
              onClick={handleOpenPOS}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 md:inline-flex md:w-auto"
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
  )
}
