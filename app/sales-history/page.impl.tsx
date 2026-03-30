"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { hasAccessToSalesHistory, getUserRole } from "@/lib/userRoles"
import { getActiveStoreId } from "@/lib/storeSession"
import { getEffectiveStoreIdClient } from "@/lib/storeContext"
import { useRefund } from "@/lib/hooks/useRefund"
import { formatMoney } from "@/lib/money"
import RefundModalWrapper from "@/components/RefundModalWrapper"

type Sale = {
  id: string
  sale_id: string
  date: string
  cashier: { id: string; name: string; email: string } | null
  register: { id: string; name: string } | null
  total_amount: number
  payment_methods: string[]
  payment_method_display: string
  status: "completed" | "voided" | "refunded" | "parked"
  session_id: string | null
  payment_breakdown: { cash: number; momo: number; card: number } | null
  foreign_currency: {
    currency: string
    amount: number
    exchange_rate: number
    converted: number
  } | null
  voided_info?: {
    voided_at: string
    supervisor: { name: string; email: string } | null
  }
}

type User = {
  id: string
  email: string
  full_name: string
}

type Register = {
  id: string
  name: string
}

export default function SalesHistoryPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [currencyCode, setCurrencyCode] = useState("GHS")
  const [hasAccess, setHasAccess] = useState(false)

  // Filters - Initialize from URL params if present
  const [dateFrom, setDateFrom] = useState(searchParams?.get("date_from") || "")
  const [dateTo, setDateTo] = useState(searchParams?.get("date_to") || "")
  const [paymentMethod, setPaymentMethod] = useState("")
  const [status, setStatus] = useState("")
  const [cashierId, setCashierId] = useState("")
  const [registerId, setRegisterId] = useState("")

  // Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)

  // Sorting
  const [sortField, setSortField] = useState<string>("date")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")

  const handleSort = (field: string) => {
    if (sortField === field) {
      // Toggle direction if clicking same field
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      // New field, default to descending
      setSortField(field)
      setSortDirection("desc")
    }
    setPage(1) // Reset to first page when sorting
  }

  const getSortIcon = (field: string) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    }
    if (sortDirection === "asc") {
      return (
        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      )
    }
    return (
      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    )
  }

  // Options for filters
  const [cashiers, setCashiers] = useState<User[]>([])
  const [registers, setRegisters] = useState<Register[]>([])

  // Refund functionality
  const {
    requestRefund,
    showOverrideModal: showRefundModal,
    saleId: refundSaleId,
    cashierId: refundCashierId,
    handleOverrideClose: handleRefundClose,
    handleOverrideSuccess: handleRefundSuccess,
  } = useRefund({
    onSuccess: () => {
      // Reload sales after refund
      if (businessId) {
        loadSales()
      }
    },
    onError: (errorMsg) => {
      setError(errorMsg || "Supervisor approval is required to refund a sale.")
    },
  })

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (businessId) {
      loadSales()
      loadCashiers()
      loadRegisters()
    }
  }, [businessId, page, dateFrom, dateTo, paymentMethod, status, cashierId, registerId, sortField, sortDirection])

  const loadData = async () => {
    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      const business = await getCurrentBusiness(supabase, user.id)
      if (!business) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusinessId(business.id)
      setCurrencyCode(business.default_currency || "GHS")

      // Check if business is in Service mode - Sales History is for Retail only
      // Redirect Service mode users to Invoices page
      if (business.industry === "service") {
        router.push("/invoices")
        return
      }

      // Check user role first
      const role = await getUserRole(supabase, user.id, business.id)
      
      // Debug logging
      console.log("Sales History - User ID:", user.id)
      console.log("Sales History - Business ID:", business.id)
      console.log("Sales History - Role:", role)
      
      // Check business_users table directly for debugging
      const { data: businessUserData, error: buError } = await supabase
        .from("business_users")
        .select("role, business_id, user_id")
        .eq("business_id", business.id)
        .eq("user_id", user.id)
        .maybeSingle()
      
      console.log("Sales History - Business User Data:", businessUserData)
      console.log("Sales History - Business User Error:", buError)
      
      // Check if user is business owner
      const { data: ownerCheck } = await supabase
        .from("businesses")
        .select("owner_id")
        .eq("id", business.id)
        .maybeSingle()
      
      console.log("Sales History - Business Owner ID:", ownerCheck?.owner_id)
      console.log("Sales History - Is Owner:", ownerCheck?.owner_id === user.id)
      
      // If role is null, there might be an issue with business_users table
      if (!role) {
        const errorMsg = `Unable to determine your role. 
          User ID: ${user.id}
          Business ID: ${business.id}
          Business Owner: ${ownerCheck?.owner_id || 'unknown'}
          Business User Record: ${businessUserData ? JSON.stringify(businessUserData) : 'NOT FOUND'}
          Please ensure you are assigned to this business.`
        console.error(errorMsg)
        setError(errorMsg)
        setLoading(false)
        return
      }
      
      // Cashiers should be redirected to POS, not shown an error
      if (role === "cashier") {
        router.push("/pos")
        return
      }

      // Check access - only owners, admins, and managers can access
      const access = await hasAccessToSalesHistory(supabase, user.id, business.id)
      console.log("Sales History - Access:", access)
      setHasAccess(access)

      if (!access) {
        // More detailed error message showing actual role
        const errorMsg = `Access denied. Your role is "${role}". Only owners, admins, managers, and employees can access sales history.
          
          Debug Info:
          - Your Role: ${role}
          - User ID: ${user.id}
          - Business ID: ${business.id}
          - Business Owner: ${ownerCheck?.owner_id || 'unknown'}
          - Is Owner: ${ownerCheck?.owner_id === user.id ? 'YES' : 'NO'}
          - Business User Record: ${businessUserData ? JSON.stringify(businessUserData) : 'NOT FOUND'}`
        console.error(errorMsg)
        setError(errorMsg)
        setLoading(false)
        return
      }
    } catch (err: any) {
      setError(err.message || "Failed to load data")
      setLoading(false)
    }
  }

  const loadCashiers = async () => {
    if (!businessId) return

    const { data: businessUsers } = await supabase
      .from("business_users")
      .select("user_id")
      .eq("business_id", businessId)

    if (businessUsers && businessUsers.length > 0) {
      const userIds = businessUsers.map((bu) => bu.user_id)
      const { data: usersData } = await supabase
        .from("users")
        .select("id, email, full_name")
        .in("id", userIds)

      setCashiers(usersData || [])
    }
  }

  const loadRegisters = async () => {
    if (!businessId) return

    const {
      data: { user },
    } = await supabase.auth.getUser()
    
    if (!user) return
    
    // Get role and effective store_id
    const role = await getUserRole(supabase, user.id, businessId)
    const activeStoreId = getActiveStoreId()
    
    const { data: userData } = await supabase
      .from("users")
      .select("store_id")
      .eq("id", user.id)
      .maybeSingle()
    
    const effectiveStoreId = getEffectiveStoreIdClient(
      role,
      activeStoreId && activeStoreId !== 'all' ? activeStoreId : null,
      userData?.store_id || null
    )
    
    let registersQuery = supabase
      .from("registers")
      .select("id, name")
      .eq("business_id", businessId)
      .order("name", { ascending: true })
    
    // Filter by effective store_id (admin can see all if null)
    if (effectiveStoreId) {
      registersQuery = registersQuery.eq("store_id", effectiveStoreId)
    }
    
    const { data: registersData } = await registersQuery

    setRegisters(registersData || [])
  }

  const loadSales = async () => {
    if (!businessId) return

    try {
      setLoading(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not logged in")
        setLoading(false)
        return
      }

      // Get role and effective store_id
      const role = await getUserRole(supabase, user.id, businessId)
      const activeStoreId = getActiveStoreId()
      
      // Get user's assigned store_id (for managers/cashiers)
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()
      
      // Get effective store_id based on role
      const effectiveStoreId = getEffectiveStoreIdClient(
        role,
        activeStoreId && activeStoreId !== 'all' ? activeStoreId : null,
        userData?.store_id || null
      )
      
      // For store users (manager), require store assignment
      if ((role === "manager" || role === "cashier") && !effectiveStoreId) {
        setError("You must be assigned to a store to view sales history.")
        setSales([])
        setLoading(false)
        return
      }
      
      // For admin, allow global mode (null store_id) or filter by selected store
      // Pass null for global mode, or store_id for filtered view
      const storeIdParam = effectiveStoreId || (role === "owner" || role === "admin" ? null : undefined)
      
      const params = new URLSearchParams({
        business_id: businessId,
        user_id: user.id,
        page: page.toString(),
        page_size: "50",
      })
      
      // Only add store_id if it's set (admin can work in global mode with null)
      if (storeIdParam) {
        params.append("store_id", storeIdParam)
      }

      if (dateFrom) params.append("date_from", dateFrom)
      if (dateTo) params.append("date_to", dateTo)
      if (paymentMethod) params.append("payment_method", paymentMethod)
      if (status) params.append("status", status)
      if (cashierId) params.append("cashier_id", cashierId)
      if (registerId) params.append("register_id", registerId)
      params.append("sort_field", sortField)
      params.append("sort_direction", sortDirection)

      const response = await fetch(`/api/sales-history/list?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Failed to load sales")
        setLoading(false)
        return
      }

      setSales(data.sales || [])
      setTotalPages(data.pagination?.total_pages || 1)
      setTotalCount(data.pagination?.total || 0)
      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load sales")
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      completed: "bg-green-100 text-green-800",
      refunded: "bg-orange-100 text-orange-800",
      voided: "bg-red-100 text-red-800",
      parked: "bg-yellow-100 text-yellow-800",
    }
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-semibold ${
          styles[status] || "bg-gray-100 text-gray-800"
        }`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const handleResetFilters = () => {
    setDateFrom("")
    setDateTo("")
    setPaymentMethod("")
    setStatus("")
    setCashierId("")
    setRegisterId("")
    setPage(1)
  }

  if (loading && sales.length === 0) {
    return (
      <div className="p-6">
        <p>Loading...</p>
      </div>
    )
  }

  if (!hasAccess) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          <p className="font-semibold">Access Denied</p>
          <p>Only owners, admins, managers, and employees can access sales history.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Sales History</h1>
            <p className="text-gray-600">View and filter all sales transactions</p>
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="bg-gray-300 text-gray-800 px-4 py-2 rounded hover:bg-gray-400"
          >
            Dashboard
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* Filters - Modern & Responsive */}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filter Sales</h3>
            <button
              onClick={handleResetFilters}
              className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium transition-colors"
            >
              Reset All
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Date From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(1)
                }}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Date To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(1)
                }}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Payment Method
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value)
                  setPage(1)
                }}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                <option value="">All Methods</option>
                <option value="cash">Cash</option>
                <option value="momo">MoMo</option>
                <option value="card">Card</option>
                <option value="split">Split</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value)
                  setPage(1)
                }}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                <option value="">All Status</option>
                <option value="completed">Completed</option>
                <option value="refunded">Refunded</option>
                <option value="voided">Voided</option>
                <option value="parked">Parked</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Cashier 👤
              </label>
              <select
                value={cashierId}
                onChange={(e) => {
                  setCashierId(e.target.value)
                  setPage(1)
                }}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                <option value="">All Cashiers</option>
                {cashiers.map((cashier) => (
                  <option key={cashier.id} value={cashier.id}>
                    {cashier.full_name || cashier.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                Register
              </label>
              <select
                value={registerId}
                onChange={(e) => {
                  setRegisterId(e.target.value)
                  setPage(1)
                }}
                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              >
                <option value="">All Registers</option>
                {registers.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Sales Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                    onClick={() => handleSort("sale_id")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Sale ID</span>
                      {getSortIcon("sale_id")}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                    onClick={() => handleSort("date")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Date/Time</span>
                      {getSortIcon("date")}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                    onClick={() => handleSort("cashier")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Cashier 👤</span>
                      {getSortIcon("cashier")}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                    onClick={() => handleSort("register")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Register</span>
                      {getSortIcon("register")}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                    onClick={() => handleSort("amount")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Amount</span>
                      {getSortIcon("amount")}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                    onClick={() => handleSort("payment")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Payment</span>
                      {getSortIcon("payment")}
                    </div>
                  </th>
                  <th 
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors select-none"
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center gap-2">
                      <span>Status</span>
                      {getSortIcon("status")}
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sales.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 text-center text-gray-500">
                      No sales found
                    </td>
                  </tr>
                ) : (
                  sales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <button
                          onClick={() => router.push(`/sales-history/${sale.id}`)}
                          className="text-blue-600 hover:text-blue-900 font-mono text-sm"
                        >
                          {sale.sale_id}
                        </button>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(sale.date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {sale.cashier ? (
                          <span className="text-gray-900">{sale.cashier.name}</span>
                        ) : (
                          <span className="text-gray-400 italic">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {sale.register ? sale.register.name : "N/A"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {formatMoney(sale.total_amount, currencyCode)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {sale.payment_method_display}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(sale.status)}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => router.push(`/sales-history/${sale.id}/receipt`)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Receipt
                          </button>
                          <button
                            onClick={() => router.push(`/sales-history/${sale.id}`)}
                            className="text-gray-600 hover:text-gray-900"
                          >
                            View
                          </button>
                          {sale.status !== "refunded" && sale.status !== "voided" && (
                            <button
                              onClick={() => requestRefund(sale.id)}
                              className="text-orange-600 hover:text-orange-900 font-medium"
                            >
                              Refund
                            </button>
                          )}
                          {sale.status === "refunded" && (
                            <span className="text-xs text-gray-500 italic">Refunded</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex items-center justify-between">
              <div className="text-sm text-gray-700">
                Showing page {page} of {totalPages} ({totalCount} total)
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 border rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Render the refund override modal */}
        <RefundModalWrapper
          showOverrideModal={showRefundModal}
          saleId={refundSaleId}
          cashierId={refundCashierId}
          onClose={handleRefundClose}
          onSuccess={handleRefundSuccess}
        />
      </div>
  )
}
