import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const serverClient = await createSupabaseServerClient()
    const {
      data: { user },
    } = await serverClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const business = await getCurrentBusiness(serverClient, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { cashier_id, store_id, cart_json, subtotal, taxes, total } = body

    if (!cashier_id || !cart_json || subtotal === undefined || taxes === undefined || total === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const business_id = business.id

    // Validate store_id - POS requires a specific store
    if (!store_id || store_id === 'all') {
      return NextResponse.json(
        { error: "Cannot park sale: Invalid store_id. Please select a specific store." },
        { status: 400 }
      )
    }

    // Insert parked sale (business_id from session)
    // Note: store_id is validated but not stored (column doesn't exist in schema)
    const { data: parkedSale, error: parkError } = await supabase
      .from("parked_sales")
      .insert({
        business_id,
        cashier_id,
        cart_json,
        subtotal: Number(subtotal),
        taxes: Number(taxes),
        total: Number(total),
      })
      .select()
      .single()

    if (parkError) {
      return NextResponse.json(
        { error: parkError.message || "Failed to park sale" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      parked_sale: parkedSale,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


