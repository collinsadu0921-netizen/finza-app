import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"

/**
 * GET /api/accounting/firm/clients
 *
 * Returns list of clients for the user's accounting firm(s) with status information.
 * Canonical contract per client: businessId, businessName, engagementId, status, accessLevel?, effectiveFrom?, effectiveTo?
 * Legacy keys (business_id, business_name, id, engagement_status, etc.) kept for backward compatibility.
 *
 * Query Parameters:
 * - period_start (optional) - filter by period
 * - jurisdiction (optional) - filter by jurisdiction (future)
 * - risk (optional) - filter by risk level ('critical' = has critical exceptions, future)
 *
 * Access: Users who belong to accounting firms. RLS (284) allows firm users to read engaged client businesses.
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
    const periodStart = searchParams.get("period_start")
    const jurisdiction = searchParams.get("jurisdiction") // Future: filter by business country
    const risk = searchParams.get("risk") // Future: filter by critical exceptions

    // Get user's firms
    const { data: firmUsers, error: firmUsersError } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)

    if (firmUsersError) {
      console.error("Error fetching user firms:", firmUsersError)
      return NextResponse.json(
        { error: "Failed to fetch firm membership" },
        { status: 500 }
      )
    }

    if (!firmUsers || firmUsers.length === 0) {
      return NextResponse.json({ clients: [] })
    }

    const firmIds = firmUsers.map((fu) => fu.firm_id)

    const today = new Date().toISOString().split("T")[0]
    // Get all engagements for these firms (effective = accepted or active + date range per migration 279)
    const { data: engagements, error: engagementsError } = await supabase
      .from("firm_client_engagements")
      .select("id, accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to, created_at, accepted_at")
      .in("accounting_firm_id", firmIds)
      .in("status", ["pending", "accepted", "active", "suspended", "terminated"])

    if (engagementsError) {
      console.error("Error fetching engagements:", engagementsError)
      return NextResponse.json(
        { error: "Failed to fetch engagements" },
        { status: 500 }
      )
    }

    if (!engagements || engagements.length === 0) {
      return NextResponse.json({ clients: [] })
    }

    // Get business IDs
    const businessIds = [...new Set(engagements.map((e) => e.client_business_id))]

    // Fetch businesses
    const { data: businesses, error: businessesError } = await supabase
      .from("businesses")
      .select("id, name, industry, default_currency")
      .in("id", businessIds)

    if (businessesError) {
      console.error("Error fetching businesses:", businessesError)
    }

    const businessMap = new Map((businesses || []).map((b) => [b.id, b]))

    // For each engagement, get status information
    const clientsWithStatus = await Promise.all(
      engagements.map(async (engagement: any) => {
        const businessId = engagement.client_business_id
        const business = businessMap.get(businessId)
        
        // Effective = accepted or active + within date range (migration 279)
        const isEffective =
          (engagement.status === "accepted" || engagement.status === "active") &&
          engagement.effective_from <= today &&
          (engagement.effective_to == null || engagement.effective_to >= today)

        // For pending/suspended/terminated, show but indicate status
        // For accepted/active, only include if effective
        if (
          (engagement.status === "accepted" || engagement.status === "active") &&
          !isEffective
        ) {
          return null
        }

        // Get current period status (latest period)
        const { data: periods } = await supabase
          .from("accounting_periods")
          .select("status, period_start, period_end")
          .eq("business_id", businessId)
          .order("period_start", { ascending: false })
          .limit(1)

        const currentPeriod = periods && periods.length > 0 ? periods[0] : null
        const periodStatus = currentPeriod?.status || "none"

        // Get pending adjustments count (journal entries with reference_type = 'adjustment')
        // Note: Currently counting all adjustments - future: add status field for pending/reviewed
        let adjustmentsQuery = supabase
          .from("journal_entries")
          .select("*", { count: "exact", head: true })
          .eq("business_id", businessId)
          .eq("reference_type", "adjustment")

        if (periodStart && currentPeriod) {
          adjustmentsQuery = adjustmentsQuery
            .gte("date", currentPeriod.period_start)
            .lte("date", currentPeriod.period_end)
        }

        const { count: adjustmentsCount } = await adjustmentsQuery

        // Get AFS status (latest run)
        const { data: afsRuns } = await supabase
          .from("afs_runs")
          .select("status")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(1)

        const afsStatus = afsRuns && afsRuns.length > 0 ? afsRuns[0].status : "none"

        // Get exceptions count (by severity)
        // NOTE: Exceptions table doesn't exist yet - returning 0 for now
        const exceptionsCount = {
          critical: 0,
          warning: 0,
          info: 0,
          total: 0,
        }

        const businessName = business?.name ?? "Unknown"
        return {
          id: engagement.id,
          business_id: businessId,
          business_name: businessName,
          access_level: engagement.access_level,
          engagement_status: engagement.status,
          effective_from: engagement.effective_from,
          effective_to: engagement.effective_to,
          granted_at: engagement.created_at,
          accepted_at: engagement.accepted_at,
          businessId,
          businessName,
          engagementId: engagement.id,
          accessLevel: engagement.access_level,
          effectiveFrom: engagement.effective_from,
          effectiveTo: engagement.effective_to ?? null,
          status: {
            period_status: periodStatus,
            period_start: currentPeriod?.period_start || null,
            period_end: currentPeriod?.period_end || null,
            pending_adjustments_count: adjustmentsCount || 0,
            afs_status: afsStatus, // 'none' | 'draft' | 'finalized'
            exceptions_count: exceptionsCount,
          },
        }
      })
    )
    
    // Filter out null entries (non-effective active engagements)
    const validClients = clientsWithStatus.filter((c) => c !== null)

    // Apply filters
    let filteredClients = validClients

    // Filter by period status if period_start provided
    if (periodStart) {
      filteredClients = filteredClients.filter(
        (client) => client.status.period_start === periodStart
      )
    }

    // Filter by jurisdiction (future - requires businesses.country field)
    if (jurisdiction) {
      // For now, skip - would filter by businesses.country or similar
    }

    // Filter by risk (future - filter by critical exceptions)
    if (risk === "critical") {
      filteredClients = filteredClients.filter(
        (client) => client.status.exceptions_count.critical > 0
      )
    }

    return NextResponse.json({
      clients: filteredClients,
      total: filteredClients.length,
    })
  } catch (error: any) {
    console.error("Error in firm clients API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
