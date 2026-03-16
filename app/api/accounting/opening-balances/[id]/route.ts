import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkFirmOnboardingForAction } from "@/lib/firmOnboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/firmEngagements"
import { buildCanonicalOpeningBalancePayload } from "@/lib/accounting/openingBalanceImports"
import { getBusinessIdFromRequest, missingBusinessIdResponse } from "@/lib/accounting/requireBusinessId"

/**
 * GET /api/accounting/opening-balances/{id}
 * 
 * Gets an opening balance import with optional canonical payload preview
 * 
 * Access: Firm user with read/write/approve engagement access
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const importId = resolvedParams.id
    const businessId = getBusinessIdFromRequest(request)

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
    if (!businessId) {
      return missingBusinessIdResponse("GET", `/api/accounting/opening-balances/${importId}`, "opening-balances/[id]")
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

    // Get import
    const { data: importData, error: fetchError } = await supabase
      .from("opening_balance_imports")
      .select("*")
      .eq("id", importId)
      .single()

    if (fetchError || !importData) {
      return NextResponse.json(
        {
          error: "Opening balance import not found",
          reasonCode: "IMPORT_NOT_FOUND",
          message: `Opening balance import ${importId} not found`
        },
        { status: 404 }
      )
    }

    if (importData.client_business_id !== businessId) {
      return NextResponse.json(
        { error: "Business mismatch", reasonCode: "BUSINESS_MISMATCH", message: "Import does not belong to the specified client" },
        { status: 403 }
      )
    }

    // Check firm onboarding and engagement
    const onboardingCheck = await checkFirmOnboardingForAction(
      supabase,
      user.id,
      importData.client_business_id
    )

    if (onboardingCheck.firmId) {
      const engagement = await getActiveEngagement(
        supabase,
        onboardingCheck.firmId,
        importData.client_business_id
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
    }

    // Build canonical payload preview if approved
    let canonicalPayload = null
    if (importData.status === "approved" && importData.input_hash) {
      try {
        canonicalPayload = buildCanonicalOpeningBalancePayload({
          id: importData.id,
          accounting_firm_id: importData.accounting_firm_id,
          client_business_id: importData.client_business_id,
          period_id: importData.period_id,
          source_type: importData.source_type as "manual" | "csv" | "excel",
          lines: importData.lines as any[],
          total_debit: Number(importData.total_debit),
          total_credit: Number(importData.total_credit),
          approved_by: importData.approved_by,
        })
      } catch (error) {
        console.error("Error building canonical payload:", error)
        // Don't fail the request, just omit canonical payload
      }
    }

    return NextResponse.json({
      success: true,
      import: importData,
      canonical_payload: canonicalPayload,
    })
  } catch (error: any) {
    console.error("Error in opening balance import get:", error)
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

/**
 * PATCH /api/accounting/opening-balances/{id}
 * 
 * Updates an opening balance import (draft only)
 * 
 * Body:
 * - lines: [{ account_id, debit, credit, memo }]
 * 
 * Access: Firm user with write/approve engagement access (draft creator or firm user)
 * 
 * Rejects if:
 * - Status ≠ draft
 */
export async function PATCH(
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
    const { lines } = body

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
          message: `Cannot update import with status '${existingImport.status}'. Only draft imports can be updated.`
        },
        { status: 400 }
      )
    }

    // Check firm onboarding and engagement
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

    // Check authority: Update requires write/approve access and user must be creator or firm user
    if (onboardingCheck.firmId) {
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("role")
        .eq("firm_id", onboardingCheck.firmId)
        .eq("user_id", user.id)
        .maybeSingle()

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

      // Check if user is creator or has write/approve access
      if (existingImport.created_by !== user.id) {
        if (engagement.access_level !== "write" && engagement.access_level !== "approve") {
          return NextResponse.json(
            {
              error: "Insufficient access",
              reasonCode: "INSUFFICIENT_ACCESS",
              message: "Only the creator or users with write/approve access can update drafts"
            },
            { status: 403 }
          )
        }
      }
    } else {
      // Not accessing via firm - check if user is creator
      if (existingImport.created_by !== user.id) {
        return NextResponse.json(
          {
            error: "Unauthorized",
            reasonCode: "NOT_CREATOR",
            message: "Only the creator can update this draft"
          },
          { status: 403 }
        )
      }
    }

    // Validate lines if provided
    if (lines !== undefined) {
      if (!Array.isArray(lines) || lines.length === 0) {
        return NextResponse.json(
          {
            error: "Lines must be a non-empty array",
            reasonCode: "INVALID_LINES",
            message: "Lines must be a non-empty array"
          },
          { status: 400 }
        )
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.account_id) {
          return NextResponse.json(
            {
              error: `Line ${i + 1}: account_id is required`,
              reasonCode: "INVALID_LINE",
              message: `Line ${i + 1} is missing account_id`
            },
            { status: 400 }
          )
        }
        if (line.debit === undefined && line.credit === undefined) {
          return NextResponse.json(
            {
              error: `Line ${i + 1}: Either debit or credit must be provided`,
              reasonCode: "INVALID_LINE",
              message: `Line ${i + 1} must have either debit or credit`
            },
            { status: 400 }
          )
        }
      }
    }

    // TRACK B2: EXCEPTION - Writing to operational table 'opening_balance_imports'
    // This is an intentional boundary crossing: Accounting workspace requires the ability
    // to update draft opening balance imports (lines, status) as part of the draft workflow.
    // This table serves as a staging area before canonical ledger posting. This write is
    // explicitly allowed and guarded. See ACCOUNTING_WRITE_TARGETS_CLASSIFICATION.md for exception documentation.
    const updateData: any = {}
    if (lines !== undefined) {
      updateData.lines = lines
    }

    const { data: updatedImport, error: updateError } = await supabase
      .from("opening_balance_imports")
      .update(updateData)
      .eq("id", importId)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating opening balance import:", updateError)
      return NextResponse.json(
        {
          error: updateError.message || "Failed to update opening balance import",
          reasonCode: "UPDATE_FAILED",
          message: updateError.message || "Failed to update opening balance import"
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      import: updatedImport,
      message: "Opening balance import updated successfully",
    })
  } catch (error: any) {
    console.error("Error in opening balance import update:", error)
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
