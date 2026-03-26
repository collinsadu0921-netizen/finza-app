import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

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
    const status = searchParams.get("status")

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
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
      .eq("business_id", resolvedBusinessId)
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
