import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { logAudit } from "@/lib/auditLog"
import { enforceServiceIndustryBusinessTierForAccountingWrite } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import {
  deniedMutationResponse,
  getAccountingDataClient,
  resolveAccountingRequestAuthority,
} from "@/lib/accounting/resolveAccountingRequestAuthority"
import {
  createRouteDiag,
  jsonResponseWithServerTiming,
  timedStepMs,
} from "@/lib/server/routeDiagnostics"

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
  const routeT0 = performance.now()
  const diag = createRouteDiag("adjustments_apply")
  const respond = <T>(body: T, status: number) =>
    jsonResponseWithServerTiming(body, {
      status,
      serverTiming: diag.serverTimingHeader([{ name: "total", dur: timedStepMs(routeT0) }]),
    })

  try {
    const tAuth = performance.now()
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    diag.recordTiming("auth", timedStepMs(tAuth), "session")

    if (!user) {
      return respond({ error: "Unauthorized" }, 401)
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

    if (!business_id || !period_start || !entry_date || !description || !lines) {
      return NextResponse.json(
        { error: "Missing required fields: business_id, period_start, entry_date, description, lines" },
        { status: 400 }
      )
    }

    const authResult = await resolveAccountingRequestAuthority({
      supabase,
      userId: user.id,
      businessId: String(business_id),
      requiredLevel: "write",
      authorityContext: "practice-client-books",
    })
    if (authResult.timings) {
      diag.recordTiming("role", authResult.timings.role_ms)
      diag.recordTiming("authority", authResult.timings.authority_ms)
    }
    if (!authResult.ok) {
      const denied = deniedMutationResponse(authResult, "write", "create adjusting journals")
      return respond(denied.body, denied.status)
    }

    const resolvedBusinessId = authResult.businessId
    const dataClient = getAccountingDataClient(authResult, supabase)

    const tierBlockAdj = await enforceServiceIndustryBusinessTierForAccountingWrite(
      supabase,
      user.id,
      resolvedBusinessId,
      "business"
    )
    if (tierBlockAdj) return tierBlockAdj

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

    if (!/^\d{4}-\d{2}-01$/.test(period_start)) {
      return NextResponse.json(
        { error: "period_start must be the first day of the month (YYYY-MM-01)" },
        { status: 400 }
      )
    }
    const periodStartDate = new Date(period_start)
    if (isNaN(periodStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid period_start format. Must be YYYY-MM-DD" },
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

    // Convert lines to JSONB format expected by function
    // Ensure exactly one of debit/credit per line, and amounts are properly formatted
    const formattedLines = lines.map((line: any) => ({
      account_id: line.account_id,
      debit: line.debit || 0,
      credit: line.credit || 0,
      description: line.description || null,
    }))

    // PHASE 6: Call the canonical apply_adjusting_journal RPC function with adjustment metadata
    const tRpc = performance.now()
    const { data: journalEntryId, error: rpcError } = await dataClient.rpc("apply_adjusting_journal", {
      p_business_id: resolvedBusinessId,
      p_period_start: period_start,
      p_entry_date: entry_date,
      p_description: description.trim(),
      p_lines: formattedLines,
      p_created_by: user.id,
      p_adjustment_reason: adjustment_reason.trim(),
      p_adjustment_ref: adjustment_ref?.trim() || null,
    })

    diag.recordTiming("rpc", timedStepMs(tRpc), "apply_adjusting_journal")
    if (rpcError) {
      console.error("Error applying adjusting journal:", rpcError)
      return respond(
        { error: rpcError.message || "Failed to apply adjusting journal" },
        400
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        { error: "Failed to apply adjusting journal - no journal entry ID returned" },
        { status: 500 }
      )
    }

    const { data: periodRow } = await dataClient
      .from("accounting_periods")
      .select("id")
      .eq("business_id", resolvedBusinessId)
      .eq("period_start", period_start)
      .maybeSingle()
    const period_id = periodRow?.id ?? null

    const tAudit = performance.now()
    await logAudit({
      businessId: resolvedBusinessId,
      userId: user.id,
      actionType: "adjustment",
      entityType: "journal_entry",
      entityId: journalEntryId,
      description: (adjustment_reason && typeof adjustment_reason === "string" ? adjustment_reason.trim() : description?.trim()) || "Adjusting journal applied",
      newValues: { period_id, business_id: resolvedBusinessId },
      request,
    })

    diag.recordTiming("audit", timedStepMs(tAudit))
    return respond({
      success: true,
      journal_entry_id: journalEntryId,
      message: "Adjusting journal applied successfully",
    }, 200)
  } catch (error: unknown) {
    console.error("Error in adjusting journal apply:", error)
    return respond(
      { error: error instanceof Error ? error.message : "Internal server error" },
      500
    )
  }
}
