import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/afs/runs/[id]
 * 
 * Returns a specific AFS run by ID
 * 
 * Query Parameters:
 * - business_id (required)
 * 
 * Access: Admin/Owner/Accountant (read or write)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")

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

    // Get the AFS run
    const { data: run, error: runError } = await supabase
      .from("afs_runs")
      .select("*")
      .eq("id", id)
      .eq("business_id", businessId)
      .single()

    if (runError || !run) {
      return NextResponse.json(
        { error: "AFS run not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      run,
    })
  } catch (error: any) {
    console.error("Error in AFS run fetch:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
