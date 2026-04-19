"use client"

import { useState, useEffect, useMemo, type ReactNode } from "react"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { getUserStore, getStores } from "@/lib/stores"
import { getActiveStoreId } from "@/lib/storeSession"
import { useRouteGuard } from "@/lib/useRouteGuard"
import { normalizeCountry } from "@/lib/payments/eligibility"
import { useBusinessCurrency } from "@/lib/hooks/useBusinessCurrency"
import { retailPaths } from "@/lib/retail/routes"
import {
  RetailBackofficeBackLink,
  RetailBackofficeButton,
  RetailBackofficeCard,
  RetailBackofficeCardTitle,
  RetailBackofficeMain,
  RetailBackofficePageHeader,
  RetailBackofficeShell,
  retailFieldClass,
  retailLabelClass,
  RetailMenuSelect,
  type MenuSelectOption,
} from "@/components/retail/RetailBackofficeUi"
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

type DateRange = "today" | "yesterday" | "last7" | "last30" | "custom"

const ANALYTICS_DATE_RANGE_OPTIONS: MenuSelectOption[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "custom", label: "Custom range" },
]

const ANALYTICS_CHART_METRIC_OPTIONS: MenuSelectOption[] = [
  { value: "all", label: "All metrics" },
  { value: "revenue", label: "Revenue only" },
  { value: "cogs", label: "COGS only" },
  { value: "profit", label: "Gross profit only" },
]

type KPIData = {
  totalSales: number
  totalTransactions: number
  averageSaleValue: number
  totalCogs: number
  grossProfit: number
  grossMarginPercent: number
  totalVat: number
}

type DailyData = {
  date: string
  revenue: number
  cogs: number
  grossProfit: number
}

type TopProduct = {
  product_id: string
  variant_id: string | null
  product_name: string
  variant_name: string | null
  units_sold: number
  revenue: number
  gross_profit: number
}

type PaymentBreakdown = {
  method: string
  revenue: number
  percentage: number
}

type StaffPerformance = {
  user_id: string
  staff_name: string
  sales_count: number
  total_revenue: number
  total_gross_profit: number
  average_sale_value: number
}

type RegisterSession = {
  id: string
  store_name: string | null
  register_name: string
  started_at: string
  cashier_name: string
  sales_total: number
  variance: number
}

const COLORS = ["#0f766e", "#0369a1", "#4f46e5", "#b45309", "#64748b", "#be185d"]

const chartTooltipStyle = {
  borderRadius: 12,
  border: "1px solid rgb(226 232 240)",
  boxShadow: "0 4px 24px rgba(15, 23, 42, 0.06)",
}

const chartGridColor = "#e2e8f0"
const chartAxisColor = "#64748b"

