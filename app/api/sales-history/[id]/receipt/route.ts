import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const saleId = params.id
    const searchParams = request.nextUrl.searchParams
    const userId = searchParams.get("user_id")
    const businessId = searchParams.get("business_id")

    if (!userId || !businessId) {
      return NextResponse.json(
        { error: "Missing required parameters: user_id, business_id" },
        { status: 400 }
      )
    }

    // Check user role - allow owner, admin, manager, employee, and cashier
    // First check if user is the business owner
    const { data: businessOwnerCheck, error: businessCheckError } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", businessId)
      .maybeSingle()

    let userRole: string | null = null

    if (!businessCheckError && businessOwnerCheck && businessOwnerCheck.owner_id === userId) {
      userRole = "owner"
    } else {
      // Check business_users table
      const { data: businessUser, error: roleError } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", businessId)
        .eq("user_id", userId)
        .maybeSingle()

      if (roleError || !businessUser) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 })
      }

      userRole = businessUser.role
    }

    // Allow owner, admin, manager, employee, and cashier to reprint receipts
    const allowedRoles = ["owner", "admin", "manager", "employee", "cashier"]
    if (!userRole || !allowedRoles.includes(userRole)) {
      return NextResponse.json(
        { error: "Access denied: Insufficient permissions to reprint receipts" },
        { status: 403 }
      )
    }

    // Load business info
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .single()

    if (businessError || !business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      )
    }

    // Check if this is a parked sale
    const { data: parkedSale } = await supabase
      .from("parked_sales")
      .select("*")
      .eq("id", saleId)
      .maybeSingle()

    if (parkedSale) {
      // Return parked sale data
      return NextResponse.json({
        sale: {
          id: parkedSale.id,
          amount: Number(parkedSale.subtotal || 0) + Number(parkedSale.taxes || 0),
          payment_method: "parked",
          payment_status: "parked",
          created_at: parkedSale.created_at,
          user_id: parkedSale.user_id,
        },
        sale_items: (parkedSale.cart_json as any[]) || [],
        business: {
          name: business.name,
        },
        is_parked: true,
      })
    }

    // Check if this is a voided sale
    const { data: voidedOverride } = await supabase
      .from("overrides")
      .select("*")
      .eq("action_type", "void_sale")
      .eq("reference_id", saleId)
      .maybeSingle()

    if (voidedOverride) {
      return NextResponse.json(
        { error: "Cannot reprint receipt for voided sale" },
        { status: 400 }
      )
    }

    // Load sale
    const { data: saleData, error: saleError } = await supabase
      .from("sales")
      .select(
        `
        *,
        users:user_id (
          email,
          full_name
        ),
        registers:register_id (
          name
        )
      `
      )
      .eq("id", saleId)
      .single()

    if (saleError || !saleData) {
      return NextResponse.json({ error: "Sale not found" }, { status: 404 })
    }

    // Load sale items
    const { data: itemsData, error: itemsError } = await supabase
      .from("sale_items")
      .select("*")
      .eq("sale_id", saleId)
      .order("created_at", { ascending: true })

    if (itemsError) {
      return NextResponse.json(
        { error: itemsError.message || "Failed to load sale items" },
        { status: 500 }
      )
    }

    // Transform sale data
    const sale = {
      id: saleData.id,
      amount: Number(saleData.amount),
      payment_method: saleData.payment_method,
      payment_status: saleData.payment_status,
      payment_lines: saleData.payment_lines
        ? typeof saleData.payment_lines === "string"
          ? JSON.parse(saleData.payment_lines)
          : saleData.payment_lines
        : null,
      cash_amount: saleData.cash_amount ? Number(saleData.cash_amount) : null,
      momo_amount: saleData.momo_amount ? Number(saleData.momo_amount) : null,
      card_amount: saleData.card_amount ? Number(saleData.card_amount) : null,
      cash_received: saleData.cash_received ? Number(saleData.cash_received) : null,
      change_given: saleData.change_given ? Number(saleData.change_given) : null,
      foreign_currency: saleData.foreign_currency,
      foreign_amount: saleData.foreign_amount ? Number(saleData.foreign_amount) : null,
      exchange_rate: saleData.exchange_rate ? Number(saleData.exchange_rate) : null,
      converted_ghs_amount: saleData.converted_ghs_amount
        ? Number(saleData.converted_ghs_amount)
        : null,
      nhil: saleData.nhil ? Number(saleData.nhil) : 0,
      getfund: saleData.getfund ? Number(saleData.getfund) : 0,
      covid: 0, // RETAIL: COVID Levy removed
      vat: saleData.vat ? Number(saleData.vat) : 0,
      created_at: saleData.created_at,
      description: saleData.description,
      user_id: saleData.user_id,
      register_id: saleData.register_id,
      // TRACK C1.1: Fix missing tax_lines - include in API response
      tax_lines: saleData.tax_lines || null,
      total_tax: saleData.total_tax ? Number(saleData.total_tax) : null,
      cashier: saleData.users
        ? {
            email: saleData.users.email,
            full_name: saleData.users.full_name,
          }
        : null,
      register: saleData.registers
        ? {
            name: saleData.registers.name,
          }
        : null,
    }

    // Transform sale items
    const sale_items = (itemsData || []).map((item) => ({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name || item.name || "Unknown",
      quantity: item.quantity || item.qty || 1,
      unit_price: Number(item.unit_price || item.price || 0),
      line_total: Number(item.line_total || (item.quantity || item.qty || 1) * Number(item.unit_price || item.price || 0)),
      note: item.note || null,
    }))

    return NextResponse.json({
      sale,
      sale_items,
      business: {
        name: business.name,
      },
      is_parked: false,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
