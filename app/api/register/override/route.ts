import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
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
    const {
      supervisor_email,
      supervisor_password,
      register_id,
      session_id,
      variance_amount,
      counted_cash,
      expected_cash,
    } = body

    if (
      !supervisor_email ||
      !supervisor_password ||
      !register_id ||
      !session_id ||
      variance_amount === undefined
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify supervisor credentials using Supabase Auth
    // We need to sign in with the provided credentials (requires anon key)
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

    // Get session to get cashier ID
    const { data: session, error: sessionError } = await supabase
      .from("cashier_sessions")
      .select("user_id, register_id, business_id")
      .eq("id", session_id)
      .eq("business_id", business.id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      )
    }

    const cashierId = session.user_id

    // Check that supervisor is not the same as cashier
    if (supervisorId === cashierId) {
      return NextResponse.json(
        { error: "Cashier cannot override themselves." },
        { status: 403 }
      )
    }

    // Get business_id and store_id from register
    const { data: register, error: registerError } = await supabase
      .from("registers")
      .select("business_id, store_id")
      .eq("id", register_id)
      .eq("business_id", business.id)
      .single()

    if (registerError || !register) {
      return NextResponse.json(
        { error: "Register not found" },
        { status: 404 }
      )
    }

    // Check if supervisor is the business owner
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", register.business_id)
      .single()

    const isBusinessOwner = business && business.owner_id === supervisorId

    // Check supervisor role in business_users table (if not owner)
    let supervisorRole: string | null = null
    if (!isBusinessOwner) {
      const { data: businessUser, error: roleError } = await supabase
        .from("business_users")
        .select("role")
        .eq("business_id", register.business_id)
        .eq("user_id", supervisorId)
        .maybeSingle()

      if (roleError || !businessUser) {
        return NextResponse.json(
          { error: "Invalid supervisor authorization. You must be an owner, admin, or manager." },
          { status: 403 }
        )
      }
      supervisorRole = businessUser.role
    } else {
      supervisorRole = "owner"
    }

    // AUTHORITY-BASED CHECK: Verify supervisor has sufficient authority for register variance override
    // Required authority: MANAGER (50) - Manager or Admin can approve register variances
    const supervisorAuthority = getAuthorityLevel(supervisorRole as any)
    if (!hasAuthority(supervisorAuthority, REQUIRED_AUTHORITY.REGISTER_VARIANCE)) {
      return NextResponse.json(
        { error: "Only supervisors (managers) and admins can approve register variance overrides." },
        { status: 403 }
      )
    }

    // Create variance record
    const { error: varianceError } = await supabase
      .from("register_variances")
      .insert({
        register_id,
        session_id,
        user_id: cashierId,
        supervisor_id: supervisorId,
        expected: expected_cash,
        counted: counted_cash,
        difference: variance_amount,
      })

    if (varianceError) {
      return NextResponse.json(
        { error: varianceError.message || "Failed to record variance" },
        { status: 500 }
      )
    }

    // Now close the register
    const { error: closeError } = await supabase
      .from("cashier_sessions")
      .update({
        status: "closed",
        closing_amount: counted_cash,
        closing_cash: counted_cash,
        ended_at: new Date().toISOString(),
      })
      .eq("id", session_id)

    if (closeError) {
      return NextResponse.json(
        { error: closeError.message || "Failed to close register" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Override approved and register closed successfully",
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

