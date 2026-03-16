import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/afs/documents/[run_id]
 * 
 * Returns all documents for a specific AFS run
 * 
 * Query Parameters:
 * - business_id (required)
 * - document_type (optional) - filter by document type
 * 
 * Access: Admin/Owner/Accountant (read or write)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ run_id: string }> | { run_id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { run_id } = await Promise.resolve(params)
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    const documentType = searchParams.get("document_type")

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can view AFS documents." },
        { status: 403 }
      )
    }

    // Verify the AFS run exists and belongs to the business
    const { data: run, error: runError } = await supabase
      .from("afs_runs")
      .select("id")
      .eq("id", run_id)
      .eq("business_id", businessId)
      .single()

    if (runError || !run) {
      return NextResponse.json(
        { error: "AFS run not found" },
        { status: 404 }
      )
    }

    // Build query for documents
    let query = supabase
      .from("afs_documents")
      .select("*")
      .eq("afs_run_id", run_id)
      .order("created_at", { ascending: true })

    // Filter by document type if provided
    if (documentType) {
      query = query.eq("document_type", documentType)
    }

    const { data: documents, error: documentsError } = await query

    if (documentsError) {
      console.error("Error fetching AFS documents:", documentsError)
      return NextResponse.json(
        { error: documentsError.message || "Failed to fetch AFS documents" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      documents: documents || [],
    })
  } catch (error: any) {
    console.error("Error in AFS documents fetch:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
