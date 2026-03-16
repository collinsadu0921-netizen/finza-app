"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"

type StockMovement = {
  id: string
  product_id: string
  product_name: string
  quantity_change: number
  type: "sale" | "refund" | "adjustment" | "initial_import"
  created_at: string
  note: string | null
  related_sale_id: string | null
  user?: {
    email: string
    full_name: string
  }
}

export default function InventoryHistoryPage() {
  const router = useRouter()
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [businessId, setBusinessId] = useState("")
  const [hasAccess, setHasAccess] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const itemsPerPage = 50

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [productFilter, setProductFilter] = useState<string>("all")
  const [dateFilter, setDateFilter] = useState<string>("all")
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([])
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")

  useEffect(() => {
    loadData()
  }, [currentPage, typeFilter, productFilter, dateFilter, customStartDate, customEndDate])

  const loadData = async () => {
    try {
      setLoading(true)
      setError("")

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError("Not authenticated")
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

      // Check permissions - only owner, admin, manager can view history
      const role = await getUserRole(supabase, user.id, business.id)
      if (role !== "owner" && role !== "admin" && role !== "manager") {
        setError("Access denied. Only owners, admins, and managers can view inventory history.")
        setHasAccess(false)
        setLoading(false)
        return
      }

      setHasAccess(true)

      // Load products for filter
      const { data: productsData } = await supabase
        .from("products")
        .select("id, name")
        .eq("business_id", business.id)
        .order("name", { ascending: true })

      if (productsData) {
        setProducts(productsData)
      }

      // Build query with filters
      const from = (currentPage - 1) * itemsPerPage
      const to = from + itemsPerPage - 1

      let query = supabase
        .from("stock_movements")
        .select(
          `
          id,
          product_id,
          quantity_change,
          type,
          created_at,
          note,
          related_sale_id,
          user_id,
          products:product_id (
            name
          )
        `,
          { count: "exact" }
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })

      // Type filter
      if (typeFilter !== "all") {
        query = query.eq("type", typeFilter)
      }

      // Product filter
      if (productFilter !== "all") {
        query = query.eq("product_id", productFilter)
      }

      // Date filter
      if (dateFilter === "today") {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        query = query.gte("created_at", today.toISOString())
      } else if (dateFilter === "yesterday") {
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        yesterday.setHours(0, 0, 0, 0)
        const endOfYesterday = new Date(yesterday)
        endOfYesterday.setHours(23, 59, 59, 999)
        query = query.gte("created_at", yesterday.toISOString()).lte("created_at", endOfYesterday.toISOString())
      } else if (dateFilter === "this_week") {
        const weekStart = new Date()
        weekStart.setDate(weekStart.getDate() - weekStart.getDay())
        weekStart.setHours(0, 0, 0, 0)
        query = query.gte("created_at", weekStart.toISOString())
      } else if (dateFilter === "this_month") {
        const monthStart = new Date()
        monthStart.setDate(1)
        monthStart.setHours(0, 0, 0, 0)
        query = query.gte("created_at", monthStart.toISOString())
      } else if (dateFilter === "custom" && customStartDate && customEndDate) {
        const start = new Date(customStartDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(customEndDate)
        end.setHours(23, 59, 59, 999)
        query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString())
      }

      const { data: movementsData, error: movementsError, count } = await query.range(from, to)

      if (movementsError) {
        setError(`Error loading stock movements: ${movementsError.message}`)
        setLoading(false)
        return
      }

      // Fetch user data separately for each unique user_id
      const userIds = Array.from(new Set((movementsData || []).map((m: any) => m.user_id).filter(Boolean)))
      const userMap: Record<string, { email: string; full_name: string }> = {}

      if (userIds.length > 0) {
        // Try to fetch from users table first
        const { data: usersData } = await supabase
          .from("users")
          .select("id, email, full_name")
          .in("id", userIds)

        if (usersData) {
          usersData.forEach((u) => {
            userMap[u.id] = {
              email: u.email || "",
              full_name: u.full_name || "",
            }
          })
        }

        // For any missing users, try to get from auth (admin only, may not work)
        // If users table doesn't have all users, we'll just show the user_id
      }

      setMovements(
        (movementsData || []).map((m: any) => ({
          id: m.id,
          product_id: m.product_id,
          product_name: m.products?.name || "Unknown Product",
          quantity_change: m.quantity_change,
          type: m.type,
          created_at: m.created_at,
          note: m.note,
          related_sale_id: m.related_sale_id,
          user: userMap[m.user_id]
            ? {
                email: userMap[m.user_id].email,
                full_name: userMap[m.user_id].full_name,
              }
            : undefined,
        }))
      )

      if (count !== null) {
        setTotalCount(count)
        setTotalPages(Math.ceil(count / itemsPerPage))
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load inventory history")
      setLoading(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "sale":
        return "Sale"
      case "refund":
        return "Refund"
      case "adjustment":
        return "Adjustment"
      case "initial_import":
        return "Import"
      default:
        return type
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case "sale":
        return "bg-red-100 text-red-800"
      case "refund":
        return "bg-green-100 text-green-800"
      case "adjustment":
        return "bg-blue-100 text-blue-800"
      case "initial_import":
        return "bg-purple-100 text-purple-800"
      default:
        return "bg-gray-100 text-gray-800"
    }
  }

  if (!hasAccess && !loading) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error || "Access denied"}
        </div>
        <button
          onClick={() => router.push("/inventory")}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        >
          Back to Inventory
        </button>
      </div>
    )
  }

  return (
    <div className="p-6">
        <div className="mb-6">
          <button
            onClick={() => router.push("/inventory")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Inventory
          </button>
          <h1 className="text-2xl font-bold mb-2">Inventory History</h1>
          <p className="text-gray-600">All stock movements across all products</p>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value)
                  setCurrentPage(1)
                }}
                className="w-full border rounded px-3 py-2"
              >
                <option value="all">All Types</option>
                <option value="sale">Sale</option>
                <option value="refund">Refunds</option>
                <option value="adjustment">Adjustment</option>
                <option value="initial_import">Import</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Product</label>
              <select
                value={productFilter}
                onChange={(e) => {
                  setProductFilter(e.target.value)
                  setCurrentPage(1)
                }}
                className="w-full border rounded px-3 py-2"
              >
                <option value="all">All Products</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Date Range</label>
              <select
                value={dateFilter}
                onChange={(e) => {
                  setDateFilter(e.target.value)
                  setCurrentPage(1)
                }}
                className="w-full border rounded px-3 py-2"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This Week</option>
                <option value="this_month">This Month</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {dateFilter === "custom" && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Custom Date Range</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => {
                      setCustomStartDate(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="flex-1 border rounded px-3 py-2"
                  />
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => {
                      setCustomEndDate(e.target.value)
                      setCurrentPage(1)
                    }}
                    className="flex-1 border rounded px-3 py-2"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
            <p>Loading inventory history...</p>
          </div>
        ) : movements.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500">
            <p>No stock movements found.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 text-sm text-gray-600">
              Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} movements
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date & Time
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Product
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Quantity Change
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        User
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Note
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Related Sale
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {movements.map((movement) => (
                      <tr key={movement.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(movement.created_at)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          <a
                            href={`/inventory/stock-history/${movement.product_id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {movement.product_name}
                          </a>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${getTypeColor(movement.type)}`}>
                            {getTypeLabel(movement.type)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                          <span
                            className={
                              movement.quantity_change > 0
                                ? "text-green-600 font-semibold"
                                : "text-red-600 font-semibold"
                            }
                          >
                            {movement.quantity_change > 0 ? "+" : ""}
                            {movement.quantity_change}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {movement.user?.full_name || movement.user?.email || "Unknown"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                          {movement.note || "-"}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {movement.related_sale_id ? (
                            <a
                              href={`/sales-history/${movement.related_sale_id}`}
                              className="text-blue-600 hover:underline"
                            >
                              View Sale
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
  )
}

