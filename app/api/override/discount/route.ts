import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getAuthorityLevel, hasAuthority, REQUIRED_AUTHORITY } from "@/lib/authority"

// Service role client for database operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Anon client for authentication (signInWithPassword requires anon key)
const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      supervisor_email,
      supervisor_password,
      sale_id,
      cashier_id,
      discount_percent,
    } = body

    if (
      !supervisor_email ||
      !supervisor_password ||
      !sale_id ||
      !cashier_id ||
      discount_percent === undefined
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify supervisor credentials using Supabase Auth
    const authResponse = await supabaseAnon.auth.signInWithPassword({
      email: supervisor_email,
      password: supervisor_password,
    })

    if (authResponse.error || !authResponse.data.user) {
      return NextResponse.json(
        { error: "Invalid supervisor authorization." },
        { status: 401 }
      )
    }

    const supervisorId = authResponse.data.user.id

    // Check that supervisor is not the same as cashier
    if (supervisorId === cashier_id) {
      return NextResponse.json(
        { error: "Cashier cannot override themselves." },
        { status: 403 }
      )
    }

    // Get sale to verify it exists and get business_id
    const { data: sale, error: saleError } = await supabase
      .from("sales")
      .select("business_id, cashier_session_id")
      .eq("id", sale_id)
      .single()

    if (saleError || !sale) {
      return NextResponse.json(
        { error: "Sale not found" },
        { status: 404 }
      )
    }

    // Check if supervisor is the business owner
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", sale.business_id)
      .single()

    const isBusinessOwner = business && business.owner_id === supervisorId

    // Check supervisor role in business_users table (if not owner)
    let supervisorRole: string | null = null
    if (!isBusinessOwner) {
      const { data: businessUser, error: roleError } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", sale.business_id)
        .eq("user_id", supervisorId)
        .maybeSingle()

      if (roleError || !businessUser) {
        return NextResponse.json(
          { error: "Invalid supervisor authorization. You must be an owner or admin." },
          { status: 403 }
        )
      }
      supervisorRole = businessUser.role
    } else {
      supervisorRole = "owner"
    }

    // AUTHORITY-BASED CHECK: Verify supervisor has sufficient authority for discount override
    // Required authority: MANAGER (50) - Manager or Admin can approve discounts > 10%
    const supervisorAuthority = getAuthorityLevel(supervisorRole as any)
    if (!hasAuthority(supervisorAuthority, REQUIRED_AUTHORITY.DISCOUNT_OVERRIDE)) {
      return NextResponse.json(
        { error: "Only supervisors (managers) and admins can approve discount overrides." },
        { status: 403 }
      )
    }

    // Create override record
    const { error: overrideError } = await supabase.from("overrides").insert({
      action_type: "discount_override",
      reference_id: sale_id,
      cashier_id: cashier_id,
      supervisor_id: supervisorId,
    })

    if (overrideError) {
      return NextResponse.json(
        { error: overrideError.message || "Failed to record override" },
        { status: 500 }
      )
    }

    // Update supervised_actions_count in cashier_sessions if session exists
    if (sale.cashier_session_id) {
      // Get current count
      const { data: session, error: sessionError } = await supabase
        .from("cashier_sessions")
        .select("supervised_actions_count")
        .eq("id", sale.cashier_session_id)
        .single()

      if (!sessionError && session) {
        const currentCount = session.supervised_actions_count || 0
        await supabase
          .from("cashier_sessions")
          .update({
            supervised_actions_count: currentCount + 1,
          })
          .eq("id", sale.cashier_session_id)
      }
    }

    return NextResponse.json({
      success: true,
      message: "Discount override approved",
      approved: true,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}



