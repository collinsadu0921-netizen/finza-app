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
    const {
      register_id,
      session_id,
      counted_cash,
      expected_cash,
      variance_amount,
    } = body

    if (!register_id || !session_id || counted_cash === undefined) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    const { data: session, error: sessionError } = await serverClient
      .from("cashier_sessions")
      .select("*, registers(store_id)")
      .eq("id", session_id)
      .eq("business_id", business.id)
      .single()

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      )
    }

    if (session.status === "closed") {
      return NextResponse.json(
        { error: "Session is already closed" },
        { status: 400 }
      )
    }

    // Update session to closed
    const { error: updateError } = await supabase
      .from("cashier_sessions")
      .update({
        status: "closed",
        closing_amount: counted_cash,
        closing_cash: counted_cash,
        ended_at: new Date().toISOString(),
      })
      .eq("id", session_id)

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to close session" },
        { status: 500 }
      )
    }

    // If there's a variance, it should have been handled by override
    // But we still record it in register_variances if variance_amount is provided
    if (variance_amount !== 0 && variance_amount !== undefined) {
      // This should only happen if override was approved
      // The override route will handle creating the variance record
      // But we'll create it here as a backup
      await supabase.from("register_variances").insert({
        register_id,
        session_id,
        user_id: session.user_id,
        expected: expected_cash,
        counted: counted_cash,
        difference: variance_amount,
      })
    }

    return NextResponse.json({
      success: true,
      message: "Register closed successfully",
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}




