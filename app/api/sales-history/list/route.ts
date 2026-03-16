import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getEffectiveStoreId } from "@/lib/storeContext"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const businessId = searchParams.get("business_id")
    const userId = searchParams.get("user_id")
    const page = parseInt(searchParams.get("page") || "1")
    const pageSize = parseInt(searchParams.get("page_size") || "50")
    const dateFrom = searchParams.get("date_from")
    const dateTo = searchParams.get("date_to")
    const paymentMethod = searchParams.get("payment_method")
    const status = searchParams.get("status")
    const cashierId = searchParams.get("cashier_id")
    const registerId = searchParams.get("register_id")
    const storeId = searchParams.get("store_id") // CRITICAL: Store filter for multi-store support
    const sortField = searchParams.get("sort_field") || "date"
    const sortDirection = searchParams.get("sort_direction") || "desc"

    if (!businessId || !userId) {
      return NextResponse.json(
        { error: "Missing required parameters: business_id, user_id" },
        { status: 400 }
      )
    }

    // Check user role - only owner, admin, manager can access
    const { data: businessUser, error: roleError } = await supabase
      .from("business_users")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", userId)
      .maybeSingle()

    if (roleError || !businessUser) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      )
    }

    if (
      businessUser.role !== "owner" &&
      businessUser.role !== "admin" &&
      businessUser.role !== "manager" &&
      businessUser.role !== "employee"
    ) {
      return NextResponse.json(
        { error: "Only owners, admins, managers, and employees can access sales history" },
        { status: 403 }
      )
    }

    // Get effective store_id based on role
    // Admin/Owner: can use null (global) or selected store_id
    // Manager: locked to their assigned store (ignore client input)
    let effectiveStoreId: string | null = null

    if (businessUser.role === "manager") {
      // Manager must use their assigned store - get from users table
      const { data: userData } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", userId)
        .maybeSingle()

      if (!userData?.store_id) {
        return NextResponse.json(
          { error: "Store manager must be assigned to a store" },
          { status: 403 }
        )
      }

      effectiveStoreId = userData.store_id
    } else {
      // Admin/Owner: can use provided storeId or null for global view
      effectiveStoreId = storeId && storeId !== 'all' ? storeId : null
    }

    const offset = (page - 1) * pageSize

    // Build query for sales
    let salesQuery = supabase
      .from("sales")
      .select(
        `
        id,
        amount,
        payment_method,
        payment_status,
        payment_lines,
        cash_amount,
        momo_amount,
        card_amount,
        cash_received,
        change_given,
        foreign_currency,
        foreign_amount,
        exchange_rate,
        converted_ghs_amount,
        created_at,
        user_id,
        register_id,
        cashier_session_id,
        users:user_id (
          email,
          full_name
        ),
        registers:register_id (
          name
        )
      `,
        { count: "exact" }
      )
      .eq("business_id", businessId)

    // CRITICAL: Filter by effective store_id
    // Admin with null = global mode (no filter)
    // Admin with store_id = filter by that store
    // Manager = always filter by their assigned store
    if (effectiveStoreId) {
      salesQuery = salesQuery.eq("store_id", effectiveStoreId)
      console.log("Sales history query - filtering by effective store_id:", effectiveStoreId)
    } else {
      // Admin in global mode - no store filter
      console.log("Sales history query - admin global mode (no store filter)")
    }

    // Apply filters
    if (dateFrom) {
      salesQuery = salesQuery.gte("created_at", dateFrom)
    }
    if (dateTo) {
      // Add one day to include the entire end date
      const endDate = new Date(dateTo)
      endDate.setDate(endDate.getDate() + 1)
      salesQuery = salesQuery.lt("created_at", endDate.toISOString())
    }
    if (cashierId) {
      salesQuery = salesQuery.eq("user_id", cashierId)
    }
    if (registerId) {
      salesQuery = salesQuery.eq("register_id", registerId)
    }
    if (status) {
      if (status === "completed") {
        salesQuery = salesQuery.eq("payment_status", "paid")
      } else if (status === "refunded") {
        salesQuery = salesQuery.eq("payment_status", "refunded")
      } else if (status === "parked") {
        // Parked sales are handled separately
        salesQuery = salesQuery.eq("payment_status", "parked")
      }
    }

    // Payment method filter
    if (paymentMethod) {
      if (paymentMethod === "split") {
        // Split payments have payment_lines or multiple amount fields
        salesQuery = salesQuery.or("payment_lines.is.not.null,cash_amount.is.not.null,momo_amount.is.not.null,card_amount.is.not.null")
      } else {
        salesQuery = salesQuery.eq("payment_method", paymentMethod)
      }
    }

    // Apply sorting
    const ascending = sortDirection === "asc"
    if (sortField === "date") {
      salesQuery = salesQuery.order("created_at", { ascending })
    } else if (sortField === "amount") {
      salesQuery = salesQuery.order("amount", { ascending })
    } else if (sortField === "sale_id") {
      salesQuery = salesQuery.order("id", { ascending })
    } else if (sortField === "payment") {
      salesQuery = salesQuery.order("payment_method", { ascending })
    } else if (sortField === "status") {
      salesQuery = salesQuery.order("payment_status", { ascending })
    } else {
      // Default to date descending
      salesQuery = salesQuery.order("created_at", { ascending: false })
    }

    // Apply pagination
    salesQuery = salesQuery.range(offset, offset + pageSize - 1)

    const { data: salesData, error: salesError, count } = await salesQuery

    if (salesError) {
      console.error("Sales history query error:", salesError)
      return NextResponse.json(
        { error: salesError.message || "Failed to fetch sales" },
        { status: 500 }
      )
    }
    
    // Debug logging
    console.log("Sales history query result:", {
      storeId,
      salesCount: salesData?.length || 0,
      totalCount: count,
      firstSale: salesData?.[0] ? {
        id: salesData[0].id,
        store_id: (salesData[0] as any).store_id,
        created_at: salesData[0].created_at
      } : null
    })

    // Also fetch parked sales if status filter includes parked or no status filter
    let parkedSalesData: any[] = []
    if (!status || status === "parked") {
      let parkedQuery = supabase
        .from("parked_sales")
        .select(
          `
          id,
          subtotal,
          taxes,
          created_at,
          user_id,
          cart_json,
          users:user_id (
            email,
            full_name
          )
        `,
          { count: "exact" }
        )
        .eq("business_id", businessId)

      // Note: parked_sales table doesn't have store_id column
      // Store filtering is not available for parked sales

      if (dateFrom) {
        parkedQuery = parkedQuery.gte("created_at", dateFrom)
      }
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setDate(endDate.getDate() + 1)
        parkedQuery = parkedQuery.lt("created_at", endDate.toISOString())
      }
      if (cashierId) {
        parkedQuery = parkedQuery.eq("user_id", cashierId)
      }

      parkedQuery = parkedQuery.order("created_at", { ascending: false })
      parkedQuery = parkedQuery.range(offset, offset + pageSize - 1)

      const { data: parkedData, error: parkedError } = await parkedQuery
      if (!parkedError && parkedData) {
        parkedSalesData = parkedData
      }
    }

    // Fetch voided sales from overrides table
    let voidedSalesData: any[] = []
    if (!status || status === "voided") {
      let voidedQuery = supabase
        .from("overrides")
        .select(
          `
          id,
          reference_id,
          cashier_id,
          supervisor_id,
          created_at,
          cashiers:cashier_id (
            email,
            full_name
          ),
          supervisors:supervisor_id (
            email,
            full_name
          )
        `
        )
        .eq("action_type", "void_sale")

      if (dateFrom) {
        voidedQuery = voidedQuery.gte("created_at", dateFrom)
      }
      if (dateTo) {
        const endDate = new Date(dateTo)
        endDate.setDate(endDate.getDate() + 1)
        voidedQuery = voidedQuery.lt("created_at", endDate.toISOString())
      }
      if (cashierId) {
        voidedQuery = voidedQuery.eq("cashier_id", cashierId)
      }

      voidedQuery = voidedQuery.order("created_at", { ascending: false })
      voidedQuery = voidedQuery.range(offset, offset + pageSize - 1)

      const { data: voidedData, error: voidedError } = await voidedQuery
      if (!voidedError && voidedData) {
        // Get business_id from cashier's business_users
        const cashierIds = voidedData.map((v) => v.cashier_id)
        const { data: businessUsers } = await supabase
          .from("business_users")
          .select("user_id, business_id")
          .in("user_id", cashierIds)
          .eq("business_id", businessId)

        const businessUserMap = new Map(
          businessUsers?.map((bu) => [bu.user_id, bu.business_id]) || []
        )

        voidedSalesData = voidedData
          .filter((v) => businessUserMap.get(v.cashier_id) === businessId)
          .map((v) => ({
            id: v.reference_id,
            voided: true,
            voided_at: v.created_at,
            cashier: v.cashiers,
            supervisor: v.supervisors,
            created_at: v.created_at, // Use override timestamp as sale date
          }))
      }
    }

    // Transform sales data
    const sales = (salesData || []).map((sale: any) => {
      // Determine payment methods
      let paymentMethods: string[] = []
      if (sale.payment_lines) {
        try {
          const lines =
            typeof sale.payment_lines === "string"
              ? JSON.parse(sale.payment_lines)
              : sale.payment_lines
          if (Array.isArray(lines)) {
            paymentMethods = lines.map((l: any) => l.method)
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      if (paymentMethods.length === 0) {
        if (sale.cash_amount > 0) paymentMethods.push("cash")
        if (sale.momo_amount > 0) paymentMethods.push("momo")
        if (sale.card_amount > 0) paymentMethods.push("card")
        if (paymentMethods.length === 0) {
          paymentMethods = [sale.payment_method || "cash"]
        }
      }

      return {
        id: sale.id,
        sale_id: sale.id.substring(0, 8),
        date: sale.created_at,
        cashier: sale.users
          ? {
              id: sale.user_id,
              name: sale.users.full_name || sale.users.email,
              email: sale.users.email,
            }
          : null,
        register: sale.registers ? { id: sale.register_id, name: sale.registers.name } : null,
        total_amount: Number(sale.amount || 0),
        payment_methods: paymentMethods,
        payment_method_display:
          paymentMethods.length > 1
            ? "Split"
            : paymentMethods[0] === "momo"
            ? "MoMo"
            : paymentMethods[0]?.charAt(0).toUpperCase() + paymentMethods[0]?.slice(1) || "Cash",
        status:
          sale.payment_status === "refunded"
            ? "refunded"
            : sale.payment_status === "paid"
            ? "completed"
            : sale.payment_status || "completed",
        session_id: sale.cashier_session_id,
        payment_breakdown: {
          cash: sale.cash_amount || 0,
          momo: sale.momo_amount || 0,
          card: sale.card_amount || 0,
        },
        foreign_currency: sale.foreign_currency
          ? {
              currency: sale.foreign_currency,
              amount: sale.foreign_amount,
              exchange_rate: sale.exchange_rate,
              converted: sale.converted_ghs_amount,
            }
          : null,
      }
    })

    // Transform parked sales
    const parkedSales = (parkedSalesData || []).map((parked: any) => ({
      id: parked.id,
      sale_id: parked.id.substring(0, 8),
      date: parked.created_at,
      cashier: parked.users
        ? {
            id: parked.user_id,
            name: parked.users.full_name || parked.users.email,
            email: parked.users.email,
          }
        : null,
      register: null,
      total_amount: Number(parked.subtotal || 0) + Number(parked.taxes || 0),
      payment_methods: [],
      payment_method_display: "Parked",
      status: "parked",
      session_id: null,
      payment_breakdown: null,
      foreign_currency: null,
    }))

    // Transform voided sales
    const voidedSales = (voidedSalesData || []).map((voided: any) => ({
      id: voided.id,
      sale_id: voided.id ? voided.id.substring(0, 8) : "VOIDED",
      date: voided.created_at,
      cashier: voided.cashier
        ? {
            id: voided.cashier_id,
            name: voided.cashier.full_name || voided.cashier.email,
            email: voided.cashier.email,
          }
        : null,
      register: null,
      total_amount: 0, // Sale data is deleted, amount unknown
      payment_methods: [],
      payment_method_display: "Voided",
      status: "voided",
      session_id: null,
      payment_breakdown: null,
      foreign_currency: null,
      voided_info: {
        voided_at: voided.voided_at,
        supervisor: voided.supervisor
          ? {
              name: voided.supervisor.full_name || voided.supervisor.email,
              email: voided.supervisor.email,
            }
          : null,
      },
    }))

    // Combine all sales
    const allSales = [...sales, ...parkedSales, ...voidedSales]
    
    // Apply client-side sorting for combined results
    const isAscending = sortDirection === "asc"
    allSales.sort((a, b) => {
      let comparison = 0
      
      if (sortField === "date") {
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
      } else if (sortField === "amount") {
        comparison = (a.total_amount || 0) - (b.total_amount || 0)
      } else if (sortField === "sale_id") {
        comparison = (a.sale_id || "").localeCompare(b.sale_id || "")
      } else if (sortField === "payment") {
        comparison = (a.payment_method_display || "").localeCompare(b.payment_method_display || "")
      } else if (sortField === "status") {
        comparison = (a.status || "").localeCompare(b.status || "")
      } else if (sortField === "cashier") {
        const aName = a.cashier?.name || ""
        const bName = b.cashier?.name || ""
        comparison = aName.localeCompare(bName)
      } else if (sortField === "register") {
        const aName = a.register?.name || ""
        const bName = b.register?.name || ""
        comparison = aName.localeCompare(bName)
      } else {
        // Default to date
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
      }
      
      return isAscending ? comparison : -comparison
    })

    // Apply status filter if needed (already applied in queries, but need to filter combined results)
    const filteredSales =
      status && status !== "parked" && status !== "voided"
        ? allSales.filter((s) => s.status === status)
        : allSales

    return NextResponse.json({
      sales: filteredSales.slice(0, pageSize),
      pagination: {
        page,
        page_size: pageSize,
        total: count || filteredSales.length,
        total_pages: Math.ceil((count || filteredSales.length) / pageSize),
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
