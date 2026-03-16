import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")

    if (!businessId) {
      return NextResponse.json(
        { error: "business_id parameter is required" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. No access to this business." },
        { status: 403 }
      )
    }

    const { data: periods, error } = await supabase
      .from("accounting_periods")
      .select("*")
      .eq("business_id", businessId)
      .order("period_start", { ascending: false })

    if (error) {
      console.error("Error fetching accounting periods:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Get user information for closed_by
    const periodsWithUsers = await Promise.all(
      (periods || []).map(async (period) => {
        if (!period.closed_by) {
          return {
            ...period,
            closed_by_user: null,
          }
        }

        // Get user info from auth.users (via admin API)
        // Note: We can't directly query auth.users, so we'll try to get from users table
        const { data: user } = await supabase
          .from("users")
          .select("id, email, full_name")
          .eq("id", period.closed_by)
          .maybeSingle()

        return {
          ...period,
          closed_by_user: user
            ? {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
              }
            : {
                id: period.closed_by,
                email: null,
                full_name: null,
              },
        }
      })
    )

    return NextResponse.json({ periods: periodsWithUsers })
  } catch (error: any) {
    console.error("Error in accounting periods:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

