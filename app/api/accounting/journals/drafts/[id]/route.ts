import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkFirmOnboardingForAction } from "@/lib/accounting/firm/onboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/accounting/firm/engagements"
import { resolveAuthority } from "@/lib/accounting/firm/authority"
import { logBlockedActionAttempt, logFirmActivity } from "@/lib/accounting/firm/activityLog"
import { getBusinessIdFromRequest, missingBusinessIdResponse } from "@/lib/accounting/requireBusinessId"
import { checkAccountingAuthority } from "@/lib/accounting/auth"

/**
 * GET /api/accounting/journals/drafts/{id}
 * 
 * Fetches a single manual journal draft
 * 
 * Returns:
 * - draft: Draft object with related data (period, users, accounts)
 * 
 * Access: Read engagement + Junior role
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          reasonCode: "UNAUTHORIZED",
          message: "Unauthorized",
        },
        { status: 401 }
      )
    }

    const { id } = await params
    const businessId = getBusinessIdFromRequest(request)
    if (!businessId) {
      return missingBusinessIdResponse("GET", `/api/accounting/journals/drafts/${id}`, "journals/drafts/[id]")
    }

    // Get draft with related data
    const { data: draft, error: fetchError } = await supabase
      .from("manual_journal_drafts")
      .select(
        `
        *,
        created_by_user:created_by(id, email, raw_user_meta_data),
        submitted_by_user:submitted_by(id, email, raw_user_meta_data),
        approved_by_user:approved_by(id, email, raw_user_meta_data),
        rejected_by_user:rejected_by(id, email, raw_user_meta_data),
        period:period_id(id, period_start, period_end, status)
        `
      )
      .eq("id", id)
      .single()

    if (fetchError || !draft) {
      return NextResponse.json(
        {
          reasonCode: "NOT_FOUND",
          message: "Draft not found",
        },
        { status: 404 }
      )
    }

    if (draft.client_business_id !== businessId) {
      return NextResponse.json(
        { error: "Business mismatch", reasonCode: "BUSINESS_MISMATCH", message: "Draft does not belong to the specified client" },
        { status: 403 }
      )
    }

    const isOwnerMode = draft.accounting_firm_id === null

    if (isOwnerMode) {
      // ---------- Owner-mode: require accounting authority ----------
      const auth = await checkAccountingAuthority(supabase, user.id, draft.client_business_id, "write")
      if (!auth.authorized) {
        return NextResponse.json(
          {
            reasonCode: "FORBIDDEN",
            message: "You do not have write access to this business",
          },
          { status: 403 }
        )
      }
    } else {
      // ---------- Firm-mode: onboarding + draft belongs to firm ----------
      const onboardingCheck = await checkFirmOnboardingForAction(
        supabase,
        user.id,
        draft.client_business_id
      )
      if (!onboardingCheck.isComplete || !onboardingCheck.firmId) {
        return NextResponse.json(
          {
            reasonCode: "NO_ENGAGEMENT",
            message: "No firm found for this user",
          },
          { status: 403 }
        )
      }
      if (draft.accounting_firm_id !== onboardingCheck.firmId) {
        return NextResponse.json(
          {
            reasonCode: "FORBIDDEN",
            message: "Draft does not belong to your firm",
          },
          { status: 403 }
        )
      }
    }

    // Fetch account details for lines
    const lineAccountIds = (draft.lines as any[] || [])
      .map((line: any) => line.account_id)
      .filter((id: string) => id)

    let accounts: any[] = []
    if (lineAccountIds.length > 0) {
      const { data: accountsData } = await supabase
        .from("accounts")
        .select("id, code, name, type")
        .in("id", lineAccountIds)

      accounts = accountsData || []
    }

    // Enrich lines with account details
    const enrichedLines = (draft.lines as any[] || []).map((line: any) => {
      const account = accounts.find((a) => a.id === line.account_id)
      return {
        ...line,
        account: account
          ? {
              id: account.id,
              code: account.code,
              name: account.name,
              type: account.type,
            }
          : null,
      }
    })

    return NextResponse.json({
      success: true,
      draft: {
        ...draft,
        lines: enrichedLines,
      },
    })
  } catch (error: any) {
    console.error("Error in get draft:", error)
    return NextResponse.json(
      {
        reasonCode: "INTERNAL_ERROR",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/accounting/journals/drafts/{id}
 * 
 * Updates a manual journal draft (draft status only)
 * 
 * Body:
 * - entry_date?: DATE
 * - description?: TEXT
 * - lines?: [{ account_id: UUID, debit: NUMERIC, credit: NUMERIC, memo?: TEXT }]
 * 
 * Rules:
 * - Status must be 'draft'
 * - Only creator can edit
 * - Period must be open
 * - Re-validate balance via trigger
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          reasonCode: "UNAUTHORIZED",
          message: "Unauthorized",
        },
        { status: 401 }
      )
    }

    const { id } = await params
    const businessId = getBusinessIdFromRequest(request)
    if (!businessId) {
      return missingBusinessIdResponse("PATCH", `/api/accounting/journals/drafts/${id}`, "journals/drafts/[id]")
    }
    const body = await request.json()
    const { period_id, entry_date, description, lines } = body

    // Get draft
    const { data: draft, error: fetchError } = await supabase
      .from("manual_journal_drafts")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !draft) {
      return NextResponse.json(
        {
          reasonCode: "NOT_FOUND",
          message: "Draft not found",
        },
        { status: 404 }
      )
    }

    if (draft.client_business_id !== businessId) {
      return NextResponse.json(
        { error: "Business mismatch", reasonCode: "BUSINESS_MISMATCH", message: "Draft does not belong to the specified client" },
        { status: 403 }
      )
    }

    // Check status is draft
    if (draft.status !== "draft") {
      return NextResponse.json(
        {
          reasonCode: "INVALID_STATUS_TRANSITION",
          message: "Only drafts in 'draft' status can be updated",
        },
        { status: 400 }
      )
    }

    // Check user is the creator
    if (draft.created_by !== user.id) {
      return NextResponse.json(
        {
          reasonCode: "NOT_DRAFT_OWNER",
          message: "Only the draft creator can update the draft",
        },
        { status: 403 }
      )
    }

    const isOwnerMode = draft.accounting_firm_id === null

    if (isOwnerMode) {
      const auth = await checkAccountingAuthority(supabase, user.id, draft.client_business_id, "write")
      if (!auth.authorized) {
        return NextResponse.json(
          {
            reasonCode: "FORBIDDEN",
            message: "You do not have write access to this business",
          },
          { status: 403 }
        )
      }
    } else {
      const onboardingCheck = await checkFirmOnboardingForAction(
        supabase,
        user.id,
        draft.client_business_id
      )
      if (!onboardingCheck.isComplete) {
        return NextResponse.json(
          {
            reasonCode: "FIRM_ONBOARDING_REQUIRED",
            message: onboardingCheck.error || "Firm onboarding required",
          },
          { status: 403 }
        )
      }
    }

    // Get period to check if open
    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, status")
      .eq("id", draft.period_id)
      .single()

    if (!period) {
      return NextResponse.json(
        {
          reasonCode: "NOT_FOUND",
          message: "Period not found",
        },
        { status: 404 }
      )
    }

    // Check period is open
    if (period.status === "locked") {
      return NextResponse.json(
        {
          reasonCode: "PERIOD_CLOSED",
          message: "Period is locked. Cannot update drafts for locked periods.",
        },
        { status: 403 }
      )
    }

    // Validate description if provided
    if (description !== undefined) {
      if (typeof description !== "string" || description.trim().length === 0) {
        return NextResponse.json(
          {
            reasonCode: "VALIDATION_ERROR",
            message: "Description cannot be empty",
          },
          { status: 400 }
        )
      }
    }

    // Validate lines if provided
    if (lines !== undefined) {
      if (!Array.isArray(lines) || lines.length < 2) {
        return NextResponse.json(
          {
            reasonCode: "VALIDATION_ERROR",
            message: "lines must be an array with at least 2 elements",
          },
          { status: 400 }
        )
      }

      // Validate each line
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.account_id) {
          return NextResponse.json(
            {
              reasonCode: "VALIDATION_ERROR",
              message: `Line ${i + 1}: account_id is required`,
            },
            { status: 400 }
          )
        }
        if (line.debit === undefined && line.credit === undefined) {
          return NextResponse.json(
            {
              reasonCode: "VALIDATION_ERROR",
              message: `Line ${i + 1}: Either debit or credit must be provided`,
            },
            { status: 400 }
          )
        }
        if (line.debit !== undefined && (typeof line.debit !== "number" || line.debit < 0)) {
          return NextResponse.json(
            {
              reasonCode: "VALIDATION_ERROR",
              message: `Line ${i + 1}: debit must be a non-negative number`,
            },
            { status: 400 }
          )
        }
        if (line.credit !== undefined && (typeof line.credit !== "number" || line.credit < 0)) {
          return NextResponse.json(
            {
              reasonCode: "VALIDATION_ERROR",
              message: `Line ${i + 1}: credit must be a non-negative number`,
            },
            { status: 400 }
          )
        }
      }
    }

    // Build update object
    const updateData: any = {}
    if (period_id !== undefined && period_id !== draft.period_id) {
      // Validate new period exists and is open
      const { data: newPeriod } = await supabase
        .from("accounting_periods")
        .select("id, status, business_id, period_start, period_end")
        .eq("id", period_id)
        .single()

      if (!newPeriod) {
        return NextResponse.json(
          {
            reasonCode: "NOT_FOUND",
            message: "Period not found",
          },
          { status: 404 }
        )
      }

      // Verify period belongs to same business
      if (newPeriod.business_id !== draft.client_business_id) {
        return NextResponse.json(
          {
            reasonCode: "VALIDATION_ERROR",
            message: "Period does not belong to the same business",
          },
          { status: 400 }
        )
      }

      if (newPeriod.status === "locked") {
        return NextResponse.json(
          {
            reasonCode: "PERIOD_CLOSED",
            message: "Cannot change draft to a locked period",
          },
          { status: 400 }
        )
      }

      // If entry_date is also being updated, validate it's within new period
      // Otherwise, validate current entry_date is within new period
      const dateToCheck = entry_date !== undefined ? entry_date : draft.entry_date
      const newPeriodStart = new Date(newPeriod.period_start)
      const newPeriodEnd = new Date(newPeriod.period_end)
      const checkDate = new Date(dateToCheck)

      if (checkDate < newPeriodStart || checkDate > newPeriodEnd) {
        return NextResponse.json(
          {
            reasonCode: "VALIDATION_ERROR",
            message: `Entry date must fall within the new period date range (${newPeriod.period_start} to ${newPeriod.period_end})`,
          },
          { status: 400 }
        )
      }

      updateData.period_id = period_id
    }
    if (entry_date !== undefined) {
      // Validate entry_date is within period (current or new if being changed)
      const effectivePeriodId = period_id !== undefined ? period_id : draft.period_id
      const { data: effectivePeriod } = await supabase
        .from("accounting_periods")
        .select("period_start, period_end")
        .eq("id", effectivePeriodId)
        .single()

      if (effectivePeriod) {
        const entryDateObj = new Date(entry_date)
        const periodStart = new Date(effectivePeriod.period_start)
        const periodEnd = new Date(effectivePeriod.period_end)

        if (entryDateObj < periodStart || entryDateObj > periodEnd) {
          return NextResponse.json(
            {
              reasonCode: "VALIDATION_ERROR",
              message: `Entry date must fall within the period date range (${effectivePeriod.period_start} to ${effectivePeriod.period_end})`,
            },
            { status: 400 }
          )
        }
      }

      updateData.entry_date = entry_date
    }
    if (description !== undefined) {
      updateData.description = description.trim()
    }
    if (lines !== undefined) {
      updateData.lines = lines.map((line: any) => ({
        account_id: line.account_id,
        debit: line.debit || 0,
        credit: line.credit || 0,
        memo: line.memo || null,
      }))
    }

    // Update draft (trigger will validate balance)
    const { data: updatedDraft, error: updateError } = await supabase
      .from("manual_journal_drafts")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      console.error("Error updating draft:", updateError)
      return NextResponse.json(
        {
          reasonCode: "DATABASE_ERROR",
          message: updateError.message || "Failed to update draft",
        },
        { status: 500 }
      )
    }

    if (!isOwnerMode && draft.accounting_firm_id) {
      await logFirmActivity({
        supabase,
        firmId: draft.accounting_firm_id,
        actorUserId: user.id,
        actionType: "draft_updated",
        entityType: "manual_journal_draft",
        entityId: draft.id,
        metadata: {
          updated_fields: Object.keys(updateData),
        },
      })
    }

    return NextResponse.json({
      success: true,
      draft: updatedDraft,
    })
  } catch (error: any) {
    console.error("Error in update draft:", error)
    return NextResponse.json(
      {
        reasonCode: "INTERNAL_ERROR",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/accounting/journals/drafts/{id}
 *
 * Deletes a manual journal draft.
 * Owner-mode: draft must have accounting_firm_id IS NULL, user must have write authority.
 * Firm-mode: draft must belong to user's firm and engagement checks apply.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        {
          reasonCode: "UNAUTHORIZED",
          message: "Unauthorized",
        },
        { status: 401 }
      )
    }

    const { id } = await params
    const businessId = getBusinessIdFromRequest(request)
    if (!businessId) {
      return missingBusinessIdResponse("DELETE", `/api/accounting/journals/drafts/${id}`, "journals/drafts/[id]")
    }

    const { data: draft, error: fetchError } = await supabase
      .from("manual_journal_drafts")
      .select("id, client_business_id, accounting_firm_id")
      .eq("id", id)
      .single()

    if (fetchError || !draft) {
      return NextResponse.json(
        {
          reasonCode: "NOT_FOUND",
          message: "Draft not found",
        },
        { status: 404 }
      )
    }

    if (draft.client_business_id !== businessId) {
      return NextResponse.json(
        { error: "Business mismatch", reasonCode: "BUSINESS_MISMATCH", message: "Draft does not belong to the specified client" },
        { status: 403 }
      )
    }

    const isOwnerMode = draft.accounting_firm_id === null

    if (isOwnerMode) {
      const auth = await checkAccountingAuthority(supabase, user.id, draft.client_business_id, "write")
      if (!auth.authorized) {
        return NextResponse.json(
          {
            reasonCode: "FORBIDDEN",
            message: "You do not have write access to this business",
          },
          { status: 403 }
        )
      }
    } else {
      const onboardingCheck = await checkFirmOnboardingForAction(
        supabase,
        user.id,
        draft.client_business_id
      )
      if (!onboardingCheck.isComplete || !onboardingCheck.firmId) {
        return NextResponse.json(
          {
            reasonCode: "NO_ENGAGEMENT",
            message: "No firm found for this user",
          },
          { status: 403 }
        )
      }
      if (draft.accounting_firm_id !== onboardingCheck.firmId) {
        return NextResponse.json(
          {
            reasonCode: "FORBIDDEN",
            message: "Draft does not belong to your firm",
          },
          { status: 403 }
        )
      }
    }

    const { error: deleteError } = await supabase
      .from("manual_journal_drafts")
      .delete()
      .eq("id", id)

    if (deleteError) {
      console.error("Error deleting draft:", deleteError)
      return NextResponse.json(
        {
          reasonCode: "DATABASE_ERROR",
          message: deleteError.message || "Failed to delete draft",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: "Draft deleted",
    })
  } catch (error: any) {
    console.error("Error in delete draft:", error)
    return NextResponse.json(
      {
        reasonCode: "INTERNAL_ERROR",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}
