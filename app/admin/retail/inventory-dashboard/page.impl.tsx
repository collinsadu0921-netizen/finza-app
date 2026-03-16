"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getUserStore } from "@/lib/stores"
import { getActiveStoreId } from "@/lib/storeSession"
import { getStockStatus, isLowStock } from "@/lib/inventory"
import { checkStoreContextClient } from "@/lib/storeContextGuard"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"

type Product = {
  id: string
  name: string
  price: number
  stock_quantity?: number
  stock?: number
  low_stock_threshold?: number
  track_stock?: boolean
  barcode?: string
  category_id?: string
}

type Category = {
  id: string
  name: string
}

type StockAdjustment = {
  id: string
  product_id: string
  product_name: string
  quantity_change: number
  type: string
  created_at: string
  user_name: string
}

type TopSellingItem = {
  product_id: string
  product_name: string
  units_sold: number
  revenue: number
  cogs: number
  gross_profit: number
}

type InventoryKPIs = {
  totalProducts: number
  totalCategories: number
  totalStockUnits: number
  totalInventoryValue: number
  outOfStockCount: number
  lowStockCount: number
}

export default function InventoryDashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [hasAccess, setHasAccess] = useState(false)
  const [businessId, setBusinessId] = useState("")
  const [business, setBusiness] = useState<any>(null)

  // KPI Data
  const [kpis, setKpis] = useState<InventoryKPIs>({
    totalProducts: 0,
    totalCategories: 0,
    totalStockUnits: 0,
    totalInventoryValue: 0,
    outOfStockCount: 0,
    lowStockCount: 0,
  })

  // Low Stock Overview
  const [lowStockCount, setLowStockCount] = useState(0)
  const [outOfStockCount, setOutOfStockCount] = useState(0)

  // Out of Stock List
  const [outOfStockProducts, setOutOfStockProducts] = useState<Array<Product & { category_name?: string }>>([])

  // Recently Adjusted Items
  const [recentAdjustments, setRecentAdjustments] = useState<StockAdjustment[]>([])

  // Top Selling Items
  const [topSellingItems, setTopSellingItems] = useState<TopSellingItem[]>([])

  // Profit Analytics
  const [dailyGrossProfit, setDailyGrossProfit] = useState(0)
  const [monthlyGrossProfit, setMonthlyGrossProfit] = useState(0)
  const [dailyRevenue, setDailyRevenue] = useState(0)
  const [monthlyRevenue, setMonthlyRevenue] = useState(0)
  const [dailyCogs, setDailyCogs] = useState(0)
  const [monthlyCogs, setMonthlyCogs] = useState(0)

  useEffect(() => {
    loadData()
  }, [])

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

      const businessData = await getCurrentBusiness(supabase, user.id)
      if (!businessData) {
        setError("Business not found")
        setLoading(false)
        return
      }

      setBusiness(businessData)
      setBusinessId(businessData.id)

      // Check permissions - only owner, admin, manager can view dashboard
      const role = await getUserRole(supabase, user.id, businessData.id)
      
      if (role !== "owner" && role !== "admin" && role !== "manager") {
        setError("Access denied. Only owners, admins, and managers can view the inventory dashboard.")
        setHasAccess(false)
        setLoading(false)
        return
      }

      setHasAccess(true)

      // STORE CONTEXT: Store context validation is now handled via resolveAccess()
      // We just need to get the active store for data loading
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user.id)
        .maybeSingle()
      
      // Get active store from session (store context is validated by resolveAccess())
      const activeStoreId = getActiveStoreId()
      const storeIdForStock = activeStoreId && activeStoreId !== 'all' ? activeStoreId : null

      // Load all products with categories
      const { data: productsData } = await supabase
        .from("products")
        .select(
          `
          id,
          name,
          price,
          stock_quantity,
          stock,
          low_stock_threshold,
          track_stock,
          barcode,
          category_id,
          categories:category_id (
            name
          )
        `
        )
        .eq("business_id", businessData.id)

      // Load categories
      const { data: categoriesData } = await supabase
        .from("categories")
        .select("id, name")
        .eq("business_id", businessData.id)

      if (!productsData) {
        setError("Failed to load products")
        setLoading(false)
        return
      }

      // Load stock from products_stock table (per-store inventory)
      // Use active_store_id from session
      let stockQuery = supabase
        .from("products_stock")
        .select("product_id, variant_id, stock, stock_quantity, store_id")
        .in("product_id", productsData.map((p: any) => p.id))

      if (storeIdForStock) {
        stockQuery = stockQuery.eq("store_id", storeIdForStock)
      }
      // If storeIdForStock is null (activeStoreId is "all" or not set), aggregate across all stores

      const { data: stockData } = await stockQuery

      // Create a map of product_id -> stock (aggregate if multiple stores)
      const stockMap: Record<string, number> = {}
      if (stockData) {
        stockData.forEach((s: any) => {
          if (!s.variant_id) { // Only count non-variant stock for main products
            const currentStock = s.stock_quantity !== null && s.stock_quantity !== undefined
              ? Number(s.stock_quantity)
              : s.stock !== null && s.stock !== undefined
              ? Number(s.stock)
              : 0
            stockMap[s.product_id] = (stockMap[s.product_id] || 0) + currentStock
          }
        })
      }

      // Calculate KPIs
      let totalInventoryValue = 0
      let totalStockUnits = 0
      let outOfStock = 0
      let lowStock = 0
      const outOfStockList: Array<Product & { category_name?: string }> = []

      productsData.forEach((p: any) => {
        // Use stock from products_stock if available, otherwise fallback to product.stock
        const stockQty = Math.floor(
          stockMap[p.id] !== undefined
            ? stockMap[p.id]
            : p.stock_quantity !== null && p.stock_quantity !== undefined
            ? Number(p.stock_quantity)
            : p.stock !== null && p.stock !== undefined
            ? Number(p.stock)
            : 0
        )
        const price = Number(p.price) || 0
        const threshold = p.low_stock_threshold !== null && p.low_stock_threshold !== undefined ? Number(p.low_stock_threshold) : 5

        // Calculate inventory value (only for tracked stock)
        if (p.track_stock !== false) {
          totalInventoryValue += stockQty * price
          totalStockUnits += stockQty
        }

        // Check stock status
        const stockStatus = getStockStatus(stockQty, threshold, p.track_stock)
        if (stockStatus.status === "out_of_stock") {
          outOfStock++
          outOfStockList.push({
            ...p,
            stock_quantity: stockQty,
            stock: stockQty,
            category_name: p.categories?.name || "Uncategorized",
          })
        } else if (stockStatus.status === "low_stock") {
          lowStock++
        }
      })

      // Sort out of stock list by product name
      outOfStockList.sort((a, b) => a.name.localeCompare(b.name))

      setKpis({
        totalProducts: productsData.length,
        totalCategories: categoriesData?.length || 0,
        totalStockUnits,
        totalInventoryValue,
        outOfStockCount: outOfStock,
        lowStockCount: lowStock,
      })

      setLowStockCount(lowStock)
      setOutOfStockCount(outOfStock)
      setOutOfStockProducts(outOfStockList)

      // Load recent adjustments (last 10) - filter by store if active store is set
      let adjustmentsQuery = supabase
        .from("stock_movements")
        .select(
          `
          id,
          product_id,
          quantity_change,
          type,
          created_at,
          user_id,
          store_id,
          products:product_id (
            name
          )
        `
        )
        .eq("business_id", businessData.id)
        .eq("type", "adjustment")
        .order("created_at", { ascending: false })
        .limit(10)
      
      if (storeIdForStock) {
        adjustmentsQuery = adjustmentsQuery.eq("store_id", storeIdForStock)
      }
      
      const { data: adjustmentsData } = await adjustmentsQuery

      if (adjustmentsData) {
        // Fetch user data separately
        const userIds = Array.from(new Set(adjustmentsData.map((a: any) => a.user_id).filter(Boolean)))
        const userMap: Record<string, { email: string; full_name: string }> = {}

        if (userIds.length > 0) {
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
        }

        const adjustments: StockAdjustment[] = adjustmentsData.map((a: any) => ({
          id: a.id,
          product_id: a.product_id,
          product_name: a.products?.name || "Unknown Product",
          quantity_change: a.quantity_change,
          type: a.type,
          created_at: a.created_at,
          user_name: userMap[a.user_id]?.full_name || userMap[a.user_id]?.email || "Unknown User",
        }))

        setRecentAdjustments(adjustments)
      }

      // Load top-selling items (last 30 days)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // Load sales - filter by store if active store is set
      // Use payment_status = "paid" instead of status = "completed"
      let salesQuery = supabase
        .from("sales")
        .select("id")
        .eq("business_id", businessData.id)
        .eq("payment_status", "paid")
        .gte("created_at", thirtyDaysAgo.toISOString())
      
      if (storeIdForStock) {
        salesQuery = salesQuery.eq("store_id", storeIdForStock)
      }
      
      const { data: salesData } = await salesQuery

      if (salesData && salesData.length > 0) {
        const saleIds = salesData.map((s) => s.id)

        const { data: saleItemsData } = await supabase
          .from("sale_items")
          .select("product_id, qty, price, cost_price, cogs")
          .in("sale_id", saleIds)

        if (saleItemsData) {
          // Group by product_id and sum quantities, revenue, and COGS
          const productSales: Record<string, { quantity: number; revenue: number; cogs: number; product_name: string }> = {}

          saleItemsData.forEach((item: any) => {
            const productId = item.product_id
            const quantity = Number(item.qty) || 0 // sale_items uses 'qty' not 'quantity'
            const unitPrice = Number(item.price) || 0 // sale_items uses 'price' not 'unit_price'
            const itemCogs = Number(item.cogs) || 0

            if (productId) {
              if (!productSales[productId]) {
                productSales[productId] = {
                  quantity: 0,
                  revenue: 0,
                  cogs: 0,
                  product_name: "",
                }
              }
              productSales[productId].quantity += quantity
              productSales[productId].revenue += quantity * unitPrice
              productSales[productId].cogs += itemCogs
            }
          })

          // Get product names
          const productIds = Object.keys(productSales)
          if (productIds.length > 0) {
            const { data: productsForSales } = await supabase
              .from("products")
              .select("id, name")
              .in("id", productIds)

            if (productsForSales) {
              productsForSales.forEach((p) => {
                if (productSales[p.id]) {
                  productSales[p.id].product_name = p.name
                }
              })
            }
          }

          // Convert to array and sort by quantity, calculate gross profit
          const topSelling: TopSellingItem[] = Object.entries(productSales)
            .map(([product_id, data]) => ({
              product_id,
              product_name: data.product_name || "Unknown Product",
              units_sold: data.quantity,
              revenue: data.revenue,
              cogs: data.cogs,
              gross_profit: data.revenue - data.cogs,
            }))
            .sort((a, b) => b.units_sold - a.units_sold)
            .slice(0, 5)

          setTopSellingItems(topSelling)
        }
      }

      // Calculate Daily and Monthly Gross Profit
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

      // Daily sales - filter by store if active store is set
      // Use payment_status = "paid" instead of status = "completed"
      let dailySalesQuery = supabase
        .from("sales")
        .select("id")
        .eq("business_id", businessData.id)
        .eq("payment_status", "paid")
        .gte("created_at", today.toISOString())
      
      if (storeIdForStock) {
        dailySalesQuery = dailySalesQuery.eq("store_id", storeIdForStock)
      }
      
      const { data: dailySalesData } = await dailySalesQuery

      if (dailySalesData && dailySalesData.length > 0) {
        const dailySaleIds = dailySalesData.map((s) => s.id)
        const { data: dailyItemsData } = await supabase
          .from("sale_items")
          .select("price, qty, cogs")
          .in("sale_id", dailySaleIds)

        if (dailyItemsData) {
          const dailyRevenue = dailyItemsData.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0)
          const dailyCogsTotal = dailyItemsData.reduce((sum, item) => sum + (Number(item.cogs) || 0), 0)
          setDailyRevenue(dailyRevenue)
          setDailyCogs(dailyCogsTotal)
          setDailyGrossProfit(dailyRevenue - dailyCogsTotal)
        }
      }

      // Monthly sales - filter by store if active store is set
      // Use payment_status = "paid" instead of status = "completed"
      let monthlySalesQuery = supabase
        .from("sales")
        .select("id")
        .eq("business_id", businessData.id)
        .eq("payment_status", "paid")
        .gte("created_at", monthStart.toISOString())
      
      if (storeIdForStock) {
        monthlySalesQuery = monthlySalesQuery.eq("store_id", storeIdForStock)
      }
      
      const { data: monthlySalesData } = await monthlySalesQuery

      if (monthlySalesData && monthlySalesData.length > 0) {
        const monthlySaleIds = monthlySalesData.map((s) => s.id)
        const { data: monthlyItemsData } = await supabase
          .from("sale_items")
          .select("price, qty, cogs")
          .in("sale_id", monthlySaleIds)

        if (monthlyItemsData) {
          const monthlyRevenue = monthlyItemsData.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0)
          const monthlyCogsTotal = monthlyItemsData.reduce((sum, item) => sum + (Number(item.cogs) || 0), 0)
          setMonthlyRevenue(monthlyRevenue)
          setMonthlyCogs(monthlyCogsTotal)
          setMonthlyGrossProfit(monthlyRevenue - monthlyCogsTotal)
        }
      }

      setLoading(false)
    } catch (err: any) {
      setError(err.message || "Failed to load inventory dashboard")
      setLoading(false)
    }
  }

  const { format } = useBusinessCurrency()
  const formatCurrency = (amount: number) => format(amount)

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  }

  const getAdjustmentTypeLabel = (type: string, quantityChange: number) => {
    if (type === "adjustment") {
      if (quantityChange > 0) return "Add Stock"
      if (quantityChange < 0) return "Remove Stock"
      return "Correct Stock"
    }
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  if (!hasAccess && !loading) {
    return (
      <>
        <div className="p-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error || "Access denied"}
          </div>
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="p-6">
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
        <div className="mb-6">
          <button
            onClick={() => router.push("/retail/dashboard")}
            className="text-blue-600 hover:underline mb-4"
          >
            ← Back to Dashboard
          </button>
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold">Inventory Dashboard</h1>
            {business?.default_currency && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                All amounts in {business.default_currency}
              </p>
            )}
          </div>
          <p className="text-gray-600">Comprehensive inventory analytics and insights</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-center">
            <p>Loading inventory dashboard...</p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {/* Total Inventory Value - Large Card */}
              <div className="md:col-span-2 lg:col-span-1 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg p-6 shadow-lg">
                <div className="text-sm font-medium opacity-90 mb-1">Total Inventory Value</div>
                <div className="text-3xl font-bold">{formatCurrency(kpis.totalInventoryValue)}</div>
                <div className="text-sm opacity-75 mt-2">Based on current stock and selling prices</div>
              </div>

              {/* Total Products */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 mb-1">Total Products</div>
                <div className="text-2xl font-bold text-gray-900">{kpis.totalProducts}</div>
              </div>

              {/* Total Categories */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 mb-1">Total Categories</div>
                <div className="text-2xl font-bold text-gray-900">{kpis.totalCategories}</div>
              </div>

              {/* Total Stock Units */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 shadow">
                <div className="text-sm text-gray-600 mb-1">Total Stock Units</div>
                <div className="text-2xl font-bold text-gray-900">{kpis.totalStockUnits.toLocaleString()}</div>
              </div>

              {/* Out of Stock Count */}
              <div className="bg-white border border-red-200 rounded-lg p-4 shadow">
                <div className="text-sm text-red-600 mb-1">Out of Stock Items</div>
                <div className="text-2xl font-bold text-red-600">{kpis.outOfStockCount}</div>
              </div>

              {/* Low Stock Count */}
              <div className="bg-white border border-yellow-200 rounded-lg p-4 shadow">
                <div className="text-sm text-yellow-600 mb-1">Low Stock Items</div>
                <div className="text-2xl font-bold text-yellow-600">{kpis.lowStockCount}</div>
              </div>
            </div>

            {/* Profit Analytics */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow">
              <h2 className="text-lg font-semibold mb-3">Profit Analytics</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-green-50 border border-green-200 rounded p-4">
                  <div className="text-sm text-green-700 mb-1">Daily Gross Profit</div>
                  <div className="text-2xl font-bold text-green-800">{formatCurrency(dailyGrossProfit)}</div>
                  <div className="text-xs text-green-600 mt-1">
                    Revenue: {formatCurrency(dailyRevenue)} | COGS: {formatCurrency(dailyCogs)}
                  </div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded p-4">
                  <div className="text-sm text-blue-700 mb-1">Monthly Gross Profit</div>
                  <div className="text-2xl font-bold text-blue-800">{formatCurrency(monthlyGrossProfit)}</div>
                  <div className="text-xs text-blue-600 mt-1">
                    Revenue: {formatCurrency(monthlyRevenue)} | COGS: {formatCurrency(monthlyCogs)}
                  </div>
                </div>
              </div>
            </div>

            {/* Low Stock Overview */}
            <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 shadow">
              <h2 className="text-lg font-semibold mb-3">Low-Stock Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded p-4">
                  <div className="text-sm text-yellow-700 mb-1">Low Stock Items</div>
                  <div className="text-2xl font-bold text-yellow-800">{lowStockCount}</div>
                  <div className="text-xs text-yellow-600 mt-1">Items below threshold</div>
                </div>
                <div className="bg-red-50 border border-red-200 rounded p-4">
                  <div className="text-sm text-red-700 mb-1">Out of Stock Items</div>
                  <div className="text-2xl font-bold text-red-800">{outOfStockCount}</div>
                  <div className="text-xs text-red-600 mt-1">Items with zero stock</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Out of Stock List */}
              <div className="bg-white border border-gray-200 rounded-lg shadow">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold">Out of Stock Items</h2>
                </div>
                {outOfStockProducts.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    <p>No out of stock items</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stock</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {outOfStockProducts.map((product) => (
                          <tr key={product.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{product.name}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{product.barcode || "-"}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{product.category_name || "Uncategorized"}</td>
                            <td className="px-4 py-3 text-sm text-red-600 font-semibold">0</td>
                            <td className="px-4 py-3 text-sm">
                              <a
                                href={`/products`}
                                className="text-blue-600 hover:underline"
                              >
                                View
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recently Adjusted Items */}
              <div className="bg-white border border-gray-200 rounded-lg shadow">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold">Recently Adjusted Items</h2>
                </div>
                {recentAdjustments.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    <p>No recent adjustments</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Staff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {recentAdjustments.map((adjustment) => (
                          <tr key={adjustment.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">{adjustment.product_name}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{getAdjustmentTypeLabel(adjustment.type, adjustment.quantity_change)}</td>
                            <td className="px-4 py-3 text-sm text-right">
                              <span className={adjustment.quantity_change > 0 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                                {adjustment.quantity_change > 0 ? "+" : ""}
                                {adjustment.quantity_change}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{formatDate(adjustment.created_at)}</td>
                            <td className="px-4 py-3 text-sm text-gray-600">{adjustment.user_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Top Selling Items */}
            <div className="bg-white border border-gray-200 rounded-lg shadow">
              <div className="p-4 border-b border-gray-200">
                <h2 className="text-lg font-semibold">Top-Selling Items (Last 30 Days)</h2>
              </div>
              {topSellingItems.length === 0 ? (
                <div className="p-6 text-center text-gray-500">
                  <p>No sales data available for the last 30 days</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Units Sold</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Revenue</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">COGS</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {topSellingItems.map((item) => (
                        <tr key={item.product_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.product_name}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-600">{item.units_sold.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">{formatCurrency(item.revenue)}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-600">
                            {item.cogs > 0 ? formatCurrency(item.cogs) : "-"}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-semibold">
                            {item.gross_profit > 0 ? (
                              <span className="text-green-600">{formatCurrency(item.gross_profit)}</span>
                            ) : item.cogs > 0 ? (
                              <span className="text-red-600">{formatCurrency(item.gross_profit)}</span>
                            ) : (
                              "-"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}

