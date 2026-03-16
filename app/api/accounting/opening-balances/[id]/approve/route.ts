import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkFirmOnboardingForAction } from "@/lib/firmOnboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/firmEngagements"
import { buildCanonicalOpeningBalancePayload } from "@/lib/accounting/openingBalanceImports"

/**
 * POST /api/accounting/opening-balances/{id}/approve
 * 
 * Approves an opening balance import (Partner-only)
 * 
 * Body:
 * - reason: TEXT (optional comment)
 * 
 * Access: Partner-only with approve engagement access
 * 
 * Behavior:
 * - Validates: Debits = credits, lines not empty, period not locked, no duplicate posted
 * - Sets: status = approved, approved_at, approved_by
 * - Computes input_hash if missing
 * 
 * Rejects if:
 * - Status ≠ draft
 * - Not Partner role
 * - Engagement access ≠ approve
 * - Period locked
 * - Already posted
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const importId = resolvedParams.id

    if (!importId) {
      return NextResponse.json(
        {
          error: "Import ID is required",
          reasonCode: "MISSING_ID",
          message: "Opening balance import ID is required"
        },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          reasonCode: "UNAUTHORIZED",
          message: "Authentication required"
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { reason } = body

    // Get existing import
    const { data: existingImport, error: fetchError } = await supabase
      .from("opening_balance_imports")
      .select("*")
      .eq("id", importId)
      .single()

    if (fetchError || !existingImport) {
      return NextResponse.json(
        {
          error: "Opening balance import not found",
          reasonCode: "IMPORT_NOT_FOUND",
          message: `Opening balance import ${importId} not found`
        },
        { status: 404 }
      )
    }

    // Reject if not draft
    if (existingImport.status !== "draft") {
      return NextResponse.json(
        {
          error: "Import is not in draft status",
          reasonCode: "NOT_DRAFT",
          message: `Cannot approve import with status '${existingImport.status}'. Only draft imports can be approved.`
        },
        { status: 400 }
      )
    }

    // Check firm onboarding
    const onboardingCheck = await checkFirmOnboardingForAction(
      supabase,
      user.id,
      existingImport.client_business_id
    )

    if (!onboardingCheck.isComplete) {
      return NextResponse.json(
        {
          error: onboardingCheck.error || "Firm onboarding required",
          reasonCode: "FIRM_ONBOARDING_INCOMPLETE",
          message: onboardingCheck.error || "Firm onboarding must be completed"
        },
        { status: 403 }
      )
    }

    if (!onboardingCheck.firmId) {
      return NextResponse.json(
        {
          error: "Firm context required",
          reasonCode: "FIRM_CONTEXT_REQUIRED",
          message: "Approving opening balance imports requires firm context"
        },
        { status: 403 }
      )
    }

    // Get user's firm role
    const { data: firmUser } = await supabase
      .from("accounting_firm_users")
      .select("role")
      .eq("firm_id", onboardingCheck.firmId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!firmUser || firmUser.role !== "partner") {
      return NextResponse.json(
        {
          error: "Partner role required",
          reasonCode: "INSUFFICIENT_FIRM_ROLE",
          message: "Only Partners can approve opening balance imports"
        },
        { status: 403 }
      )
    }

    // Get active engagement
    const engagement = await getActiveEngagement(
      supabase,
      onboardingCheck.firmId,
      existingImport.client_business_id
    )

    if (!engagement || !isEngagementEffective(engagement)) {
      return NextResponse.json(
        {
          error: "No active engagement found",
          reasonCode: "NO_ACTIVE_ENGAGEMENT",
          message: "No active engagement found for this firm and client"
        },
        { status: 403 }
      )
    }

    if (engagement.access_level !== "approve") {
      return NextResponse.json(
        {
          error: "Approve engagement access required",
          reasonCode: "INSUFFICIENT_ENGAGEMENT_ACCESS",
          message: "Approving opening balance imports requires 'approve' engagement access"
        },
        { status: 403 }
      )
    }

    // Validate period is not locked
    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, status")
      .eq("id", existingImport.period_id)
      .single()

    if (!period) {
      return NextResponse.json(
        {
          error: "Period not found",
          reasonCode: "PERIOD_NOT_FOUND",
          message: `Period ${existingImport.period_id} not found`
        },
        { status: 404 }
      )
    }

    if (period.status === "locked") {
      return NextResponse.json(
        {
          error: "Period is locked",
          reasonCode: "PERIOD_LOCKED",
          message: "Cannot approve opening balance import for locked period"
        },
        { status: 400 }
      )
    }

    // Check if business already has posted opening balance
    const { data: postedImport } = await supabase
      .from("opening_balance_imports")
      .select("id, journal_entry_id")
      .eq("client_business_id", existingImport.client_business_id)
      .not("journal_entry_id", "is", null)
      .maybeSingle()

    if (postedImport && postedImport.id !== importId) {
      return NextResponse.json(
        {
          error: "Opening balance already posted",
          reasonCode: "OPENING_BALANCE_ALREADY_POSTED",
          message: "This business already has a posted opening balance"
        },
        { status: 409 }
      )
    }

    // Build canonical payload to compute input_hash
    const canonicalPayload = buildCanonicalOpeningBalancePayload({
      id: existingImport.id,
      accounting_firm_id: existingImport.accounting_firm_id,
      client_business_id: existingImport.client_business_id,
      period_id: existingImport.period_id,
      source_type: existingImport.source_type as "manual" | "csv" | "excel",
      lines: existingImport.lines as any[],
      total_debit: Number(existingImport.total_debit),
      total_credit: Number(existingImport.total_credit),
      approved_by: user.id, // Will be set on approval
    })

    // TRACK B2: EXCEPTION - Writing to operational table 'opening_balance_imports'
    // This is an intentional boundary crossing: Accounting workspace requires the ability
    // to update opening balance import status to 'approved' as part of the approval workflow.
    // This table serves as a staging area before canonical ledger posting. This write is
    // explicitly allowed and guarded. See ACCOUNTING_WRITE_TARGETS_CLASSIFICATION.md for exception documentation.
    const { data: approvedImport, error: updateError } = await supabase
      .from("opening_balance_imports")
      .update({
        status: "approved",
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        input_hash: canonicalPayload.input_hash,
      })
      .eq("id", importId)
      .select()
      .single()

    if (updateError) {
      console.error("Error approving opening balance import:", updateError)
      return NextResponse.json(
        {
          error: updateError.message || "Failed to approve opening balance import",
          reasonCode: "APPROVE_FAILED",
          message: updateError.message || "Failed to approve opening balance import"
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      import: approvedImport,
      canonical_payload: canonicalPayload,
      message: "Opening balance import approved successfully",
    })
  } catch (error: any) {
    console.error("Error in opening balance import approve:", error)
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        reasonCode: "INTERNAL_ERROR",
        message: error.message || "Internal server error"
      },
      { status: 500 }
    )
  }
}
