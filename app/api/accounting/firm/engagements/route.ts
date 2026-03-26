import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { canUserCreateEngagements, getFirmEngagements } from "@/lib/accounting/firm/engagements"
import { isFirmOnboardingComplete } from "@/lib/accounting/firm/onboarding"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * POST /api/accounting/firm/engagements
 * 
 * Creates a new firm-client engagement
 * 
 * Request body:
 * {
 *   firm_id: string
 *   business_id: string
 *   access_level: 'read' | 'write' | 'approve'
 *   effective_from: string (YYYY-MM-DD)
 *   effective_to?: string | null (YYYY-MM-DD)
 * }
 * 
 * Access: Partner or Senior role only
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

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const body = await request.json()
    const { firm_id, business_id, access_level, effective_from, effective_to } = body

    if (!firm_id || !business_id || !access_level || !effective_from) {
      return NextResponse.json(
        { error: "firm_id, business_id, access_level, and effective_from are required" },
        { status: 400 }
      )
    }

    // Prevent firm_id vs business_id mix-up: client_business_id must be a business, not the firm
    if (business_id === firm_id) {
      return NextResponse.json(
        { error: "client_business_id cannot equal accounting_firm_id (a firm cannot be its own client)" },
        { status: 400 }
      )
    }
    const { data: firmRow } = await supabase
      .from("accounting_firms")
      .select("id")
      .eq("id", business_id)
      .maybeSingle()
    if (firmRow) {
      return NextResponse.json(
        { error: "client_business_id must be a business id, not an accounting firm id" },
        { status: 400 }
      )
    }

    // Validate access_level
    if (!["read", "write", "approve"].includes(access_level)) {
      return NextResponse.json(
        { error: "access_level must be 'read', 'write', or 'approve'", error_code: "INVALID_ACCESS_LEVEL" },
        { status: 400 }
      )
    }

    // Check firm onboarding is complete
    const onboardingComplete = await isFirmOnboardingComplete(supabase, firm_id)
    if (!onboardingComplete) {
      return NextResponse.json(
        { error: "Firm onboarding must be completed before creating engagements" },
        { status: 403 }
      )
    }

    // Check user can create engagements (Partner or Senior)
    const canCreate = await canUserCreateEngagements(supabase, user.id, firm_id)
    if (!canCreate) {
      return NextResponse.json(
        { error: "Only Partners and Seniors can create engagements" },
        { status: 403 }
      )
    }

    // Validate effective_from is not in the past
    const effectiveFromDate = new Date(effective_from)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (effectiveFromDate < today) {
      return NextResponse.json(
        { error: "effective_from cannot be in the past", error_code: "INVALID_EFFECTIVE_WINDOW" },
        { status: 400 }
      )
    }

    // Validate effective_to if provided
    if (effective_to) {
      const effectiveToDate = new Date(effective_to)
      if (effectiveToDate < effectiveFromDate) {
        return NextResponse.json(
          { error: "effective_to must be >= effective_from", error_code: "INVALID_EFFECTIVE_WINDOW" },
          { status: 400 }
        )
      }
    }

    // Check if business exists
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, name")
      .eq("id", business_id)
      .maybeSingle()

    if (businessError || !business) {
      return NextResponse.json(
        { error: "Business not found", error_code: "INVALID_BUSINESS_ID" },
        { status: 400 }
      )
    }

    // Check for any non-terminated engagement (duplicate)
    const { data: existingNonTerminated } = await supabase
      .from("firm_client_engagements")
      .select("id, status")
      .eq("accounting_firm_id", firm_id)
      .eq("client_business_id", business_id)
      .neq("status", "terminated")
      .maybeSingle()

    if (existingNonTerminated) {
      return NextResponse.json(
        { error: "An engagement already exists for this firm-client pair (non-terminated)", error_code: "DUPLICATE_ENGAGEMENT" },
        { status: 409 }
      )
    }

    // TRACK B2: EXCEPTION - Writing to operational table 'firm_client_engagements'
    // This is an intentional boundary crossing: Accounting workspace requires the ability
    // to create and manage firm-client engagements as part of its core functionality.
    // This exception enables the Accountant-First model where accounting firms manage
    // their client relationships. This write is explicitly allowed and guarded.
    // See ACCOUNTING_WRITE_TARGETS_CLASSIFICATION.md for exception documentation.
    const { data: engagement, error: createError } = await supabase
      .from("firm_client_engagements")
      .insert({
        accounting_firm_id: firm_id,
        client_business_id: business_id,
        status: "pending",
        access_level,
        effective_from: effective_from,
        effective_to: effective_to || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (createError) {
      console.error("Error creating engagement:", {
        error: createError,
        message: createError.message,
        code: createError.code,
        details: createError.details,
        hint: createError.hint,
        firm_id,
        business_id,
        user_id: user.id,
      })
      
      const errorMessage = createError.message || "Failed to create engagement"
      return NextResponse.json(
        { 
          error: errorMessage,
          code: createError.code,
          details: createError.details,
        },
        { status: 500 }
      )
    }

    // Log activity
    await logFirmActivity({
      supabase,
      firmId: firm_id,
      actorUserId: user.id,
      actionType: "engagement_created",
      entityType: "engagement",
      entityId: engagement.id,
      metadata: {
        business_id,
        business_name: business.name,
        access_level,
        effective_from,
        effective_to,
      },
    })

    return NextResponse.json({
      success: true,
      engagement,
    })
  } catch (error: any) {
    console.error("Error in create engagement API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/accounting/firm/engagements
 * 
 * Gets all engagements for a firm
 * 
 * Query params:
 *   firm_id: string (required)
 *   status?: 'pending' | 'active' | 'suspended' | 'terminated'
 * 
 * Access: Users who belong to the firm
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const { searchParams } = new URL(request.url)
    const firmId = searchParams.get("firm_id")
    const status = searchParams.get("status")

    if (!firmId) {
      return NextResponse.json(
        { error: "firm_id is required" },
        { status: 400 }
      )
    }

    // Verify user belongs to the firm
    const { data: firmUser, error: firmUserError } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("firm_id", firmId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (firmUserError || !firmUser) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      )
    }

    // Get engagements
    const engagements = await getFirmEngagements(
      supabase,
      firmId,
      status as any
    )

    // Enrich with business names
    const businessIds = [...new Set(engagements.map((e) => e.client_business_id))]
    const { data: businesses } = await supabase
      .from("businesses")
      .select("id, name")
      .in("id", businessIds)

    const businessMap = new Map((businesses || []).map((b) => [b.id, b.name]))

    const enrichedEngagements = engagements.map((e) => ({
      ...e,
      business_name: businessMap.get(e.client_business_id) || "Unknown",
    }))

    return NextResponse.json({
      engagements: enrichedEngagements,
    })
  } catch (error: any) {
    console.error("Error in get engagements API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
