import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { logAudit } from "@/lib/auditLog"

/**
 * POST /api/accounting/adjustments/apply
 * 
 * Applies adjusting journal entry to an open accounting period
 * 
 * Body:
 * - business_id: UUID
 * - period_start: DATE (YYYY-MM-01 format)
 * - entry_date: DATE (must fall within period)
 * - description: TEXT (required)
 * - lines: [{ account_id, debit, credit }] (array, minimum 2 lines)
 * - adjustment_reason: TEXT (required, PHASE 6: non-empty explanation for adjustment)
 * - adjustment_ref: TEXT (optional, PHASE 6: external ticket/audit reference)
 * 
 * Access: Admin/Owner/Accountant write only
 * 
 * PHASE 6: Calls the canonical apply_adjusting_journal RPC function
 * Allows adjustments in 'open' or 'soft_closed' periods (not 'locked')
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      business_id,
      period_start,
      entry_date,
      description,
      lines,
      adjustment_reason,
      adjustment_ref,
    } = body

    // Validate required fields
    if (!business_id || !period_start || !entry_date || !description || !lines) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start, entry_date, description, lines" },
        { status: 400 }
      )
    }

    // PHASE 6: Validate adjustment_reason is required
    if (!adjustment_reason || typeof adjustment_reason !== 'string' || adjustment_reason.trim().length === 0) {
      return NextResponse.json(
        { error: "adjustment_reason is required and cannot be empty" },
        { status: 400 }
      )
    }

    // Validate description is not empty
    if (typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json(
        { error: "Description is required and cannot be empty" },
        { status: 400 }
      )
    }

    // Validate period_start format (YYYY-MM-01)
    const periodStartDate = new Date(period_start)
    if (isNaN(periodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid period_start format. Must be YYYY-MM-DD" },
        { status: 400 }
      )
    }

    // Verify period_start is first day of month
    const expectedFirstDay = new Date(
      periodStartDate.getFullYear(),
      periodStartDate.getMonth(),
      1
    )
    if (periodStartDate.getTime() !== expectedFirstDay.getTime()) {
      return NextResponse.json(
        { error: "period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }

    // Validate entry_date format
    const entryDate = new Date(entry_date)
    if (isNaN(entryDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid entry_date format. Must be YYYY-MM-DD" },
        { status: 400 }
      )
    }

    // Validate lines is an array with at least 2 elements
    if (!Array.isArray(lines) || lines.length < 2) {
      return NextResponse.json(
        { error: "lines must be an array with at least 2 elements" },
        { status: 400 }
      )
    }

    // Validate each line has required fields
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!line.account_id) {
        return NextResponse.json(
          { error: `Line ${i + 1}: account_id is required` },
          { status: 400 }
        )
      }
      if (line.debit === undefined && line.credit === undefined) {
        return NextResponse.json(
          { error: `Line ${i + 1}: Either debit or credit must be provided` },
          { status: 400 }
        )
      }
      // Validate amounts are numbers and >= 0
      if (line.debit !== undefined && (typeof line.debit !== 'number' || line.debit < 0)) {
        return NextResponse.json(
          { error: `Line ${i + 1}: debit must be a non-negative number` },
          { status: 400 }
        )
      }
      if (line.credit !== undefined && (typeof line.credit !== 'number' || line.credit < 0)) {
        return NextResponse.json(
          { error: `Line ${i + 1}: credit must be a non-negative number` },
          { status: 400 }
        )
      }
    }

    // Verify business exists (access will be checked by role check below)
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", business_id)
      .single()

    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, business_id, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants with write access can apply adjusting journals." },
        { status: 403 }
      )
    }

    // Convert lines to JSONB format expected by function
    // Ensure exactly one of debit/credit per line, and amounts are properly formatted
    const formattedLines = lines.map((line: any) => ({
      account_id: line.account_id,
      debit: line.debit || 0,
      credit: line.credit || 0,
      description: line.description || null,
    }))

    // PHASE 6: Call the canonical apply_adjusting_journal RPC function with adjustment metadata
    const { data: journalEntryId, error: rpcError } = await supabase.rpc("apply_adjusting_journal", {
      p_business_id: business_id,
      p_period_start: period_start,
      p_entry_date: entry_date,
      p_description: description.trim(),
      p_lines: formattedLines,
      p_created_by: user.id,
      p_adjustment_reason: adjustment_reason.trim(),
      p_adjustment_ref: adjustment_ref?.trim() || null,
    })

    if (rpcError) {
      console.error("Error applying adjusting journal:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to apply adjusting journal" },
        { status: 400 } // Usually validation errors, not 500
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        { error: "Failed to apply adjusting journal - no journal entry ID returned" },
        { status: 500 }
      )
    }

    const { data: periodRow } = await supabase
      .from("accounting_periods")
      .select("id")
      .eq("business_id", business_id)
      .eq("period_start", period_start)
      .maybeSingle()
    const period_id = periodRow?.id ?? null

    await logAudit({
      businessId: business_id,
      userId: user.id,
      actionType: "adjustment",
      entityType: "journal_entry",
      entityId: journalEntryId,
      description: (adjustment_reason && typeof adjustment_reason === "string" ? adjustment_reason.trim() : description?.trim()) || "Adjusting journal applied",
      newValues: { period_id, business_id },
      request,
    })

    return NextResponse.json({
      success: true,
      journal_entry_id: journalEntryId,
      message: "Adjusting journal applied successfully",
    })
  } catch (error: any) {
    console.error("Error in adjusting journal apply:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
