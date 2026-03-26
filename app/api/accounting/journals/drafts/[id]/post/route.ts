import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkFirmOnboardingForAction } from "@/lib/accounting/firm/onboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/accounting/firm/engagements"
import { buildCanonicalPostingPayload, validateCanonicalPayload } from "@/lib/accounting/manualJournalDraftPosting"
import { assertBusinessNotArchived } from "@/lib/accounting/archivedBusiness"
import { checkAccountingAuthority } from "@/lib/accounting/auth"

/**
 * POST /api/accounting/journals/drafts/{id}/post
 * 
 * Posts an approved manual journal draft to the ledger.
 * 
 * This endpoint is IDEMPOTENT:
 * - If draft already has journal_entry_id → returns existing entry
 * - If ledger entry exists with same input_hash → links draft and returns existing
 * - Otherwise → creates new ledger entry
 * 
 * Rules:
 * - Status must be 'approved'
 * - Engagement access must be 'approve'
 * - Firm role must be 'partner'
 * - Period must be open or soft_closed
 * 
 * Returns:
 * - journal_entry_id: UUID of the created/linked ledger entry
 * - draft: Updated draft object
 */
export async function POST(
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

    const { id: draftId } = await params

    // ========================================================================
    // STEP 1: FETCH DRAFT WITH RELATED DATA
    // ========================================================================
    const { data: draft, error: fetchError } = await supabase
      .from("manual_journal_drafts")
      .select(
        `
        *,
        period:period_id(id, status, period_start, period_end)
        `
      )
      .eq("id", draftId)
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

    // ========================================================================
    // STEP 2: AUTHORIZATION — Owner-mode vs Firm-mode
    // ========================================================================
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

    try {
      await assertBusinessNotArchived(supabase, draft.client_business_id)
    } catch (e: any) {
      return NextResponse.json(
        {
          reasonCode: "BUSINESS_ARCHIVED",
          message: e?.message || "Business is archived",
        },
        { status: 403 }
      )
    }

    // ========================================================================
    // STEP 3: CHECK DRAFT STATUS
    // ========================================================================
    if (draft.status !== "approved") {
      return NextResponse.json(
        {
          reasonCode: "INVALID_STATUS_TRANSITION",
          message: `Draft must be approved before posting. Current status: ${draft.status}`,
        },
        { status: 400 }
      )
    }

    // ========================================================================
    // STEP 4: CHECK IDEMPOTENCY (if already posted)
    // ========================================================================
    if (draft.journal_entry_id) {
      const { data: existingEntry } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("id", draft.journal_entry_id)
        .single()

      if (existingEntry) {
        return NextResponse.json({
          success: true,
          journal_entry_id: existingEntry.id,
          draft: draft,
          message: "Draft already posted to ledger",
        })
      }
    }

    // ========================================================================
    // STEP 5: VALIDATE PERIOD STATE
    // ========================================================================
    const period = draft.period as { id: string; status: string } | null
    if (!period) {
      return NextResponse.json(
        {
          reasonCode: "NOT_FOUND",
          message: "Period not found",
        },
        { status: 404 }
      )
    }

    if (period.status === "locked") {
      return NextResponse.json(
        {
          reasonCode: "PERIOD_CLOSED",
          message: "Cannot post to locked period",
        },
        { status: 400 }
      )
    }

    if (!isOwnerMode) {
      // ---------- Firm-mode only: engagement + partner role ----------
      const onboardingCheck = await checkFirmOnboardingForAction(
        supabase,
        user.id,
        draft.client_business_id
      )

      const engagement = await getActiveEngagement(
        supabase,
        onboardingCheck.firmId!,
        draft.client_business_id
      )

      if (!engagement) {
        return NextResponse.json(
          {
            reasonCode: "NO_ENGAGEMENT",
            message: "No active engagement found",
          },
          { status: 403 }
        )
      }

      if (!isEngagementEffective(engagement)) {
        const today = new Date().toISOString().split("T")[0]
        let message = "Engagement is not effective"
        if (engagement.effective_from > today) {
          message = `Engagement is not yet effective. Effective date: ${engagement.effective_from}`
        } else if (engagement.effective_to && engagement.effective_to < today) {
          message = `Engagement has expired. Expired on: ${engagement.effective_to}`
        }

        return NextResponse.json(
          {
            reasonCode: "ENGAGEMENT_NOT_EFFECTIVE",
            message,
          },
          { status: 403 }
        )
      }

      if (engagement.access_level !== "approve") {
        return NextResponse.json(
          {
            reasonCode: "INSUFFICIENT_ENGAGEMENT_ACCESS",
            message: "Approve access level required to post to ledger",
          },
          { status: 403 }
        )
      }

      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("role")
        .eq("firm_id", onboardingCheck.firmId)
        .eq("user_id", user.id)
        .maybeSingle()

      if (!firmUser || firmUser.role !== "partner") {
        return NextResponse.json(
          {
            reasonCode: "INSUFFICIENT_FIRM_ROLE",
            message: "Partner role required to post to ledger",
          },
          { status: 403 }
        )
      }
    }

    // ========================================================================
    // STEP 8: BUILD CANONICAL PAYLOAD & VALIDATE (firm-mode only; owner-mode uses RPC hash)
    // ========================================================================
    if (!isOwnerMode) {
      const canonicalPayload = buildCanonicalPostingPayload({
        id: draft.id,
        accounting_firm_id: draft.accounting_firm_id!,
        client_business_id: draft.client_business_id,
        period_id: draft.period_id,
        entry_date: draft.entry_date,
        description: draft.description,
        lines: draft.lines as any[],
        total_debit: parseFloat(draft.total_debit.toString()),
        total_credit: parseFloat(draft.total_credit.toString()),
        approved_by: draft.approved_by,
      })

      const validation = validateCanonicalPayload(canonicalPayload)
      if (!validation.valid) {
        return NextResponse.json(
          {
            reasonCode: "VALIDATION_ERROR",
            message: validation.error || "Invalid draft payload",
          },
          { status: 400 }
        )
      }
    }

    // ========================================================================
    // STEP 9: POST TO LEDGER (IDEMPOTENT FUNCTION)
    // ========================================================================
    const { data: journalEntryId, error: postError } = await supabase.rpc(
      "post_manual_journal_draft_to_ledger",
      {
        p_draft_id: draftId,
        p_posted_by: user.id,
      }
    )

    if (postError) {
      console.error("Error posting draft to ledger:", postError)

      // Map database errors to user-friendly messages
      const errorMessage = postError.message || "Failed to post draft to ledger"

      // Check for specific error conditions
      if (errorMessage.includes("must be approved")) {
        return NextResponse.json(
          {
            reasonCode: "INVALID_STATUS_TRANSITION",
            message: "Draft must be approved before posting",
          },
          { status: 400 }
        )
      }

      if (errorMessage.includes("locked period")) {
        return NextResponse.json(
          {
            reasonCode: "PERIOD_CLOSED",
            message: "Cannot post to locked period",
          },
          { status: 400 }
        )
      }

      if (errorMessage.includes("No active engagement")) {
        return NextResponse.json(
          {
            reasonCode: "NO_ENGAGEMENT",
            message: "No active engagement found",
          },
          { status: 403 }
        )
      }

      return NextResponse.json(
        {
          reasonCode: "INTERNAL_ERROR",
          message: errorMessage,
        },
        { status: 500 }
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        {
          reasonCode: "INTERNAL_ERROR",
          message: "Failed to post draft to ledger",
        },
        { status: 500 }
      )
    }

    // ========================================================================
    // STEP 10: FETCH UPDATED DRAFT
    // ========================================================================
    const { data: updatedDraft } = await supabase
      .from("manual_journal_drafts")
      .select("*")
      .eq("id", draftId)
      .single()

    return NextResponse.json({
      success: true,
      journal_entry_id: journalEntryId,
      draft: updatedDraft,
      message: "Draft posted to ledger successfully",
    })
  } catch (error: any) {
    console.error("Error in post draft:", error)
    return NextResponse.json(
      {
        reasonCode: "INTERNAL_ERROR",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}
