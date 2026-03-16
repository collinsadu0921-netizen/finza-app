"use client"

import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import LoadingScreen from "@/components/ui/LoadingScreen"
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"
import EmptyState from "@/components/ui/EmptyState"
import { formatMoney } from "@/lib/money"

type Order = {
  id: string
  customer_id: string | null
  estimate_id: string | null
  invoice_id: string | null
  status: "draft" | "issued" | "converted" | "cancelled"
  execution_status: "pending" | "active" | "completed" | null
  total_amount: number
  created_at: string
  customers: {
    id: string
    name: string
    email: string | null
    phone: string | null
  } | null
  estimates: {
    id: string
    estimate_number: string
  } | null
  invoices: {
    id: string
    invoice_number: string
  } | null
}

export default function OrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [searchInput, setSearchInput] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [isSearching, setIsSearching] = useState(false)
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const isInitialLoadRef = useRef(true)

  useEffect(() => {
    loadOrders()
  }, [])

  // Debounced search effect - updates searchQuery after user stops typing
  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    if (searchInput.trim()) {
      setIsSearching(true)
    }

    searchDebounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput)
      setIsSearching(false)
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [searchInput])

  useEffect(() => {
    if (businessId) {
      loadOrders()
    }
  }, [businessId, statusFilter, searchQuery])

  const loadOrders = async () => {
    try {
      // Only show full loading screen on initial load, not for search-only updates
      if (isInitialLoadRef.current) {
        setLoading(true)
      }
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

      // Build query parameters
      const params = new URLSearchParams()
      if (statusFilter !== "all") params.append("status", statusFilter)
      if (searchQuery) params.append("search", searchQuery)

      const response = await fetch(`/api/orders/list?${params.toString()}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const friendlyError = errorData.error || "We couldn't load your orders. Please refresh the page or check your connection."
        throw new Error(friendlyError)
      }

      const { orders: ordersData } = await response.json()
      setOrders(ordersData || [])
      setLoading(false)
      isInitialLoadRef.current = false
    } catch (err: any) {
      setError(err.message || "We couldn't load your orders. Please refresh the page or check your connection.")
      setLoading(false)
      isInitialLoadRef.current = false
    }
  }

  const getCommercialStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
      issued: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
      converted: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
      cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    }
    const labels: Record<string, string> = {
      draft: "Draft",
      issued: "Issued",
      converted: "Converted",
      cancelled: "Cancelled",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || "bg-gray-100 text-gray-800"}`}>
        {labels[status] || status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const getExecutionStatusBadge = (executionStatus: string | null) => {
    if (!executionStatus) return null
    const styles: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
      active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
    }
    const labels: Record<string, string> = {
      pending: "Pending",
      active: "Active",
      completed: "Completed",
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[executionStatus] || "bg-gray-100 text-gray-800"}`}>
        {labels[executionStatus] || executionStatus.charAt(0).toUpperCase() + executionStatus.slice(1)}
      </span>
    )
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-"
    return new Date(dateString).toLocaleDateString("en-GH", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const getShortOrderId = (id: string) => {
    return id.substring(0, 8).toUpperCase()
  }

  if (loading) {
    return (
      
        <LoadingScreen />
      
    )
  }

  return (
    
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageHeader
            title="Orders"
            subtitle="Manage and track all your orders"
            actions={
              <Button
                onClick={() => router.push("/orders/new")}
                leftIcon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                }
              >
                New Order
              </Button>
            }
          />

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {/* Filters */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-6 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Search</label>
                <div className="relative">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Customer name or order ID..."
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white transition-colors"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="draft">Draft</option>
                  <option value="issued">Issued</option>
                  <option value="converted">Converted</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              <button
                onClick={() => {
                  setStatusFilter("all")
                  setSearchInput("")
                  setSearchQuery("")
                }}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                Clear all filters
              </button>
            </div>
          </div>

          {orders.length === 0 ? (
            <EmptyState
              icon={
                <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              }
              title="No orders found"
              description="Get started by creating your first order or converting a quote to an order."
              actionLabel="Create Your First Order"
              onAction={() => router.push("/orders/new")}
            />
          ) : (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-lg">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Order ID
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Total Amount
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Linked Invoice
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Created Date
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {orders.map((order) => (
                      <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">{getShortOrderId(order.id)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {order.customers?.name || "No Customer"}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex gap-2 items-center">
                            {getCommercialStatusBadge(order.status)}
                            {order.status === "issued" && getExecutionStatusBadge(order.execution_status)}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-bold text-gray-900 dark:text-white">
                            {formatMoney(Number(order.total_amount || 0), "GHS")}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {order.invoices ? (
                            <button
                              onClick={() => router.push(`/invoices/${order.invoices!.id}/view`)}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors text-sm"
                            >
                              {order.invoices.invoice_number}
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-600 dark:text-gray-400">{formatDate(order.created_at)}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <button
                            onClick={() => router.push(`/orders/${order.id}/view`)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium transition-colors"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    
  )
}

