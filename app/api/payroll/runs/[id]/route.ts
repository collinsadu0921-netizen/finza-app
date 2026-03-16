import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business from query or use first business
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Get payroll run
    const { data: payrollRun, error: runError } = await supabase
      .from("payroll_runs")
      .select("*")
      .eq("id", runId)
      .single()

    if (runError || !payrollRun) {
      return NextResponse.json(
        { error: "Payroll run not found" },
        { status: 404 }
      )
    }

    // Get payroll entries with staff details
    const { data: entries, error: entriesError } = await supabase
      .from("payroll_entries")
      .select(
        `
        *,
        staff (
          id,
          name,
          position,
          email,
          phone
        )
      `
      )
      .eq("payroll_run_id", runId)
      .order("staff(name)", { ascending: true })

    if (entriesError) {
      console.error("Error fetching payroll entries:", entriesError)
    }

    return NextResponse.json({
      payrollRun,
      entries: entries || [],
    })
  } catch (error: any) {
    console.error("Error fetching payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const runId = resolvedParams.id

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    // AUTH DISABLED FOR DEVELOPMENT
    // if (!user) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    // }

    // AUTH DISABLED FOR DEVELOPMENT - Get business from query or use first business
    let business: { id: string } | null = null
    if (user) {
      business = await getCurrentBusiness(supabase, user.id)
    }
    
    if (!business) {
      const { data: firstBusiness } = await supabase
        .from("businesses")
        .select("id")
        .limit(1)
        .single()
      if (firstBusiness) {
        business = firstBusiness
      }
    }

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { status, notes } = body
    let journalEntryId: string | null = null

    // Get existing payroll run
    const { data: existingRun } = await supabase
      .from("payroll_runs")
      .select("status, journal_entry_id")
      .eq("id", runId)
      .single()

    if (!existingRun) {
      return NextResponse.json(
        { error: "Payroll run not found" },
        { status: 404 }
      )
    }

    // Validate status transitions (enforce workflow: draft → approved → locked)
    if (status && status !== existingRun.status) {
      const validTransitions: Record<string, string[]> = {
        'draft': ['approved'],
        'approved': ['locked'],
        'locked': [], // Locked payroll cannot be changed
      }

      const allowedTransitions = validTransitions[existingRun.status] || []
      if (!allowedTransitions.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status transition from "${existingRun.status}" to "${status}". Allowed transitions: ${allowedTransitions.join(', ') || 'none'}` },
          { status: 400 }
        )
      }
    }

    // If approving, post to ledger (must succeed or approval fails)
    if (status === "approved" && existingRun.status !== "approved") {
      // Check if already posted
      if (existingRun.journal_entry_id) {
        return NextResponse.json(
          { error: "Payroll run has already been posted to ledger" },
          { status: 400 }
        )
      }

      // Post to ledger - if this fails, approval must fail
      const { data: postedJournalId, error: ledgerError } = await supabase.rpc(
        "post_payroll_to_ledger",
        {
          p_payroll_run_id: runId,
        }
      )
      journalEntryId = postedJournalId ?? null

      if (ledgerError || !journalEntryId) {
        console.error("Error posting payroll to ledger:", ledgerError)
        return NextResponse.json(
          { error: ledgerError?.message || "Failed to post payroll to ledger. Approval cannot proceed." },
          { status: 500 }
        )
      }

      console.log("Payroll posted to ledger:", journalEntryId)
    }

    const updateData: any = {}
    if (status) {
      updateData.status = status
      if (status === "approved") {
        updateData.approved_by = user?.id || null
        updateData.approved_at = new Date().toISOString()
        if (journalEntryId) updateData.journal_entry_id = journalEntryId
      }
    }
    if (notes !== undefined) updateData.notes = notes?.trim() || null

    const { data: payrollRun, error } = await supabase
      .from("payroll_runs")
      .update(updateData)
      .eq("id", runId)
      .select()
      .single()

    if (error) {
      console.error("Error updating payroll run:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ payrollRun })
  } catch (error: any) {
    console.error("Error updating payroll run:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}