export default function AnalyticsPage() {
  const router = useRouter()
  useRouteGuard()
  const { format } = useBusinessCurrency()
  
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [businessId, setBusinessId] = useState("")
  const [userRole, setUserRole] = useState<string | null>(null)
  const [userStoreId, setUserStoreId] = useState<string | null>(null)
  const [stores, setStores] = useState<any[]>([])
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [dateRange, setDateRange] = useState<DateRange>("last30")
  const [customStartDate, setCustomStartDate] = useState("")
  const [customEndDate, setCustomEndDate] = useState("")

  // Data states
  const [kpiData, setKpiData] = useState<KPIData>({
    totalSales: 0,
    totalTransactions: 0,
    averageSaleValue: 0,
    totalCogs: 0,
    grossProfit: 0,
    grossMarginPercent: 0,
    totalVat: 0,
  })
  const [dailyData, setDailyData] = useState<DailyData[]>([])
  const [topProducts, setTopProducts] = useState<TopProduct[]>([])
  const [paymentBreakdown, setPaymentBreakdown] = useState<PaymentBreakdown[]>([])
  const [staffPerformance, setStaffPerformance] = useState<StaffPerformance[]>([])
  const [registerSessions, setRegisterSessions] = useState<RegisterSession[]>([])
  const [inventoryValue, setInventoryValue] = useState(0)
  const [inventoryAging, setInventoryAging] = useState<any>(null)
  const [businessCountry, setBusinessCountry] = useState<string | null>(null)

  const [chartMetric, setChartMetric] = useState<"revenue" | "cogs" | "profit" | "all">("all")

  const storeMenuOptions = useMemo(() => {
    const head: MenuSelectOption[] = [{ value: "", label: "All stores" }]
    return head.concat(stores.map((s: { id: string; name: string }) => ({ value: s.id, label: s.name })))
  }, [stores])

  useEffect(() => {
    loadInitialData()
  }, [])

  useEffect(() => {
    if (businessId) {
      loadAnalytics()
    }
    
    // Reload when store changes
    const handleStoreChange = () => {
      if (businessId) {
        loadAnalytics()
      }
    }
    
    window.addEventListener('storeChanged', handleStoreChange)
    
    return () => {
      window.removeEventListener('storeChanged', handleStoreChange)
    }
  }, [businessId, selectedStoreId, dateRange, customStartDate, customEndDate])

  const loadInitialData = async () => {
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

      setBusinessId(business.id)
      
      // Load business country for payment method filtering
      const { data: businessData } = await supabase
        .from("businesses")
        .select("address_country")
        .eq("id", business.id)
        .single()
      
      setBusinessCountry(businessData?.address_country || null)

      const role = await getUserRole(supabase, user.id, business.id)
      setUserRole(role)

      // Get active store from session (prioritize) or fallback to user's store assignment
      const activeStoreId = getActiveStoreId()
      const userStoreId = await getUserStore(supabase, business.id, user.id)
      
      setUserStoreId(userStoreId)

      // Load stores if superadmin
      if (role === "owner" || role === "admin") {
        const allStores = await getStores(supabase, business.id)
        setStores(allStores)
        // Use active store from session, or "All Stores" by default
        setSelectedStoreId(activeStoreId || null)
      } else {
        // Store-bound users: use active store or their assigned store
        setSelectedStoreId(activeStoreId || userStoreId)
      }
      
      // Listen for store changes
      const handleStoreChange = (e: CustomEvent) => {
        if (role === "owner" || role === "admin") {
          setSelectedStoreId(e.detail.storeId || null)
        } else {
          setSelectedStoreId(e.detail.storeId || userStoreId)
        }
      }
      
      window.addEventListener('storeChanged', handleStoreChange as EventListener)
      
      return () => {
        window.removeEventListener('storeChanged', handleStoreChange as EventListener)
      }
    } catch (err: any) {
      console.error("Error loading initial data:", err)
    } finally {
      setLoading(false)
    }
  }

  const getDateRangeFilter = () => {
    const now = new Date()
    let startDate: Date
    let endDate: Date = new Date(now)

    switch (dateRange) {
      case "today":
        startDate = new Date(now)
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(23, 59, 59, 999)
        break
      case "yesterday":
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 1)
        startDate.setHours(0, 0, 0, 0)
        endDate = new Date(startDate)
        endDate.setHours(23, 59, 59, 999)
        break
      case "last7":
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 7)
        startDate.setHours(0, 0, 0, 0)
        break
      case "last30":
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 30)
        startDate.setHours(0, 0, 0, 0)
        break
      case "custom":
        if (customStartDate && customEndDate) {
          startDate = new Date(customStartDate)
          startDate.setHours(0, 0, 0, 0)
          endDate = new Date(customEndDate)
          endDate.setHours(23, 59, 59, 999)
        } else {
          startDate = new Date(now)
          startDate.setDate(startDate.getDate() - 30)
          startDate.setHours(0, 0, 0, 0)
        }
        break
      default:
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 30)
        startDate.setHours(0, 0, 0, 0)
    }

    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
    }
  }

  const loadAnalytics = async () => {
    if (!businessId) return

    try {
      const dateFilter = getDateRangeFilter()

      // Build store filter - prioritize active_store_id from session
      const activeStoreId = getActiveStoreId()
      // If activeStoreId is "all", don't filter (aggregate all stores)
      // If activeStoreId is a specific store ID, filter by that
      // Otherwise, use selectedStoreId
      // NEVER use userStoreId if activeStoreId is set - session is single source of truth
      const storeFilter = activeStoreId === 'all' 
        ? null 
        : (activeStoreId || (selectedStoreId !== null ? selectedStoreId : null))

      // Load sales in date range
      // NOTE: store_id column may not exist in sales table yet
      // Start with minimal columns that definitely exist
      // CRITICAL: Only query Ghana tax columns (nhil, getfund, covid) for GH businesses
      const countryCode = normalizeCountry(businessCountry)
      const isGhana = countryCode === "GH"
      const salesColumns = isGhana 
        ? "id, amount, created_at, user_id, payment_method, vat, nhil, getfund, covid"
        : "id, amount, created_at, user_id, payment_method, vat"
      
      let salesQuery = supabase
        .from("sales")
        .select(salesColumns)
        .eq("business_id", businessId)
        .eq("payment_status", "paid")
        .gte("created_at", dateFilter.start)
        .lte("created_at", dateFilter.end)
      
      // Try to add store_id to select, but handle if column doesn't exist
      // We'll add it conditionally after testing the basic query

      // Only filter by store_id if a specific store is selected
      // If storeFilter is null (owner/admin viewing "all stores"), don't filter
      // CRITICAL ISSUE: If sales don't have store_id set (old sales), they won't show when filtering by store
      // Solution: When storeFilter is set, we need to check if sales have store_id
      // For now, filter by store_id if set, but this means old sales without store_id won't show
      if (storeFilter) {
        // Filter by the specific store
        // NOTE: This will exclude sales with null store_id (old sales created before multi-store)
        // To include old sales, we'd need: .or(`store_id.eq.${storeFilter},store_id.is.null`)
        // But that's not ideal - better to ensure all sales have store_id
        salesQuery = salesQuery.eq("store_id", storeFilter)
      }
      // Note: If storeFilter is null, we include all sales across all stores (including null store_id)

      // Execute the basic query first (without store_id and payment_status filters)
      let sales: any[] | null = null
      let salesQueryError: any = null

      const queryResult = await salesQuery
      sales = queryResult.data
      salesQueryError = queryResult.error

      if (salesQueryError) {
        // Try to get more error info
        const errorStr = JSON.stringify(salesQueryError, Object.getOwnPropertyNames(salesQueryError))
        console.error("Error loading sales:", errorStr)
        
        // If it's a column error, try without that column
        if (salesQueryError.code === "42703" || salesQueryError.message?.includes("does not exist")) {
          // Try with absolute minimal columns
          const { data: minimalData, error: minimalError } = await supabase
            .from("sales")
            .select("id, amount, created_at, user_id, payment_method")
            .eq("business_id", businessId)
            .eq("payment_status", "paid")
            .gte("created_at", dateFilter.start)
            .lte("created_at", dateFilter.end)
          
          if (!minimalError && minimalData) {
            sales = minimalData
            salesQueryError = null
          } else {
            console.error("Even minimal query failed:", minimalError)
          }
        }
      }
      
      // If we have sales, try to fetch additional columns we need
      if (sales && sales.length > 0 && !salesQueryError) {
        const saleIds = sales.map((s: any) => s.id)
        
        // Try to fetch additional columns, but handle if they don't exist
        let additionalColumns = "payment_lines, cash_amount, momo_amount, card_amount"
        
        // Try to include store_id and payment_status, but handle gracefully if they don't exist
        const { data: fullSalesData, error: fullError } = await supabase
          .from("sales")
          .select(`id, amount, created_at, user_id, payment_method, ${additionalColumns}`)
          .in("id", saleIds)
        
        if (!fullError && fullSalesData) {
          // Merge the additional data
          const salesMap = new Map(sales.map((s: any) => [s.id, s]))
          fullSalesData.forEach((fullSale: any) => {
            const existing = salesMap.get(fullSale.id)
            if (existing) {
              Object.assign(existing, fullSale)
            }
          })
          sales = Array.from(salesMap.values())
        }
        
        // Filter by store_id client-side if needed (and if column exists)
        if (storeFilter && sales) {
          // Only filter if store_id exists in the data
          const hasStoreId = sales.some((s: any) => s.store_id !== undefined)
          if (hasStoreId) {
            sales = sales.filter((s: any) => s.store_id === storeFilter)
          }
        }
      }

      if (!sales || sales.length === 0) {
        // Reset all data to empty
        setKpiData({
          totalSales: 0,
          totalTransactions: 0,
          averageSaleValue: 0,
          totalCogs: 0,
          grossProfit: 0,
          grossMarginPercent: 0,
          totalVat: 0,
        })
        setDailyData([])
        setTopProducts([])
        setPaymentBreakdown([])
        setStaffPerformance([])
        setRegisterSessions([])
        return
      }

      const saleIds = sales.map((s) => s.id)

      // Load sale items with COGS
      // Batch the query if there are too many sale IDs (Supabase has URL length limits)
      let saleItems: any[] = []
      const BATCH_SIZE = 100 // Process in batches of 100
      
      for (let i = 0; i < saleIds.length; i += BATCH_SIZE) {
        const batch = saleIds.slice(i, i + BATCH_SIZE)
        const { data: batchItems, error: itemsError } = await supabase
          .from("sale_items")
          .select("sale_id, product_id, variant_id, qty, price, cogs, name")
          .in("sale_id", batch)
        
        if (itemsError) {
          console.error(`Error loading sale items batch ${i / BATCH_SIZE + 1}:`, itemsError)
          // Continue with other batches even if one fails
        } else if (batchItems) {
          saleItems = saleItems.concat(batchItems)
        }
      }

      // Calculate KPIs
      // LEDGER-BASED: Revenue from journal_entry_lines (account code 4000) instead of sale_items
      let totalRevenue = 0
      let totalCogs = 0
      let totalVat = 0

      // Get Revenue account (code 4000) and query ledger for date range
      // dateFilter already defined at start of function
      const { data: revenueAccount } = await supabase
        .from("accounts")
        .select("id")
        .eq("business_id", businessId)
        .eq("code", "4000")
        .is("deleted_at", null)
        .single()

      if (revenueAccount) {
        // Convert ISO timestamps to date strings (YYYY-MM-DD) for journal_entries.date filtering
        const startDate = new Date(dateFilter.start).toISOString().split("T")[0]
        const endDate = new Date(dateFilter.end).toISOString().split("T")[0]

        const { data: revenueLines } = await supabase
          .from("journal_entry_lines")
          .select(
            `
            credit,
            journal_entries!inner (
              date,
              business_id
            )
          `
          )
          .eq("account_id", revenueAccount.id)
          .eq("journal_entries.business_id", businessId)
          .gte("journal_entries.date", startDate)
          .lte("journal_entries.date", endDate)

        if (revenueLines) {
          totalRevenue = revenueLines.reduce((sum: number, line: any) => sum + Number(line.credit || 0), 0)
        }
      }

      // COGS still calculated from sale_items (will be replaced in future)
      if (saleItems) {
        saleItems.forEach((item) => {
          totalCogs += Number(item.cogs || 0)
        })
      }

      // LEDGER-BASED: VAT from journal_entry_lines (account code 2100) instead of sales.tax_lines
      // Calculate opening balance, period movement, and closing balance
      const { data: vatAccount } = await supabase
        .from("accounts")
        .select("id, type")
        .eq("business_id", businessId)
        .eq("code", "2100")
        .is("deleted_at", null)
        .single()

      if (vatAccount) {
        const startDate = new Date(dateFilter.start).toISOString().split("T")[0]
        const endDate = new Date(dateFilter.end).toISOString().split("T")[0]

        // Opening balance: SUM(credit - debit) for entries before period start
        const { data: openingLines } = await supabase
          .from("journal_entry_lines")
          .select(
            `
            debit,
            credit,
            journal_entries!inner (
              date,
              business_id
            )
          `
          )
          .eq("account_id", vatAccount.id)
          .eq("journal_entries.business_id", businessId)
          .lt("journal_entries.date", startDate)

        let openingBalance = 0
        if (openingLines) {
          // For liability accounts: balance = credit - debit
          openingBalance = openingLines.reduce(
            (sum: number, line: any) => sum + Number(line.credit || 0) - Number(line.debit || 0),
            0
          )
        }

        // Period movement: SUM(credit - debit) for entries during period
        const { data: periodLines } = await supabase
          .from("journal_entry_lines")
          .select(
            `
            debit,
            credit,
            journal_entries!inner (
              date,
              business_id
            )
          `
          )
          .eq("account_id", vatAccount.id)
          .eq("journal_entries.business_id", businessId)
          .gte("journal_entries.date", startDate)
          .lte("journal_entries.date", endDate)

        let periodMovement = 0
        if (periodLines) {
          periodMovement = periodLines.reduce(
            (sum: number, line: any) => sum + Number(line.credit || 0) - Number(line.debit || 0),
            0
          )
        }

        // Closing balance = opening + movement
        const closingBalance = openingBalance + periodMovement
        
        // Use period movement as totalVat for KPI (represents tax liability for the period)
        totalVat = periodMovement
      }

      const grossProfit = totalRevenue - totalCogs
      const grossMarginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0

      setKpiData({
        totalSales: totalRevenue,
        totalTransactions: sales.length,
        averageSaleValue: sales.length > 0 ? totalRevenue / sales.length : 0,
        totalCogs,
        grossProfit,
        grossMarginPercent,
        totalVat,
      })

      // Daily data for chart
      // LEDGER-BASED: Daily revenue from journal_entry_lines grouped by date
      const dailyMap = new Map<string, { revenue: number; cogs: number }>()

      // Get daily revenue from ledger (grouped by journal_entries.date)
      if (revenueAccount) {
        const startDate = new Date(dateFilter.start).toISOString().split("T")[0]
        const endDate = new Date(dateFilter.end).toISOString().split("T")[0]

        const { data: dailyRevenueLines } = await supabase
          .from("journal_entry_lines")
          .select(
            `
            credit,
            journal_entries!inner (
              date,
              business_id
            )
          `
          )
          .eq("account_id", revenueAccount.id)
          .eq("journal_entries.business_id", businessId)
          .gte("journal_entries.date", startDate)
          .lte("journal_entries.date", endDate)

        if (dailyRevenueLines) {
          // Group revenue by date
          dailyRevenueLines.forEach((line: any) => {
            const entryDate = line.journal_entries?.date
            if (entryDate) {
              const dateKey = new Date(entryDate).toISOString().split("T")[0]
              const existing = dailyMap.get(dateKey) || { revenue: 0, cogs: 0 }
              dailyMap.set(dateKey, {
                revenue: existing.revenue + Number(line.credit || 0),
                cogs: existing.cogs, // COGS still from sale_items for now
              })
            }
          })
        }
      }

      // COGS still calculated from sale_items (grouped by sale date)
      sales.forEach((sale) => {
        const saleDate = new Date(sale.created_at).toISOString().split("T")[0]
        const saleItemsForSale = saleItems?.filter((item) => item.sale_id === sale.id) || []

        let dayCogs = 0
        saleItemsForSale.forEach((item) => {
          dayCogs += Number(item.cogs || 0)
        })

        const existing = dailyMap.get(saleDate) || { revenue: 0, cogs: 0 }
        dailyMap.set(saleDate, {
          revenue: existing.revenue, // Revenue already set from ledger
          cogs: existing.cogs + dayCogs,
        })
      })

      const dailyArray: DailyData[] = Array.from(dailyMap.entries())
        .map(([date, data]) => ({
          date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          revenue: data.revenue,
          cogs: data.cogs,
          grossProfit: data.revenue - data.cogs,
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

      setDailyData(dailyArray)

      // Top products
      const productMap = new Map<string, TopProduct>()

      if (saleItems) {
        saleItems.forEach((item) => {
          const key = `${item.product_id}_${item.variant_id || "base"}`
          const existing = productMap.get(key) || {
            product_id: item.product_id || "",
            variant_id: item.variant_id || null,
            product_name: item.name || "Unknown",
            variant_name: null,
            units_sold: 0,
            revenue: 0,
            gross_profit: 0,
          }

          existing.units_sold += Number(item.qty || 0)
          existing.revenue += Number(item.qty || 0) * Number(item.price || 0)
          existing.gross_profit +=
            Number(item.qty || 0) * Number(item.price || 0) - Number(item.cogs || 0)

          productMap.set(key, existing)
        })
      }

      // Load variant names
      const variantIds = Array.from(productMap.values())
        .map((p) => p.variant_id)
        .filter((id) => id) as string[]

      if (variantIds.length > 0) {
        const { data: variants } = await supabase
          .from("products_variants")
          .select("id, variant_name")
          .in("id", variantIds)

        if (variants) {
          const variantMap = new Map(variants.map((v) => [v.id, v.variant_name]))
          productMap.forEach((product) => {
            if (product.variant_id) {
              product.variant_name = variantMap.get(product.variant_id) || null
            }
          })
        }
      }

      const topProductsArray = Array.from(productMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)

      setTopProducts(topProductsArray)

      // Payment breakdown
      const paymentMap = new Map<string, number>()

      sales.forEach((sale) => {
        // Try to get payment breakdown from payment_lines or individual fields
        let paymentMethods: Array<{ method: string; amount: number }> = []

        if (sale.payment_lines) {
          try {
            const parsed =
              typeof sale.payment_lines === "string"
                ? JSON.parse(sale.payment_lines)
                : sale.payment_lines
            if (Array.isArray(parsed)) {
              paymentMethods = parsed.map((p: any) => ({
                method: p.method || sale.payment_method,
                amount: p.amount || sale.amount,
              }))
            }
          } catch {
            // Fallback
          }
        }

        if (paymentMethods.length === 0) {
          // Use individual payment fields
          if (sale.cash_amount && sale.cash_amount > 0) {
            paymentMethods.push({ method: "cash", amount: sale.cash_amount })
          }
          if (sale.momo_amount && sale.momo_amount > 0) {
            paymentMethods.push({ method: "momo", amount: sale.momo_amount })
          }
          if (sale.card_amount && sale.card_amount > 0) {
            paymentMethods.push({ method: "card", amount: sale.card_amount })
          }
          if (paymentMethods.length === 0) {
            paymentMethods.push({
              method: sale.payment_method || "cash",
              amount: sale.amount,
            })
          }
        }

        paymentMethods.forEach((pm) => {
          const existing = paymentMap.get(pm.method) || 0
          paymentMap.set(pm.method, existing + pm.amount)
        })
      })

      const totalPaymentRevenue = Array.from(paymentMap.values()).reduce((sum, val) => sum + val, 0)

      const paymentBreakdownArray: PaymentBreakdown[] = Array.from(paymentMap.entries())
        .map(([method, revenue]) => ({
          method: method.charAt(0).toUpperCase() + method.slice(1),
          revenue,
          percentage: totalPaymentRevenue > 0 ? (revenue / totalPaymentRevenue) * 100 : 0,
        }))
        .sort((a, b) => b.revenue - a.revenue)

      setPaymentBreakdown(paymentBreakdownArray)

      // Staff performance
      const staffMap = new Map<string, StaffPerformance>()

      const userIds = Array.from(new Set(sales.map((s) => s.user_id).filter(Boolean)))
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, email")
        .in("id", userIds)

      const userMap = new Map(users?.map((u) => [u.id, u]) || [])

      sales.forEach((sale) => {
        const userId = sale.user_id
        if (!userId) return

        const user = userMap.get(userId)
        const staffName = user?.full_name || user?.email || "Unknown"

        const existing = staffMap.get(userId) || {
          user_id: userId,
          staff_name: staffName,
          sales_count: 0,
          total_revenue: 0,
          total_gross_profit: 0,
          average_sale_value: 0,
        }

        existing.sales_count += 1
        existing.total_revenue += Number(sale.amount || 0)

        // Calculate gross profit for this sale
        const saleItemsForSale = saleItems?.filter((item) => item.sale_id === sale.id) || []
        const saleCogs = saleItemsForSale.reduce((sum, item) => sum + Number(item.cogs || 0), 0)
        existing.total_gross_profit += Number(sale.amount || 0) - saleCogs

        staffMap.set(userId, existing)
      })

      staffMap.forEach((staff) => {
        staff.average_sale_value = staff.sales_count > 0 ? staff.total_revenue / staff.sales_count : 0
      })

      const staffArray = Array.from(staffMap.values())
        .sort((a, b) => b.total_revenue - a.total_revenue)
        .slice(0, 10)

      setStaffPerformance(staffArray)

      // Register sessions
      await loadRegisterSessions(dateFilter, storeFilter)

      // Inventory value
      await loadInventoryValue(storeFilter)
    } catch (err: any) {
      console.error("Error loading analytics:", err)
    }
  }

  const loadRegisterSessions = async (dateFilter: { start: string; end: string }, storeFilter: string | null) => {
    try {
      let sessionsQuery = supabase
        .from("cashier_sessions")
        .select(
          "id, register_id, store_id, started_at, user_id, opening_float, closing_cash, registers(name), stores(name)"
        )
        .eq("business_id", businessId)
        .gte("started_at", dateFilter.start)
        .lte("started_at", dateFilter.end)

      if (storeFilter) {
        sessionsQuery = sessionsQuery.eq("store_id", storeFilter)
      }

      const { data: sessions } = await sessionsQuery

      if (!sessions || sessions.length === 0) {
        setRegisterSessions([])
        return
      }

      // Get sales totals for each session
      const sessionIds = sessions.map((s) => s.id)
      const { data: sessionSales } = await supabase
        .from("sales")
        .select("cashier_session_id, amount")
        .in("cashier_session_id", sessionIds)
        .eq("payment_status", "paid") // Use payment_status - this is what sales actually have

      const sessionSalesMap = new Map<string, number>()
      sessionSales?.forEach((sale) => {
        if (sale.cashier_session_id) {
          const existing = sessionSalesMap.get(sale.cashier_session_id) || 0
          sessionSalesMap.set(sale.cashier_session_id, existing + Number(sale.amount || 0))
        }
      })

      // Get cashier names
      const userIds = Array.from(new Set(sessions.map((s: any) => s.user_id).filter(Boolean)))
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, email")
        .in("id", userIds)

      const userMap = new Map(users?.map((u: any) => [u.id, u]) || [])

      const sessionsArray: RegisterSession[] = sessions.map((session: any) => {
        const openingFloat = Number(session.opening_float || 0)
        const closingCash = Number(session.closing_cash || 0)
        const salesTotal = sessionSalesMap.get(session.id) || 0
        
        // Calculate expected cash: opening float + cash sales only (not MoMo/Card)
        // For now, use total sales as approximation (in real system, would filter by payment method)
        const expectedCash = openingFloat + salesTotal
        const variance = closingCash - expectedCash

        const user = userMap.get(session.user_id)
        const cashierName = (user as any)?.full_name || (user as any)?.email || "Unknown"

        return {
          id: session.id,
          store_name: (session.stores as any)?.name || null,
          register_name: (session.registers as any)?.name || "Unknown",
          started_at: session.started_at,
          cashier_name: cashierName,
          sales_total: salesTotal,
          variance,
        }
      })

      setRegisterSessions(sessionsArray)
    } catch (err: any) {
      console.error("Error loading register sessions:", err)
    }
  }

  const loadInventoryValue = async (storeFilter: string | null) => {
    try {
      if (storeFilter) {
        // Load from products_stock
        const { data: storeStock } = await supabase
          .from("products_stock")
          .select("product_id, variant_id, stock_quantity, stock, products(cost_price, price)")
          .eq("store_id", storeFilter)

        let totalValue = 0
        if (storeStock) {
          storeStock.forEach((item) => {
            const stock = Math.floor(
              item.stock_quantity !== null && item.stock_quantity !== undefined
                ? Number(item.stock_quantity)
                : Number(item.stock || 0)
            )
            const costPrice = Number((item.products as any)?.cost_price || 0)
            totalValue += stock * costPrice
          })
        }
        setInventoryValue(totalValue)
      } else {
        // All stores - sum all products_stock
        const { data: allStock } = await supabase
          .from("products_stock")
          .select("stock_quantity, stock, products(cost_price)")

        let totalValue = 0
        if (allStock) {
          allStock.forEach((item) => {
            const stock = Math.floor(
              item.stock_quantity !== null && item.stock_quantity !== undefined
                ? Number(item.stock_quantity)
                : Number(item.stock || 0)
            )
            const costPrice = Number((item.products as any)?.cost_price || 0)
            totalValue += stock * costPrice
          })
        }
        setInventoryValue(totalValue)
      }
    } catch (err: any) {
      console.error("Error loading inventory value:", err)
    }
  }

  const kpiCard = (
    label: string,
    value: ReactNode,
    accent: "slate" | "teal" | "sky" | "amber" | "violet" | "rose",
  ) => {
    const bar =
      accent === "teal"
        ? "bg-teal-600"
        : accent === "sky"
          ? "bg-sky-600"
          : accent === "amber"
            ? "bg-amber-500"
            : accent === "violet"
              ? "bg-violet-600"
              : accent === "rose"
                ? "bg-rose-600"
                : "bg-slate-800"
    return (
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden />
        <p className="pl-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className="mt-1.5 pl-2 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</div>
      </div>
    )
  }

  const tableWrapClass = "overflow-hidden rounded-xl border border-slate-100"
  const thBase =
    "bg-slate-50/90 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 first:rounded-tl-xl last:rounded-tr-xl"
  const thClass = `${thBase} text-left`
  const thRightClass = `${thBase} text-right`
  const tdClass = "border-t border-slate-100 px-3 py-2.5 text-sm text-slate-700"
  const tdRightClass = `${tdClass} text-right tabular-nums`

  if (error) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-3xl">
          <RetailBackofficeBackLink onClick={() => router.push(retailPaths.dashboard)}>Dashboard</RetailBackofficeBackLink>
          <RetailBackofficeCard className="border-red-200/80 bg-red-50/50">
            <p className="text-sm font-semibold text-red-900">Something went wrong</p>
            <p className="mt-1 text-sm text-red-800/90">{error}</p>
          </RetailBackofficeCard>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  if (loading) {
    return (
      <RetailBackofficeShell>
        <RetailBackofficeMain className="max-w-6xl">
          <div className="mb-10 h-9 max-w-xs animate-pulse rounded-lg bg-slate-200/80" />
          <div className="mb-6 h-24 rounded-2xl border border-slate-200/90 bg-white shadow-sm">
            <div className="h-full animate-pulse bg-slate-100/80" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-200/60" />
            ))}
          </div>
        </RetailBackofficeMain>
      </RetailBackofficeShell>
    )
  }

  return (
    <RetailBackofficeShell>
      <RetailBackofficeMain className="max-w-7xl">
        <RetailBackofficeBackLink onClick={() => router.push(retailPaths.dashboard)}>Dashboard</RetailBackofficeBackLink>

        <RetailBackofficePageHeader
          eyebrow="Insights"
          title="Retail analytics"
          description="Sales, margin, payments, and register activity for the selected period and store."
          actions={
            <RetailBackofficeButton variant="secondary" onClick={() => void loadAnalytics()}>
              Refresh
            </RetailBackofficeButton>
          }
        />

        <RetailBackofficeCard className="mb-8" padding="p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={retailLabelClass}>Date range</label>
              <RetailMenuSelect
                value={dateRange}
                onValueChange={(v) => setDateRange(v as DateRange)}
                options={ANALYTICS_DATE_RANGE_OPTIONS}
              />
            </div>

            {dateRange === "custom" && (
              <>
                <div>
                  <label className={retailLabelClass}>Start</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className={retailFieldClass}
                  />
                </div>
                <div>
                  <label className={retailLabelClass}>End</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className={retailFieldClass}
                  />
                </div>
              </>
            )}

            {(userRole === "owner" || userRole === "admin") && stores.length > 0 && (
              <div className={dateRange === "custom" ? "md:col-span-2 lg:col-span-1" : ""}>
                <label className={retailLabelClass}>Store</label>
                <RetailMenuSelect
                  value={selectedStoreId || ""}
                  onValueChange={(v) => setSelectedStoreId(v || null)}
                  options={storeMenuOptions}
                />
              </div>
            )}
          </div>
        </RetailBackofficeCard>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {kpiCard("Revenue (ledger)", format(kpiData.totalSales), "slate")}
          {kpiCard("Transactions", kpiData.totalTransactions, "sky")}
          {kpiCard("Avg sale", format(kpiData.averageSaleValue), "teal")}
          {kpiCard("COGS", format(kpiData.totalCogs), "amber")}
          {kpiCard("Gross profit", format(kpiData.grossProfit), "teal")}
          {kpiCard("Gross margin", `${kpiData.grossMarginPercent.toFixed(1)}%`, "violet")}
          {kpiCard("VAT (period)", format(kpiData.totalVat), "rose")}
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RetailBackofficeCard padding="p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <RetailBackofficeCardTitle>Revenue &amp; profit</RetailBackofficeCardTitle>
              <RetailMenuSelect
                size="sm"
                value={chartMetric}
                onValueChange={(v) => setChartMetric(v as "revenue" | "cogs" | "profit" | "all")}
                options={ANALYTICS_CHART_METRIC_OPTIONS}
                wrapperClassName="max-w-[220px] shrink-0"
                className="text-xs"
              />
            </div>
            {dailyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                {chartMetric === "all" ? (
                  <LineChart data={dailyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGridColor} strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: chartAxisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: chartAxisColor, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="revenue" stroke="#0f172a" strokeWidth={2} dot={false} name="Revenue" />
                    <Line type="monotone" dataKey="cogs" stroke="#94a3b8" strokeWidth={2} dot={false} name="COGS" />
                    <Line type="monotone" dataKey="grossProfit" stroke="#0d9488" strokeWidth={2} dot={false} name="Gross profit" />
                  </LineChart>
                ) : (
                  <BarChart data={dailyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={chartGridColor} strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" tick={{ fill: chartAxisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: chartAxisColor, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey={chartMetric === "revenue" ? "revenue" : chartMetric === "cogs" ? "cogs" : "grossProfit"}
                      fill={chartMetric === "revenue" ? "#0f172a" : chartMetric === "cogs" ? "#94a3b8" : "#0d9488"}
                      radius={[6, 6, 0, 0]}
                      name={chartMetric === "revenue" ? "Revenue" : chartMetric === "cogs" ? "COGS" : "Gross profit"}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
                No data for this period
              </div>
            )}
          </RetailBackofficeCard>

          <RetailBackofficeCard padding="p-4 sm:p-5">
            <RetailBackofficeCardTitle className="mb-4">Payment mix</RetailBackofficeCardTitle>
            {paymentBreakdown.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={paymentBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={78}
                      paddingAngle={2}
                      dataKey="revenue"
                      nameKey="method"
                      labelLine={false}
                    >
                      {paymentBreakdown.map((entry, index) => (
                        <Cell key={`cell-${entry.method}-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => format(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-3">
                  {paymentBreakdown.map((pm) => (
                    <li key={pm.method} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{pm.method}</span>
                      <span className="font-medium tabular-nums text-slate-900">
                        {format(pm.revenue)}{" "}
                        <span className="text-slate-400">({pm.percentage.toFixed(0)}%)</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="flex h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
                No payment data
              </div>
            )}
          </RetailBackofficeCard>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RetailBackofficeCard padding="p-4 sm:p-5">
            <RetailBackofficeCardTitle className="mb-4">Top products</RetailBackofficeCardTitle>
            {topProducts.length > 0 ? (
              <div className={tableWrapClass}>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={thClass}>Product</th>
                      <th className={thRightClass}>Units</th>
                      <th className={thRightClass}>Revenue</th>
                      <th className={thRightClass}>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product, idx) => (
                      <tr key={idx} className="bg-white transition hover:bg-slate-50/80">
                        <td className={tdClass}>
                          <div className="font-medium text-slate-900">{product.product_name}</div>
                          {product.variant_name ? (
                            <div className="text-xs text-slate-500">{product.variant_name}</div>
                          ) : null}
                        </td>
                        <td className={tdRightClass}>{product.units_sold}</td>
                        <td className={tdRightClass}>{format(product.revenue)}</td>
                        <td
                          className={`${tdRightClass} font-semibold ${
                            product.gross_profit >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {format(product.gross_profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">No products sold in this period.</p>
            )}
          </RetailBackofficeCard>

          <RetailBackofficeCard padding="p-4 sm:p-5">
            <RetailBackofficeCardTitle className="mb-4">Staff performance</RetailBackofficeCardTitle>
            {staffPerformance.length > 0 ? (
              <div className={tableWrapClass}>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className={thClass}>Staff</th>
                      <th className={thRightClass}>Sales</th>
                      <th className={thRightClass}>Revenue</th>
                      <th className={thRightClass}>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staffPerformance.map((staff, idx) => (
                      <tr key={idx} className="bg-white transition hover:bg-slate-50/80">
                        <td className={`${tdClass} font-medium text-slate-900`}>{staff.staff_name}</td>
                        <td className={tdRightClass}>{staff.sales_count}</td>
                        <td className={tdRightClass}>{format(staff.total_revenue)}</td>
                        <td
                          className={`${tdRightClass} font-semibold ${
                            staff.total_gross_profit >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {format(staff.total_gross_profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">No staff data for this period.</p>
            )}
          </RetailBackofficeCard>
        </div>

        <RetailBackofficeCard className="mb-10" padding="p-4 sm:p-5">
          <RetailBackofficeCardTitle className="mb-4">Register sessions</RetailBackofficeCardTitle>
          {registerSessions.length > 0 ? (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Sessions</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{registerSessions.length}</p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Session sales (sum)</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {format(registerSessions.reduce((sum, s) => sum + (s.sales_total || 0), 0))}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Variance (sum)</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
                    {format(registerSessions.reduce((sum, s) => sum + (s.variance || 0), 0))}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Inventory value</p>
                  <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{format(inventoryValue)}</p>
                </div>
              </div>
              <div className={tableWrapClass}>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {userRole === "owner" || userRole === "admin" ? <th className={thClass}>Store</th> : null}
                      <th className={thClass}>Register</th>
                      <th className={thClass}>Started</th>
                      <th className={thClass}>Cashier</th>
                      <th className={thRightClass}>Sales</th>
                      <th className={thRightClass}>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registerSessions.map((session) => (
                      <tr key={session.id} className="bg-white transition hover:bg-slate-50/80">
                        {(userRole === "owner" || userRole === "admin") && (
                          <td className={tdClass}>{session.store_name || "—"}</td>
                        )}
                        <td className={`${tdClass} font-medium text-slate-900`}>{session.register_name}</td>
                        <td className={tdClass}>{new Date(session.started_at).toLocaleString()}</td>
                        <td className={tdClass}>{session.cashier_name}</td>
                        <td className={tdRightClass}>{format(session.sales_total)}</td>
                        <td
                          className={`${tdRightClass} font-semibold ${
                            session.variance >= 0 ? "text-emerald-700" : "text-red-600"
                          }`}
                        >
                          {format(session.variance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-slate-500">No register sessions in this period.</p>
          )}
        </RetailBackofficeCard>
      </RetailBackofficeMain>
    </RetailBackofficeShell>
  )
}

