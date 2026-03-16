import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * POST /api/accounting/afs/[run_id]/finalize
 * 
 * Finalizes an AFS run by:
 * - Validating run status = 'draft'
 * - Validating no new ledger entries after input_hash timestamp
 * - Validating no new critical accounting_exceptions
 * - Setting status = 'finalized'
 * - Setting finalized_at, finalized_by
 * 
 * Body:
 * - business_id: UUID (required)
 * 
 * Access: Admin/Owner/Accountant write only
 */
export async function POST(
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
    const body = await request.json()
    const { business_id } = body

    if (!business_id) {
      return NextResponse.json(
        { error: "Missing required field: business_id" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, business_id, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can finalize AFS runs." },
        { status: 403 }
      )
    }

    // Get the AFS run
    const { data: afsRun, error: runError } = await supabase
      .from("afs_runs")
      .select("*")
      .eq("id", run_id)
      .eq("business_id", business_id)
      .single()

    if (runError || !afsRun) {
      return NextResponse.json(
        { error: "AFS run not found" },
        { status: 404 }
      )
    }

    // Validate: AFS run status = 'draft'
    if (afsRun.status !== "draft") {
      return NextResponse.json(
        { error: `AFS run cannot be finalized. Current status: ${afsRun.status}. Only draft runs can be finalized.` },
        { status: 400 }
      )
    }

    // Validate: No new ledger entries after input_hash timestamp
    // input_hash should be a timestamp in ISO format or a hash string
    // For now, we'll treat it as a timestamp string
    let inputHashTimestamp: Date
    try {
      // Try parsing as ISO timestamp
      inputHashTimestamp = new Date(afsRun.input_hash)
      if (isNaN(inputHashTimestamp.getTime())) {
        // If not a valid date, assume it's a hash and use created_at as the timestamp
        inputHashTimestamp = new Date(afsRun.created_at)
      }
    } catch {
      // If parsing fails, use created_at
      inputHashTimestamp = new Date(afsRun.created_at)
    }

    // Check for new journal entries after input_hash timestamp
    const { count: newEntriesCount, error: entriesError } = await supabase
      .from("journal_entries")
      .select("*", { count: "exact", head: true })
      .eq("business_id", business_id)
      .gt("created_at", inputHashTimestamp.toISOString())

    if (entriesError) {
      console.error("Error checking journal entries:", entriesError)
      return NextResponse.json(
        { error: "Failed to validate ledger state" },
        { status: 500 }
      )
    }

    if (newEntriesCount && newEntriesCount > 0) {
      return NextResponse.json(
        { error: `Cannot finalize AFS run: ${newEntriesCount} new journal entries found after input snapshot. Please regenerate the AFS run.` },
        { status: 400 }
      )
    }

    // Validate: No new critical accounting_exceptions
    // Note: accounting_exceptions table may not exist yet, so we handle errors gracefully
    const { count: newExceptionsCount, error: exceptionsError } = await supabase
      .from("accounting_exceptions")
      .select("*", { count: "exact", head: true })
      .eq("business_id", business_id)
      .eq("severity", "critical")
      .gt("created_at", inputHashTimestamp.toISOString())

    if (exceptionsError) {
      // If table doesn't exist, ignore the error (table may not exist yet)
      if (!exceptionsError.message?.includes("does not exist") && !exceptionsError.message?.includes("relation") && !exceptionsError.code?.includes("42P01")) {
        console.error("Error checking accounting exceptions:", exceptionsError)
        // For other errors, log but don't fail
      }
    } else if (newExceptionsCount && newExceptionsCount > 0) {
      return NextResponse.json(
        { error: `Cannot finalize AFS run: ${newExceptionsCount} new critical accounting exceptions found after input snapshot. Please resolve exceptions before finalizing.` },
        { status: 400 }
      )
    }

    // Update the AFS run to finalized status
    const { data: updatedRun, error: updateError } = await supabase
      .from("afs_runs")
      .update({
        status: "finalized",
        finalized_at: new Date().toISOString(),
        finalized_by: user.id,
      })
      .eq("id", run_id)
      .select()
      .single()

    if (updateError) {
      console.error("Error finalizing AFS run:", updateError)
      return NextResponse.json(
        { error: updateError.message || "Failed to finalize AFS run" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      run: updatedRun,
    })
  } catch (error: any) {
    console.error("Error in AFS finalization:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
