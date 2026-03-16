import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/afs/runs
 * 
 * Returns list of AFS runs for a business
 * 
 * Query Parameters:
 * - business_id (required)
 * - status (optional) - filter by status ('draft' or 'finalized')
 * 
 * Access: Admin/Owner/Accountant (read or write)
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

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    const status = searchParams.get("status")

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view AFS runs." },
        { status: 403 }
      )
    }

    // Build query
    let query = supabase
      .from("afs_runs")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })

    // Filter by status if provided
    if (status && (status === "draft" || status === "finalized")) {
      query = query.eq("status", status)
    }

    const { data: runs, error: runsError } = await query

    if (runsError) {
      console.error("Error fetching AFS runs:", runsError)
      return NextResponse.json(
        { error: runsError.message || "Failed to fetch AFS runs" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      runs: runs || [],
    })
  } catch (error: any) {
    console.error("Error in AFS runs list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
