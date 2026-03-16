import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkFirmOnboardingForAction } from "@/lib/firmOnboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/firmEngagements"
import { resolveAuthority } from "@/lib/firmAuthority"
import { logBlockedActionAttempt, logFirmActivity } from "@/lib/firmActivityLog"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/journals/drafts
 * 
 * Lists manual journal drafts for a client business
 * 
 * Query params:
 * - client_business_id: UUID (required)
 * - status?: 'draft' | 'submitted' | 'approved' | 'rejected'
 * - period_id?: UUID
 * 
 * Returns drafts with full details including lines
 */
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)
    const clientBusinessId = searchParams.get("client_business_id")
    const periodId = searchParams.get("period_id")
    const status = searchParams.get("status")
    const createdBy = searchParams.get("created_by")
    const entryDateFrom = searchParams.get("entry_date_from") || searchParams.get("date_from")
    const entryDateTo = searchParams.get("entry_date_to") || searchParams.get("date_to")
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)

    if (!clientBusinessId) {
      return NextResponse.json(
        {
          reasonCode: "VALIDATION_ERROR",
          message: "Missing required parameter: client_business_id",
        },
        { status: 400 }
      )
    }

    // Verify business exists
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", clientBusinessId)
      .single()

    if (!business) {
      return NextResponse.json(
        {
          reasonCode: "NOT_FOUND",
          message: "Business not found",
        },
        { status: 404 }
      )
    }

    // Check firm onboarding (firm path); owner-mode when firmId missing
    const onboardingCheck = await checkFirmOnboardingForAction(
      supabase,
      user.id,
      clientBusinessId
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

    const isOwnerMode = !onboardingCheck.firmId

    if (isOwnerMode) {
      // ---------- Owner-mode: no firm, require accounting authority ----------
      const auth = await checkAccountingAuthority(supabase, user.id, clientBusinessId, "write")
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
      // ---------- Firm-mode: require period_id, engagement ----------
      if (!periodId) {
        return NextResponse.json(
          {
            reasonCode: "VALIDATION_ERROR",
            message: "Missing required parameter: period_id",
          },
          { status: 400 }
        )
      }

      const engagement = await getActiveEngagement(
        supabase,
        onboardingCheck.firmId!,
        clientBusinessId
      )

      if (!engagement) {
        return NextResponse.json(
          {
            reasonCode: "NO_ENGAGEMENT",
            message: "No active engagement found for this client",
          },
          { status: 403 }
        )
      }
    }

    // Build query
    let query = supabase
      .from("manual_journal_drafts")
      .select(
        `
        *,
        created_by_user:created_by(id, email, raw_user_meta_data),
        submitted_by_user:submitted_by(id, email, raw_user_meta_data),
        approved_by_user:approved_by(id, email, raw_user_meta_data),
        rejected_by_user:rejected_by(id, email, raw_user_meta_data),
        period:period_id(id, period_start, period_end, status)
        `,
        { count: "exact" }
      )
      .eq("client_business_id", clientBusinessId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })

    if (isOwnerMode) {
      query = query.is("accounting_firm_id", null)
    } else {
      query = query.eq("accounting_firm_id", onboardingCheck.firmId!)
    }

    if (status) {
      query = query.eq("status", status)
    }

    if (periodId) {
      query = query.eq("period_id", periodId)
    }

    if (createdBy) {
      query = query.eq("created_by", createdBy)
    }

    if (entryDateFrom) {
      query = query.gte("entry_date", entryDateFrom)
    }

    if (entryDateTo) {
      query = query.lte("entry_date", entryDateTo)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: drafts, error, count } = await query

    if (error) {
      console.error("Error fetching drafts:", error)
      return NextResponse.json(
        {
          reasonCode: "DATABASE_ERROR",
          message: error.message || "Failed to fetch drafts",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      drafts: drafts || [],
      count: count || 0,
    })
  } catch (error: any) {
    console.error("Error in list drafts:", error)
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
 * POST /api/accounting/journals/drafts
 * 
 * Creates a new manual journal draft
 * 
 * Body:
 * - client_business_id: UUID
 * - period_id: UUID
 * - entry_date: DATE (YYYY-MM-DD)
 * - description: TEXT
 * - lines: [{ account_id: UUID, debit: NUMERIC, credit: NUMERIC, memo?: TEXT }]
 * 
 * Rules:
 * - Engagement must be active + effective
 * - Min access: Write
 * - Min role: Junior
 * - Period must be open
 * - Draft starts in 'draft' status
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { 
          reasonCode: "UNAUTHORIZED",
          message: "Unauthorized" 
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      client_business_id,
      period_id,
      entry_date,
      description,
      lines,
    } = body

    // Validate required fields
    if (!client_business_id || !period_id || !entry_date || !description || !lines) {
      return NextResponse.json(
        {
          reasonCode: "VALIDATION_ERROR",
          message: "Missing required fields: client_business_id, period_id, entry_date, description, lines",
        },
        { status: 400 }
      )
    }

    // Validate description is not empty
    if (typeof description !== "string" || description.trim().length === 0) {
      return NextResponse.json(
        {
          reasonCode: "VALIDATION_ERROR",
          message: "Description is required and cannot be empty",
        },
        { status: 400 }
      )
    }

    // Validate lines is an array with at least 2 elements
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
      // Validate amounts are numbers and >= 0
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

    // Verify business exists
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", client_business_id)
      .single()

    if (!business) {
      return NextResponse.json(
        {
          reasonCode: "NOT_FOUND",
          message: "Business not found",
        },
        { status: 404 }
      )
    }

    // Verify period exists
    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, status, period_start, period_end")
      .eq("id", period_id)
      .eq("business_id", client_business_id)
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

    // Check period is open (allows posting)
    if (period.status === "locked") {
      return NextResponse.json(
        {
          reasonCode: "PERIOD_CLOSED",
          message: "Period is locked. Cannot create drafts for locked periods.",
        },
        { status: 403 }
      )
    }

    // Check entry_date is within period
    const entryDate = new Date(entry_date)
    if (entryDate < new Date(period.period_start) || entryDate > new Date(period.period_end)) {
      return NextResponse.json(
        {
          reasonCode: "VALIDATION_ERROR",
          message: "Entry date must fall within the period date range",
        },
        { status: 400 }
      )
    }

    // Check firm onboarding (firm path); owner-mode when firmId missing
    const onboardingCheck = await checkFirmOnboardingForAction(
      supabase,
      user.id,
      client_business_id
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

    const isOwnerMode = !onboardingCheck.firmId

    if (isOwnerMode) {
      // ---------- Owner-mode: require accounting authority ----------
      const auth = await checkAccountingAuthority(supabase, user.id, client_business_id, "write")
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
      // ---------- Firm-mode: engagement + resolveAuthority ----------
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("role")
        .eq("firm_id", onboardingCheck.firmId)
        .eq("user_id", user.id)
        .maybeSingle()

      const engagement = await getActiveEngagement(
        supabase,
        onboardingCheck.firmId,
        client_business_id
      )

      if (!engagement) {
        return NextResponse.json(
          {
            reasonCode: "NO_ENGAGEMENT",
            message: "No active engagement found for this client",
          },
          { status: 403 }
        )
      }

      if (!isEngagementEffective(engagement)) {
        const today = new Date().toISOString().split("T")[0]
        if (engagement.effective_from > today) {
          return NextResponse.json(
            {
              reasonCode: "ENGAGEMENT_NOT_EFFECTIVE",
              message: `Engagement is not yet effective. Effective date: ${engagement.effective_from}`,
            },
            { status: 403 }
          )
        }
        if (engagement.effective_to && engagement.effective_to < today) {
          return NextResponse.json(
            {
              reasonCode: "ENGAGEMENT_NOT_EFFECTIVE",
              message: `Engagement has expired. Expired on: ${engagement.effective_to}`,
            },
            { status: 403 }
          )
        }
      }

      const authority = resolveAuthority({
        firmRole: firmUser?.role as any || null,
        engagementAccess: engagement.access_level as any || null,
        action: "create_manual_journal_draft",
        engagementStatus: engagement.status as any || null,
      })

      if (!authority.allowed) {
        await logBlockedActionAttempt(
          supabase,
          onboardingCheck.firmId,
          user.id,
          "create_manual_journal_draft",
          authority.reasonCode!,
          authority.requiredEngagementAccess,
          authority.requiredFirmRole,
          client_business_id
        )

        return NextResponse.json(
          {
            reasonCode: authority.reasonCode || "INSUFFICIENT_AUTHORITY",
            message: authority.reason || "Insufficient authority",
          },
          { status: 403 }
        )
      }
    }

    // Format lines for JSONB storage
    const formattedLines = lines.map((line: any) => ({
      account_id: line.account_id,
      debit: line.debit || 0,
      credit: line.credit || 0,
      memo: line.memo || null,
    }))

    const nowIso = new Date().toISOString()

    // Create draft (owner-mode: approved, no firm; firm-mode: draft, with firm)
    const insertPayload: Record<string, unknown> = isOwnerMode
      ? {
          accounting_firm_id: null,
          client_business_id,
          period_id,
          entry_date,
          description: description.trim(),
          lines: formattedLines,
          status: "approved",
          created_by: user.id,
          approved_by: user.id,
          approved_at: nowIso,
        }
      : {
          accounting_firm_id: onboardingCheck.firmId,
          client_business_id,
          period_id,
          entry_date,
          description: description.trim(),
          lines: formattedLines,
          status: "draft",
          created_by: user.id,
        }

    const { data: draft, error: createError } = await supabase
      .from("manual_journal_drafts")
      .insert(insertPayload)
      .select()
      .single()

    if (createError) {
      console.error("Error creating draft:", createError)
      return NextResponse.json(
        {
          reasonCode: "DATABASE_ERROR",
          message: createError.message || "Failed to create draft",
        },
        { status: 500 }
      )
    }

    if (isOwnerMode) {
      // Owner-mode: create draft and immediately post to ledger (atomic)
      const draftId = draft.id
      const { data: journalEntryId, error: postError } = await supabase.rpc(
        "post_manual_journal_draft_to_ledger",
        {
          p_draft_id: draftId,
          p_posted_by: user.id,
        }
      )

      if (postError) {
        console.error("Error posting owner-mode draft to ledger:", postError)
        const msg = postError.message || "Failed to post draft to ledger"
        if (msg.includes("must be approved")) {
          return NextResponse.json(
            { reasonCode: "INVALID_STATUS_TRANSITION", message: "Draft must be approved before posting" },
            { status: 400 }
          )
        }
        if (msg.includes("locked period")) {
          return NextResponse.json(
            { reasonCode: "PERIOD_CLOSED", message: "Cannot post to locked period" },
            { status: 400 }
          )
        }
        if (msg.includes("Unauthorized") || msg.includes("not authorized")) {
          return NextResponse.json(
            { reasonCode: "FORBIDDEN", message: msg },
            { status: 403 }
          )
        }
        return NextResponse.json(
          { reasonCode: "DATABASE_ERROR", message: msg },
          { status: 500 }
        )
      }

      if (!journalEntryId) {
        return NextResponse.json(
          { reasonCode: "INTERNAL_ERROR", message: "Failed to post draft to ledger" },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        journal_entry_id: journalEntryId,
      })
    }

    await logFirmActivity({
      supabase,
      firmId: onboardingCheck.firmId!,
      actorUserId: user.id,
      actionType: "draft_created",
      entityType: "manual_journal_draft",
      entityId: draft.id,
      metadata: {
        client_business_id,
        period_id,
        entry_date,
      },
    })

    return NextResponse.json({
      success: true,
      draft,
    })
  } catch (error: any) {
    console.error("Error in create draft:", error)
    return NextResponse.json(
      {
        reasonCode: "INTERNAL_ERROR",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}
