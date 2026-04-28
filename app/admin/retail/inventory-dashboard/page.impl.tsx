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
import { retailPaths } from "@/lib/retail/routes"
import {
  RetailBackofficeAlert,
  RetailBackofficeBackLink,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
} from "@/components/retail/RetailBackofficeUi"

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
  variant_id?: string | null
  variant_name?: string | null
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
  /** Stock × selling price (retail extension). */
  totalRetailInventoryValue: number
  /** Sum of on-hand extended cost at AVCO (per stock row: qty × average_cost). */
  totalCostInventoryValue: number
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
    totalRetailInventoryValue: 0,
    totalCostInventoryValue: 0,
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
        .select("product_id, variant_id, stock, stock_quantity, store_id, average_cost")
        .in("product_id", productsData.map((p: any) => p.id))

      if (storeIdForStock) {
        stockQuery = stockQuery.eq("store_id", storeIdForStock)
      }
      // If storeIdForStock is null (activeStoreId is "all" or not set), aggregate across all stores

      const { data: stockData } = await stockQuery

      const { data: variantsData } = await supabase
        .from("products_variants")
        .select("id, product_id, variant_name, price, barcode")
        .in("product_id", productsData.map((x: { id: string }) => x.id))

      const variantsByProduct = new Map<
        string,
        Array<{
          id: string
          variant_name: string
          price: number | null
          barcode: string | null
        }>
      >()
      const productIdsWithVariants = new Set<string>()
      for (const v of variantsData || []) {
        productIdsWithVariants.add(v.product_id)
        if (!variantsByProduct.has(v.product_id)) {
          variantsByProduct.set(v.product_id, [])
        }
        variantsByProduct.get(v.product_id)!.push({
          id: v.id,
          variant_name: v.variant_name,
          price: v.price != null ? Number(v.price) : null,
          barcode: v.barcode ?? null,
        })
      }

      const parentStockMap: Record<string, number> = {}
      const variantStockMap: Record<string, number> = {}
      const parentExtendedCostMap: Record<string, number> = {}
      const variantExtendedCostMap: Record<string, number> = {}
      if (stockData) {
        stockData.forEach((s: any) => {
          const rowQty =
            s.stock_quantity !== null && s.stock_quantity !== undefined
              ? Number(s.stock_quantity)
              : s.stock !== null && s.stock !== undefined
                ? Number(s.stock)
                : 0
          const rowAvgCost = Number(s.average_cost ?? 0) || 0
          const rowExtendedCost = rowQty * rowAvgCost
          if (s.variant_id) {
            variantStockMap[s.variant_id] = (variantStockMap[s.variant_id] || 0) + rowQty
            variantExtendedCostMap[s.variant_id] = (variantExtendedCostMap[s.variant_id] || 0) + rowExtendedCost
          } else {
            parentStockMap[s.product_id] = (parentStockMap[s.product_id] || 0) + rowQty
            parentExtendedCostMap[s.product_id] = (parentExtendedCostMap[s.product_id] || 0) + rowExtendedCost
          }
        })
      }

      // Calculate KPIs
      let totalRetailInventoryValue = 0
      let totalCostInventoryValue = 0
      let totalStockUnits = 0
      let outOfStock = 0
      let lowStock = 0
      const outOfStockList: Array<Product & { category_name?: string }> = []

      productsData.forEach((p: any) => {
        const basePrice = Number(p.price) || 0
        const threshold =
          p.low_stock_threshold !== null && p.low_stock_threshold !== undefined
            ? Number(p.low_stock_threshold)
            : 5

        if (productIdsWithVariants.has(p.id)) {
          const vlist = variantsByProduct.get(p.id) || []
          for (const v of vlist) {
            const stockQty = Math.floor(variantStockMap[v.id] ?? 0)
            const unitPrice = v.price != null && !Number.isNaN(v.price) ? Number(v.price) : basePrice

            if (p.track_stock !== false) {
              totalRetailInventoryValue += stockQty * unitPrice
              totalCostInventoryValue += variantExtendedCostMap[v.id] ?? 0
              totalStockUnits += stockQty
            }

            const stockStatus = getStockStatus(stockQty, threshold, p.track_stock)
            if (stockStatus.status === "out_of_stock") {
              outOfStock++
              outOfStockList.push({
                id: p.id,
                name: `${p.name} · ${v.variant_name}`,
                price: unitPrice,
                stock_quantity: stockQty,
                stock: stockQty,
                barcode: v.barcode || p.barcode,
                category_id: p.category_id,
                category_name: p.categories?.name || "Uncategorized",
                variant_id: v.id,
                variant_name: v.variant_name,
              })
            } else if (stockStatus.status === "low_stock") {
              lowStock++
            }
          }
          return
        }

        const stockQty = Math.floor(
          parentStockMap[p.id] !== undefined
            ? parentStockMap[p.id]
            : p.stock_quantity !== null && p.stock_quantity !== undefined
              ? Number(p.stock_quantity)
              : p.stock !== null && p.stock !== undefined
                ? Number(p.stock)
                : 0
        )
        const price = basePrice

        if (p.track_stock !== false) {
          totalRetailInventoryValue += stockQty * price
          totalCostInventoryValue += parentExtendedCostMap[p.id] ?? 0
          totalStockUnits += stockQty
        }

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
        totalRetailInventoryValue,
        totalCostInventoryValue,
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
      <RetailBackofficeShell>
        <RetailBackofficeMain>
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error || "Access denied"}
          </RetailBackofficeAlert>
          <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.dashboard)}>
            Back to dashboard
          </RetailBackofficeButton>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain>
        {!business?.default_currency && (
          <RetailBackofficeAlert tone="warning" className="mb-6">
            <p className="font-medium text-amber-950">Currency not configured</p>
            <p className="mt-1 text-sm text-amber-950/90">
              Set your business currency in Business Profile so amounts display correctly.
            </p>
            <RetailBackofficeButton
              variant="secondary"
              className="mt-4"
              onClick={() => router.push(retailPaths.settingsBusinessProfile)}
            >
              Open business profile
            </RetailBackofficeButton>
          </RetailBackofficeAlert>
        )}

        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.dashboard)}>Back to dashboard</RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Product & inventory"
          title="Inventory overview"
          description="Stock health, retail and cost value (AVCO), and recent operational signals for the selected store."
          actions={
            business?.default_currency ? (
              <span className="text-xs font-medium text-slate-500">All amounts · {business.default_currency}</span>
            ) : null
          }
        />

        <div className="mb-8 flex flex-wrap gap-2">
          <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.inventory)}>
            Inventory
          </RetailBackofficeButton>
          <RetailBackofficeButton variant="secondary" onClick={() => router.push("/retail/admin/low-stock")}>
            Low stock
          </RetailBackofficeButton>
          <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.products)}>
            Products
          </RetailBackofficeButton>
          <RetailBackofficeButton variant="secondary" onClick={() => router.push(retailPaths.inventoryHistory)}>
            Movement history
          </RetailBackofficeButton>
        </div>

        {error ? (
          <RetailBackofficeAlert tone="error" className="mb-4">
            {error}
          </RetailBackofficeAlert>
        ) : null}

        {loading ? (
          <RetailBackofficeCard className="text-center text-sm text-slate-600">Loading dashboard…</RetailBackofficeCard>
        ) : (
          <>
            <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <RetailBackofficeCard
                padding="p-6"
                className="border-slate-300/90 bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-md md:col-span-2 lg:col-span-1"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-white/70">Retail inventory value</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
                  {formatCurrency(kpis.totalRetailInventoryValue)}
                </p>
                <p className="mt-3 text-sm text-white/75">On-hand quantity × selling price</p>
                <div className="mt-5 border-t border-white/15 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-white/70">Cost inventory value</p>
                  <p
                    className={`mt-2 text-2xl font-semibold tracking-tight tabular-nums ${
                      kpis.totalCostInventoryValue === 0 ? "text-white/50" : ""
                    }`}
                  >
                    {formatCurrency(kpis.totalCostInventoryValue)}
                  </p>
                  <p className="mt-2 text-sm text-white/75">Extended at average cost (AVCO) per stock row</p>
                </div>
              </RetailBackofficeCard>

              <RetailBackofficeCard>
                <p className="text-xs font-medium text-slate-500">Products</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{kpis.totalProducts}</p>
              </RetailBackofficeCard>

              <RetailBackofficeCard>
                <p className="text-xs font-medium text-slate-500">Categories</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{kpis.totalCategories}</p>
              </RetailBackofficeCard>

              <RetailBackofficeCard>
                <p className="text-xs font-medium text-slate-500">Stock units</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {kpis.totalStockUnits.toLocaleString()}
                </p>
              </RetailBackofficeCard>

              <RetailBackofficeCard className="border-rose-200/80 bg-rose-50/40">
                <p className="text-xs font-medium text-rose-900/80">Out of stock</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-rose-950 tabular-nums">{kpis.outOfStockCount}</p>
              </RetailBackofficeCard>

              <RetailBackofficeCard className="border-amber-200/80 bg-amber-50/40">
                <p className="text-xs font-medium text-amber-950/80">Low stock</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight text-amber-950 tabular-nums">{kpis.lowStockCount}</p>
              </RetailBackofficeCard>
            </div>

            <RetailBackofficeCard className="mb-8">
              <RetailBackofficeCardTitle className="mb-4">Profit snapshot</RetailBackofficeCardTitle>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                  <p className="text-xs font-medium text-slate-500">Daily gross profit</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                    {formatCurrency(dailyGrossProfit)}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    Revenue {formatCurrency(dailyRevenue)} · COGS {formatCurrency(dailyCogs)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                  <p className="text-xs font-medium text-slate-500">Monthly gross profit</p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
                    {formatCurrency(monthlyGrossProfit)}
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                    Revenue {formatCurrency(monthlyRevenue)} · COGS {formatCurrency(monthlyCogs)}
                  </p>
                </div>
              </div>
            </RetailBackofficeCard>

            <RetailBackofficeCard className="mb-8">
              <RetailBackofficeCardTitle className="mb-4">Attention needed</RetailBackofficeCardTitle>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-amber-200/70 bg-amber-50/30 p-4">
                  <p className="text-xs font-medium text-amber-950/80">Below threshold</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-950 tabular-nums">{lowStockCount}</p>
                </div>
                <div className="rounded-xl border border-rose-200/70 bg-rose-50/30 p-4">
                  <p className="text-xs font-medium text-rose-950/80">Zero on hand</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-950 tabular-nums">{outOfStockCount}</p>
                </div>
              </div>
            </RetailBackofficeCard>

            <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <RetailBackofficeCard padding="p-0" className="overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <RetailBackofficeCardTitle>Out of stock</RetailBackofficeCardTitle>
                  <p className="mt-1 text-xs text-slate-500">Zero on-hand for tracked products</p>
                </div>
                {outOfStockProducts.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500">No out-of-stock SKUs</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px]">
                      <thead className="border-b border-slate-100 bg-slate-50/80">
                        <tr>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Product
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Barcode
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Category
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Stock
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {outOfStockProducts.map((product) => (
                          <tr
                            key={product.variant_id ? `${product.id}-${product.variant_id}` : product.id}
                            className="transition-colors hover:bg-slate-50/60"
                          >
                            <td className="px-4 py-3 text-sm font-medium text-slate-900">{product.name}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">{product.barcode || "—"}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">{product.category_name || "Uncategorized"}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-rose-800 tabular-nums">0</td>
                            <td className="px-4 py-3 text-sm">
                              <RetailBackofficeButton
                                variant="ghost"
                                className="text-xs"
                                onClick={() => router.push(retailPaths.productEdit(product.id))}
                              >
                                Edit
                              </RetailBackofficeButton>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </RetailBackofficeCard>

              <RetailBackofficeCard padding="p-0" className="overflow-hidden">
                <div className="border-b border-slate-100 px-5 py-4">
                  <RetailBackofficeCardTitle>Recent adjustments</RetailBackofficeCardTitle>
                  <p className="mt-1 text-xs text-slate-500">Latest logged stock changes</p>
                </div>
                {recentAdjustments.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500">No recent adjustments</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px]">
                      <thead className="border-b border-slate-100 bg-slate-50/80">
                        <tr>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Product
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Type
                          </th>
                          <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Qty
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Date
                          </th>
                          <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            Staff
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recentAdjustments.map((adjustment) => (
                          <tr key={adjustment.id} className="transition-colors hover:bg-slate-50/60">
                            <td className="px-4 py-3 text-sm text-slate-900">{adjustment.product_name}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">
                              {getAdjustmentTypeLabel(adjustment.type, adjustment.quantity_change)}
                            </td>
                            <td className="px-4 py-3 text-right text-sm tabular-nums">
                              <span
                                className={
                                  adjustment.quantity_change > 0
                                    ? "font-semibold text-emerald-800"
                                    : "font-semibold text-rose-800"
                                }
                              >
                                {adjustment.quantity_change > 0 ? "+" : ""}
                                {adjustment.quantity_change}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{formatDate(adjustment.created_at)}</td>
                            <td className="px-4 py-3 text-sm text-slate-600">{adjustment.user_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </RetailBackofficeCard>
            </div>

            <RetailBackofficeCard padding="p-0" className="overflow-hidden">
              <div className="border-b border-slate-100 px-5 py-4">
                <RetailBackofficeCardTitle>Top sellers (30 days)</RetailBackofficeCardTitle>
                <p className="mt-1 text-xs text-slate-500">By units sold</p>
              </div>
              {topSellingItems.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">No sales in the last 30 days</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead className="border-b border-slate-100 bg-slate-50/80">
                      <tr>
                        <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Product
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Units
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Revenue
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          COGS
                        </th>
                        <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          Gross profit
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topSellingItems.map((item) => (
                        <tr key={item.product_id} className="transition-colors hover:bg-slate-50/60">
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">{item.product_name}</td>
                          <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-600">
                            {item.units_sold.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
                            {formatCurrency(item.revenue)}
                          </td>
                          <td className="px-4 py-3 text-right text-sm tabular-nums text-slate-600">
                            {item.cogs > 0 ? formatCurrency(item.cogs) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right text-sm font-semibold tabular-nums">
                            {item.gross_profit > 0 ? (
                              <span className="text-emerald-800">{formatCurrency(item.gross_profit)}</span>
                            ) : item.cogs > 0 ? (
                              <span className="text-rose-800">{formatCurrency(item.gross_profit)}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </RetailBackofficeCard>
          </>
        )}
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}

