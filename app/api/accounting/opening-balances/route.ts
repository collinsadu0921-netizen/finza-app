import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { checkFirmOnboardingForAction } from "@/lib/accounting/firm/onboarding"
import { getActiveEngagement, isEngagementEffective } from "@/lib/accounting/firm/engagements"

/**
 * GET /api/accounting/opening-balances?business_id=...
 * 
 * Gets the opening balance import for a business (0 or 1)
 * 
 * Access: Firm user with read/write/approve engagement access
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
          error: "Unauthorized",
          reasonCode: "UNAUTHORIZED",
          message: "Authentication required"
        },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const business_id = searchParams.get("business_id")

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    if (!business_id) {
      return NextResponse.json(
        {
          error: "Missing required parameter: business_id",
          reasonCode: "MISSING_PARAMETER",
          message: "business_id is required"
        },
        { status: 400 }
      )
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        {
          error: "Missing required parameter: business_id",
          reasonCode: "MISSING_PARAMETER",
          message: "business_id is required",
        },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, business_id, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        {
          error: "Unauthorized",
          reasonCode: "FORBIDDEN",
          message: "You do not have access to this business's opening balances."
        },
        { status: 403 }
      )
    }

    // Get import for business
    const { data: importData, error: fetchError } = await supabase
      .from("opening_balance_imports")
      .select(
        `
        *,
        accounting_periods (
          period_start,
          period_end,
          status
        )
      `
      )
      .eq("client_business_id", business_id)
      .maybeSingle()

    if (fetchError) {
      console.error("Error fetching opening balance import:", fetchError)
      return NextResponse.json(
        {
          error: fetchError.message || "Failed to fetch opening balance import",
          reasonCode: "FETCH_FAILED",
          message: fetchError.message || "Failed to fetch opening balance import"
        },
        { status: 500 }
      )
    }

    if (!importData) {
      return NextResponse.json({
        success: true,
        import: null,
      })
    }

    // Fetch user names separately
    const userIds = [
      importData.created_by,
      importData.approved_by,
      importData.posted_by,
    ].filter(Boolean) as string[]

    let userNames: Record<string, string> = {}
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name")
        .in("id", userIds)

      if (users) {
        userNames = users.reduce((acc, user) => {
          acc[user.id] = user.full_name || "Unknown"
          return acc
        }, {} as Record<string, string>)
      }
    }

    // Format response with user names
    const formatted = {
      ...importData,
      created_by_name: importData.created_by ? userNames[importData.created_by] || null : null,
      approved_by_name: importData.approved_by ? userNames[importData.approved_by] || null : null,
      posted_by_name: importData.posted_by ? userNames[importData.posted_by] || null : null,
    }

    return NextResponse.json({
      success: true,
      import: formatted,
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
 * POST /api/accounting/opening-balances
 * 
 * Creates a new opening balance import (draft)
 * 
 * Body:
 * - business_id: UUID
 * - period_id: UUID (first open period)
 * - source_type: 'manual' | 'csv' | 'excel'
 * - lines: [{ account_id, debit, credit, memo }] (optional at create)
 * 
 * Access: Firm user with write/approve engagement access
 * 
 * Rejects if:
 * - Business already has an opening balance import (any state) OR already posted
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
          error: "Unauthorized",
          reasonCode: "UNAUTHORIZED",
          message: "Authentication required"
        },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      business_id,
      period_id,
      source_type = "manual",
      lines = [],
    } = body

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    // Validate required fields
    if (!business_id || !period_id) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          reasonCode: "MISSING_FIELDS",
          message: "business_id and period_id are required"
        },
        { status: 400 }
      )
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: String(business_id) }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          reasonCode: "MISSING_FIELDS",
          message: "business_id and period_id are required",
        },
        { status: 400 }
      )
    }

    // Validate source_type
    if (!["manual", "csv", "excel"].includes(source_type)) {
      return NextResponse.json(
        {
          error: "Invalid source_type",
          reasonCode: "INVALID_SOURCE_TYPE",
          message: "source_type must be 'manual', 'csv', or 'excel'"
        },
        { status: 400 }
      )
    }

    // Validate lines if provided
    if (lines && Array.isArray(lines) && lines.length > 0) {
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
        if (line.debit !== undefined && typeof line.debit !== "number") {
          return NextResponse.json(
            {
              error: `Line ${i + 1}: debit must be a number`,
              reasonCode: "INVALID_LINE",
              message: `Line ${i + 1} has invalid debit value`
            },
            { status: 400 }
          )
        }
        if (line.credit !== undefined && typeof line.credit !== "number") {
          return NextResponse.json(
            {
              error: `Line ${i + 1}: credit must be a number`,
              reasonCode: "INVALID_LINE",
              message: `Line ${i + 1} has invalid credit value`
            },
            { status: 400 }
          )
        }
      }
    }

    // Verify business exists
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", business_id)
      .single()

    if (!business) {
      return NextResponse.json(
        {
          error: "Business not found",
          reasonCode: "BUSINESS_NOT_FOUND",
          message: `Business ${business_id} does not exist`
        },
        { status: 404 }
      )
    }

    // Check firm onboarding status
    const onboardingCheck = await checkFirmOnboardingForAction(
      supabase,
      user.id,
      business_id
    )
    if (!onboardingCheck.isComplete) {
      return NextResponse.json(
        {
          error: onboardingCheck.error || "Firm onboarding required",
          reasonCode: "FIRM_ONBOARDING_INCOMPLETE",
          message: onboardingCheck.error || "Firm onboarding must be completed before creating opening balance imports"
        },
        { status: 403 }
      )
    }

    // Resolve firm context
    let firmId: string | null = null
    let firmRole: string | null = null
    let engagementAccess: string | null = null

    if (onboardingCheck.firmId) {
      firmId = onboardingCheck.firmId

      // Get user's firm role
      const { data: firmUser } = await supabase
        .from("accounting_firm_users")
        .select("role")
        .eq("firm_id", firmId)
        .eq("user_id", user.id)
        .maybeSingle()

      firmRole = firmUser?.role || null

      // Get active engagement
      const engagement = await getActiveEngagement(
        supabase,
        firmId,
        business_id
      )

      if (!engagement) {
        return NextResponse.json(
          {
            error: "No active engagement found",
            reasonCode: "NO_ACTIVE_ENGAGEMENT",
            message: "No active engagement found for this firm and client"
          },
          { status: 403 }
        )
      }

      // Check if engagement is effective
      if (!isEngagementEffective(engagement)) {
        const today = new Date().toISOString().split("T")[0]
        if (engagement.effective_from > today) {
          return NextResponse.json(
            {
              error: `Engagement is not yet effective. Effective date: ${engagement.effective_from}`,
              reasonCode: "ENGAGEMENT_NOT_EFFECTIVE",
              message: `Engagement is not yet effective. Effective date: ${engagement.effective_from}`
            },
            { status: 403 }
          )
        }
        if (engagement.effective_to && engagement.effective_to < today) {
          return NextResponse.json(
            {
              error: `Engagement has expired. Expired on: ${engagement.effective_to}`,
              reasonCode: "ENGAGEMENT_EXPIRED",
              message: `Engagement has expired. Expired on: ${engagement.effective_to}`
            },
            { status: 403 }
          )
        }
      }

      engagementAccess = engagement.access_level

      // Check authority: Create requires write or approve access
      if (engagementAccess !== "write" && engagementAccess !== "approve") {
        return NextResponse.json(
          {
            error: "Insufficient engagement access",
            reasonCode: "INSUFFICIENT_ENGAGEMENT_ACCESS",
            message: "Creating opening balance imports requires 'write' or 'approve' engagement access"
          },
          { status: 403 }
        )
      }
    } else {
      // Not accessing via firm - check if business owner
      const { data: businessOwner } = await supabase
        .from("businesses")
        .select("owner_id")
        .eq("id", business_id)
        .single()

      if (businessOwner?.owner_id !== user.id) {
        return NextResponse.json(
          {
            error: "Unauthorized",
            reasonCode: "NOT_BUSINESS_OWNER",
            message: "Only business owners or firm users can create opening balance imports"
          },
          { status: 403 }
        )
      }
    }

    // Check if business already has an opening balance import
    const { data: existingImport } = await supabase
      .from("opening_balance_imports")
      .select("id, status, journal_entry_id")
      .eq("client_business_id", business_id)
      .maybeSingle()

    if (existingImport) {
      // Check if already posted
      if (existingImport.journal_entry_id) {
        return NextResponse.json(
          {
            error: "Opening balance already posted",
            reasonCode: "OPENING_BALANCE_ALREADY_POSTED",
            message: "This business already has a posted opening balance. Only one opening balance per business is allowed."
          },
          { status: 409 }
        )
      }

      // Check if exists in any state
      return NextResponse.json(
        {
          error: "Opening balance import already exists",
          reasonCode: "OPENING_BALANCE_IMPORT_EXISTS",
          message: `Opening balance import already exists for this business (status: ${existingImport.status}). Only one opening balance import per business is allowed.`
        },
        { status: 409 }
      )
    }

    // Verify period exists and is open
    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, status, period_start")
      .eq("id", period_id)
      .eq("business_id", business_id)
      .single()

    if (!period) {
      return NextResponse.json(
        {
          error: "Period not found",
          reasonCode: "PERIOD_NOT_FOUND",
          message: `Period ${period_id} not found for business ${business_id}`
        },
        { status: 404 }
      )
    }

    if (period.status !== "open") {
      return NextResponse.json(
        {
          error: "Period is not open",
          reasonCode: "PERIOD_NOT_OPEN",
          message: `Period status is '${period.status}'. Opening balances can only be created for open periods.`
        },
        { status: 400 }
      )
    }

    // Verify period is first open period
    const { data: firstPeriod } = await supabase
      .from("accounting_periods")
      .select("id")
      .eq("business_id", business_id)
      .eq("status", "open")
      .order("period_start", { ascending: true })
      .limit(1)
      .single()

    if (!firstPeriod || firstPeriod.id !== period_id) {
      return NextResponse.json(
        {
          error: "Period must be first open period",
          reasonCode: "PERIOD_NOT_FIRST_OPEN",
          message: "Opening balances must be created for the first open period"
        },
        { status: 400 }
      )
    }

    // Get firm_id (required for opening_balance_imports)
    if (!firmId) {
      return NextResponse.json(
        {
          error: "Firm context required",
          reasonCode: "FIRM_CONTEXT_REQUIRED",
          message: "Opening balance imports require firm context. Please access via accounting firm."
        },
        { status: 403 }
      )
    }

    // TRACK B2: EXCEPTION - Writing to operational table 'opening_balance_imports'
    // This is an intentional boundary crossing: Accounting workspace requires a draft/import
    // workflow for opening balances before they are posted to the ledger. This table serves
    // as a staging area for opening balance data before canonical ledger posting via RPC functions.
    // This exception enables the draft → approve → post workflow. This write is explicitly allowed and guarded.
    // See ACCOUNTING_WRITE_TARGETS_CLASSIFICATION.md for exception documentation.
    const { data: importData, error: createError } = await supabase
      .from("opening_balance_imports")
      .insert({
        accounting_firm_id: firmId,
        client_business_id: business_id,
        period_id: period_id,
        source_type: source_type,
        lines: lines || [],
        status: "draft",
        created_by: user.id,
      })
      .select()
      .single()

    if (createError) {
      // Check for unique constraint violation
      if (createError.code === "23505") {
        return NextResponse.json(
          {
            error: "Opening balance import already exists",
            reasonCode: "OPENING_BALANCE_IMPORT_EXISTS",
            message: "An opening balance import already exists for this business"
          },
          { status: 409 }
        )
      }

      console.error("Error creating opening balance import:", createError)
      return NextResponse.json(
        {
          error: createError.message || "Failed to create opening balance import",
          reasonCode: "CREATE_FAILED",
          message: createError.message || "Failed to create opening balance import"
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      import: importData,
      message: "Opening balance import created successfully",
    })
  } catch (error: any) {
    console.error("Error in opening balance import create:", error)
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
