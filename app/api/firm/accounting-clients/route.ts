import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { canUserCreateEngagements } from "@/lib/firmEngagements"
import { isFirmOnboardingComplete } from "@/lib/firmOnboarding"
import { logFirmActivity } from "@/lib/firmActivityLog"
import { createAccountingPeriod } from "@/lib/accountingPeriods/lifecycle"

/**
 * POST /api/firm/accounting-clients
 * 
 * Creates a books-only external client for an accounting firm.
 * Step 9.2 Batch C
 * 
 * Request body:
 * {
 *   firm_id: string
 *   legal_name: string
 *   currency: string (default: 'GHS')
 *   period_start: string (YYYY-MM-DD, first day of month)
 * }
 * 
 * Behind the scenes (atomic):
 * 1. Create Business (books_only = true via metadata or flag)
 * 2. Create Accounting Period (first open period)
 * 3. Create Engagement (firm ↔ client, active immediately, approve access)
 * 
 * Returns:
 * {
 *   success: true
 *   business_id: string
 *   business_name: string
 *   period_id: string
 *   engagement_id: string
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

    const body = await request.json()
    const { firm_id, legal_name, currency = "GHS", period_start } = body

    if (!firm_id || !legal_name || !period_start) {
      return NextResponse.json(
        { error: "firm_id, legal_name, and period_start are required" },
        { status: 400 }
      )
    }

    // Validate period_start is first day of month
    const periodDate = new Date(period_start)
    if (periodDate.getDate() !== 1) {
      return NextResponse.json(
        { error: "period_start must be the first day of the month" },
        { status: 400 }
      )
    }

    // Calculate period_end (last day of same month)
    // Use local date methods to avoid timezone conversion issues
    const year = periodDate.getFullYear()
    const month = periodDate.getMonth() + 1 // 1-indexed for month (1-12)
    const lastDayOfMonth = new Date(year, month, 0).getDate() // Day 0 = last day of previous month
    const period_end = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`

    // Check firm onboarding is complete
    const onboardingComplete = await isFirmOnboardingComplete(supabase, firm_id)
    if (!onboardingComplete) {
      // Debug: Get actual onboarding status for better error message
      const { data: firmData } = await supabase
        .from("accounting_firms")
        .select("onboarding_status, name")
        .eq("id", firm_id)
        .maybeSingle()
      
      const status = firmData?.onboarding_status || "unknown"
      console.error(`Firm onboarding check failed. Firm ID: ${firm_id}, Status: ${status}`)
      
      return NextResponse.json(
        { 
          error: "Firm onboarding must be completed before creating external clients",
          debug: {
            firm_id,
            onboarding_status: status,
            message: `Current status: ${status}. Expected: "completed". Please complete firm onboarding at /accounting/firm/onboarding`
          }
        },
        { status: 403 }
      )
    }

    // Check user can create engagements (Partner or Senior)
    const canCreate = await canUserCreateEngagements(supabase, user.id, firm_id)
    if (!canCreate) {
      return NextResponse.json(
        { error: "Only Partners and Seniors can create external clients" },
        { status: 403 }
      )
    }

    // Validate currency
    const validCurrencies = ["GHS", "USD", "EUR", "GBP"]
    if (!validCurrencies.includes(currency)) {
      return NextResponse.json(
        { error: `Invalid currency. Must be one of: ${validCurrencies.join(", ")}` },
        { status: 400 }
      )
    }

    // ATOMIC TRANSACTION: Create business, period, and engagement
    // Use a transaction-like approach with error handling

    // 1. Create Business (books-only)
    // Note: We'll use industry = null or a special value to indicate books-only
    // Alternatively, we could add a metadata JSONB field, but for now we'll use industry = null
    // and add a comment/note that this is books-only
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .insert({
        owner_id: user.id, // Firm user owns the business record
        name: legal_name.trim(),
        legal_name: legal_name.trim(),
        industry: null, // Books-only (no service/POS)
        default_currency: currency,
      })
      .select("id, name")
      .single()

    if (businessError) {
      console.error("Error creating business:", businessError)
      return NextResponse.json(
        { error: `Failed to create business: ${businessError.message}` },
        { status: 500 }
      )
    }

    // 2. Create Accounting Period (first open period)
    let periodId: string
    try {
      const period = await createAccountingPeriod(supabase, {
        business_id: business.id,
        period_start: period_start,
        period_end: period_end,
      })
      periodId = period.id
    } catch (periodError: any) {
      // Rollback: Delete business if period creation fails
      await supabase.from("businesses").delete().eq("id", business.id)
      return NextResponse.json(
        { error: `Failed to create accounting period: ${periodError.message}` },
        { status: 500 }
      )
    }

    // 3. Create Engagement (active immediately, approve access)
    const today = new Date().toISOString().split("T")[0]
    const { data: engagement, error: engagementError } = await supabase
      .from("firm_client_engagements")
      .insert({
        accounting_firm_id: firm_id,
        client_business_id: business.id,
        status: "active", // Active immediately for books-only clients
        access_level: "approve", // Full access for external clients
        effective_from: today,
        effective_to: null, // Ongoing
        created_by: user.id,
        accepted_at: new Date().toISOString(), // Auto-accepted for books-only
      })
      .select("id")
      .single()

    if (engagementError) {
      // Rollback: Delete period and business
      await supabase.from("accounting_periods").delete().eq("id", periodId)
      await supabase.from("businesses").delete().eq("id", business.id)
      console.error("Error creating engagement:", engagementError)
      return NextResponse.json(
        { error: `Failed to create engagement: ${engagementError.message}` },
        { status: 500 }
      )
    }

    // Log activity
    await logFirmActivity({
      supabase,
      firmId: firm_id,
      actorUserId: user.id,
      actionType: "external_client_created",
      entityType: "business",
      entityId: business.id,
      metadata: {
        business_id: business.id,
        business_name: business.name,
        currency,
        period_start,
        period_id: periodId,
        engagement_id: engagement.id,
      },
    })

    return NextResponse.json({
      success: true,
      business_id: business.id,
      business_name: business.name,
      period_id: periodId,
      engagement_id: engagement.id,
      message: "External client created successfully",
    })
  } catch (error: any) {
    console.error("Error in create external client API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
