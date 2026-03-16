import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"

/**
 * GET /api/accounting/firm/firms
 * 
 * Returns list of firms the user belongs to with their role in each firm
 * 
 * Access: Users who belong to accounting firms
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    // Get user's firms with their role
    const { data: firmUsers, error: firmUsersError } = await supabase
      .from("accounting_firm_users")
      .select("firm_id, role")
      .eq("user_id", user.id)

    if (firmUsersError) {
      console.error("Error fetching user firms:", firmUsersError)
      return NextResponse.json(
        { error: "Failed to fetch firm membership" },
        { status: 500 }
      )
    }

    if (!firmUsers || firmUsers.length === 0) {
      return NextResponse.json({ firms: [] })
    }

    const firmIds = firmUsers.map((fu) => fu.firm_id)

    // Get firm details
    const { data: firms, error: firmsError } = await supabase
      .from("accounting_firms")
      .select("id, name")
      .in("id", firmIds)

    if (firmsError) {
      console.error("Error fetching firms:", firmsError)
      return NextResponse.json(
        { error: "Failed to fetch firms" },
        { status: 500 }
      )
    }

    // Combine firm info with user role
    const firmsWithRole = (firms || []).map((firm) => {
      const firmUser = firmUsers.find((fu) => fu.firm_id === firm.id)
      return {
        firm_id: firm.id,
        firm_name: firm.name,
        role: firmUser?.role || null,
      }
    })

    return NextResponse.json({
      firms: firmsWithRole,
    })
  } catch (error: any) {
    console.error("Error in firm firms API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
