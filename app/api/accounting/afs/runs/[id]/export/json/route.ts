import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/afs/runs/[id]/export/json
 * 
 * Exports AFS run as JSON (canonical format)
 * Includes run metadata, input_hash, and all documents
 * 
 * Query Parameters:
 * - business_id (required)
 * 
 * Access: Admin/Owner/Accountant (read or write)
 * 
 * JSON Format:
 * - Run metadata (id, status, input_hash, finalized_at, etc.)
 * - Documents array with document_type and document_data
 * - All metadata for reproducibility
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

    // Get all documents for this run
    const { data: documents, error: documentsError } = await supabase
      .from("afs_documents")
      .select("*")
      .eq("afs_run_id", id)
      .order("created_at", { ascending: true })

    if (documentsError) {
      console.error("Error fetching AFS documents:", documentsError)
      return NextResponse.json(
        { error: documentsError.message || "Failed to fetch AFS documents" },
        { status: 500 }
      )
    }

    // Build export object
    const exportData = {
      run: {
        id: run.id,
        business_id: run.business_id,
        status: run.status,
        input_hash: run.input_hash,
        period_start: run.period_start,
        period_end: run.period_end,
        finalized_at: run.finalized_at,
        finalized_by: run.finalized_by,
        metadata: run.metadata,
        created_at: run.created_at,
        created_by: run.created_by,
      },
      documents: documents || [],
      export_metadata: {
        exported_at: new Date().toISOString(),
        exported_by: user.id,
        format: "json",
        version: "1.0",
      },
    }

    // Return JSON response
    return NextResponse.json(exportData, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="afs-run-${id}.json"`,
      },
    })
  } catch (error: any) {
    console.error("Error in AFS JSON export:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
