import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/afs/runs/[id]/export/pdf
 * 
 * Exports AFS run as PDF (placeholder hook - no rendering yet)
 * 
 * Query Parameters:
 * - business_id (required)
 * - document_type (optional) - filter by document type
 * 
 * Access: Admin/Owner/Accountant (read or write)
 * 
 * PDF Format:
 * - Placeholder: Returns JSON response indicating PDF export is not yet implemented
 * - Future: Will generate PDF with run metadata and documents
 * - Will include input_hash and metadata
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
        { error: "Unauthorized. Only admins, owners, or accountants can export AFS runs." },
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

    // Placeholder: PDF export not yet implemented
    return NextResponse.json(
      {
        message: "PDF export for AFS runs is not yet implemented",
        run_id: id,
        input_hash: run.input_hash,
        status: run.status,
        note: "Use JSON or CSV export endpoints for now. PDF export will be implemented in a future update.",
      },
      { status: 501 }
    )
  } catch (error: any) {
    console.error("Error in AFS PDF export:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
