import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkFirmOnboardingForAction } from "@/lib/firmOnboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/firmEngagements"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"

/**
 * POST /api/accounting/opening-balances/{id}/post
 * 
 * Posts an approved opening balance import to the ledger (Partner-only, idempotent)
 * 
 * Access: Partner-only with approve engagement access
 * 
 * Behavior:
 * - Calls DB function: post_opening_balance_import_to_ledger(import_id, posted_by)
 * - Returns journal_entry_id
 * - Idempotent: safe to retry, returns existing entry if already posted
 * 
 * Rejects if:
 * - Not approved
 * - Period locked
 * - Duplicate exists
 * - Any DB validation fails
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

    try {
      await assertBusinessNotArchived(supabase, existingImport.client_business_id)
    } catch (e: any) {
      return NextResponse.json(
        {
          error: e?.message || "Business is archived",
          reasonCode: "BUSINESS_ARCHIVED",
          message: e?.message || "Business is archived",
        },
        { status: 403 }
      )
    }

    // Reject if not approved
    if (existingImport.status !== "approved") {
      return NextResponse.json(
        {
          error: "Import is not approved",
          reasonCode: "NOT_APPROVED",
          message: `Cannot post import with status '${existingImport.status}'. Only approved imports can be posted.`
        },
        { status: 400 }
      )
    }

    // Check if already posted (idempotency check)
    if (existingImport.journal_entry_id) {
      // Verify ledger entry exists
      const { data: journalEntry } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("id", existingImport.journal_entry_id)
        .single()

      if (journalEntry) {
        return NextResponse.json({
          success: true,
          journal_entry_id: existingImport.journal_entry_id,
          message: "Opening balance import already posted",
          already_posted: true,
        })
      }
      // If ledger entry was deleted (shouldn't happen), continue to repost
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
          message: "Posting opening balance imports requires firm context"
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
          message: "Only Partners can post opening balance imports to the ledger"
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
          message: "Posting opening balance imports requires 'approve' engagement access"
        },
        { status: 403 }
      )
    }

    // Call DB posting function (idempotent)
    const { data: journalEntryId, error: postError } = await supabase.rpc(
      "post_opening_balance_import_to_ledger",
      {
        p_import_id: importId,
        p_posted_by: user.id,
      }
    )

    if (postError) {
      console.error("Error posting opening balance import:", postError)

      // Map common DB errors to reason codes
      const errorMessage = postError.message || "Failed to post opening balance import"
      let reasonCode = "POST_FAILED"
      let statusCode = 500

      if (errorMessage.includes("must be approved")) {
        reasonCode = "NOT_APPROVED"
        statusCode = 400
      } else if (errorMessage.includes("locked")) {
        reasonCode = "PERIOD_LOCKED"
        statusCode = 400
      } else if (errorMessage.includes("first open period")) {
        reasonCode = "PERIOD_NOT_FIRST_OPEN"
        statusCode = 400
      } else if (errorMessage.includes("already has") || errorMessage.includes("other journal entry")) {
        reasonCode = "PERIOD_HAS_OTHER_ENTRIES"
        statusCode = 400
      } else if (errorMessage.includes("No active engagement")) {
        reasonCode = "NO_ACTIVE_ENGAGEMENT"
        statusCode = 403
      } else if (errorMessage.includes("access level")) {
        reasonCode = "INSUFFICIENT_ENGAGEMENT_ACCESS"
        statusCode = 403
      }

      return NextResponse.json(
        {
          error: errorMessage,
          reasonCode,
          message: errorMessage
        },
        { status: statusCode }
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        {
          error: "Failed to post opening balance import",
          reasonCode: "POST_FAILED",
          message: "Posting function did not return a journal entry ID"
        },
        { status: 500 }
      )
    }

    // Fetch updated import to return
    const { data: updatedImport } = await supabase
      .from("opening_balance_imports")
      .select("*")
      .eq("id", importId)
      .single()

    return NextResponse.json({
      success: true,
      journal_entry_id: journalEntryId,
      import: updatedImport,
      message: "Opening balance import posted to ledger successfully",
    })
  } catch (error: any) {
    console.error("Error in opening balance import post:", error)
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
