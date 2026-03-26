import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { isUserFirmPartner } from "@/lib/accounting/firm/onboarding"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * POST /api/accounting/firm/onboarding/complete
 * 
 * Completes firm onboarding (Partner-only)
 * 
 * Request body:
 * {
 *   firm_id: string
 *   legal_name: string
 *   jurisdiction: string
 *   reporting_standard: string
 *   default_accounting_standard: string
 * }
 * 
 * Access: Partner role only
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
    const {
      firm_id,
      legal_name,
      jurisdiction,
      reporting_standard,
      default_accounting_standard,
    } = body

    if (!firm_id) {
      return NextResponse.json({ error: "firm_id is required" }, { status: 400 })
    }

    // Verify user is a Partner in the firm
    const isPartner = await isUserFirmPartner(supabase, user.id, firm_id)
    if (!isPartner) {
      return NextResponse.json(
        { error: "Only Partners can complete firm onboarding" },
        { status: 403 }
      )
    }

    // Check current onboarding status
    const { data: currentFirm, error: fetchError } = await supabase
      .from("accounting_firms")
      .select("onboarding_status")
      .eq("id", firm_id)
      .maybeSingle()

    if (fetchError) {
      console.error("Error fetching firm:", fetchError)
      return NextResponse.json(
        { error: "Failed to fetch firm data" },
        { status: 500 }
      )
    }

    if (!currentFirm) {
      return NextResponse.json({ error: "Firm not found" }, { status: 404 })
    }

    if (currentFirm.onboarding_status === "completed") {
      return NextResponse.json(
        { error: "Firm onboarding is already completed" },
        { status: 400 }
      )
    }

    // Validate required fields
    if (!legal_name || !jurisdiction || !reporting_standard) {
      return NextResponse.json(
        {
          error:
            "legal_name, jurisdiction, and reporting_standard are required",
        },
        { status: 400 }
      )
    }

    // Update firm with onboarding data
    const { error: updateError } = await supabase
      .from("accounting_firms")
      .update({
        onboarding_status: "completed",
        onboarding_completed_at: new Date().toISOString(),
        onboarding_completed_by: user.id,
        legal_name,
        jurisdiction,
        reporting_standard,
        default_accounting_standard: default_accounting_standard || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", firm_id)

    if (updateError) {
      console.error("Error updating firm onboarding:", updateError)
      
      // Expose RLS errors for debugging (especially in development)
      const isRLSError = updateError.code === "42501" || updateError.message?.includes("row-level security")
      const errorMessage = isRLSError
        ? "Permission denied: You don't have permission to update firm onboarding. Please ensure you are a Partner."
        : "Failed to complete onboarding"
      
      return NextResponse.json(
        {
          error: errorMessage,
          ...(process.env.NODE_ENV !== "production" && {
            debug: {
              code: updateError.code,
              message: updateError.message,
              hint: updateError.hint,
              details: updateError.details,
            },
          }),
        },
        { status: 500 }
      )
    }

    // Log firm activity
    await logFirmActivity({
      supabase,
      firmId: firm_id,
      actorUserId: user.id,
      actionType: "firm_onboarding_completed",
      entityType: "business",
      entityId: null,
      metadata: {
        legal_name,
        jurisdiction,
        reporting_standard,
        default_accounting_standard,
      },
    })

    return NextResponse.json({
      success: true,
      message: "Firm onboarding completed successfully",
    })
  } catch (error: any) {
    console.error("Error in firm onboarding complete API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/accounting/firm/onboarding/status
 * 
 * Get firm onboarding status
 * 
 * Query params:
 *   firm_id: string
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

    if (!firmId) {
      return NextResponse.json({ error: "firm_id is required" }, { status: 400 })
    }

    // Verify user belongs to the firm
    const { data: firmUser, error: firmUserError } = await supabase
      .from("accounting_firm_users")
      .select("firm_id, role")
      .eq("firm_id", firmId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (firmUserError || !firmUser) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      )
    }

    // Get firm onboarding data
    const { data: firm, error: firmError } = await supabase
      .from("accounting_firms")
      .select(
        "onboarding_status, onboarding_completed_at, onboarding_completed_by, legal_name, jurisdiction, reporting_standard, default_accounting_standard, name"
      )
      .eq("id", firmId)
      .maybeSingle()

    if (firmError) {
      console.error("Error fetching firm:", firmError)
      return NextResponse.json(
        { error: "Failed to fetch firm data" },
        { status: 500 }
      )
    }

    if (!firm) {
      return NextResponse.json({ error: "Firm not found" }, { status: 404 })
    }

    return NextResponse.json({
      firm: {
        id: firmId,
        name: firm.name,
        onboarding_status: firm.onboarding_status,
        onboarding_completed_at: firm.onboarding_completed_at,
        onboarding_completed_by: firm.onboarding_completed_by,
        legal_name: firm.legal_name,
        jurisdiction: firm.jurisdiction,
        reporting_standard: firm.reporting_standard,
        default_accounting_standard: firm.default_accounting_standard,
      },
      user_role: firmUser.role,
    })
  } catch (error: any) {
    console.error("Error in firm onboarding status API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
