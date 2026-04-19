import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getRetailSaleReceiptPayloadForBusiness } from "@/lib/retail/getRetailSaleReceiptPayloadForBusiness"

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

    const result = await getRetailSaleReceiptPayloadForBusiness(supabase, saleId, businessId, {})

    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error }
      if (result.status === 404) payload.code = "SALE_NOT_FOUND"
      return NextResponse.json(payload, { status: result.status })
    }

    return NextResponse.json(result.body)
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
