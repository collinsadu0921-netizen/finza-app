import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { getUserFirmIds } from "@/lib/firmActivityLog"

/**
 * GET /api/accounting/firm/ops/alerts
 * 
 * Returns actionable alerts for firm operations (read-only):
 * - Engagement pending acceptance
 * - Engagement suspended
 * - Preflight failures requiring review
 * - Periods awaiting close
 * - AFS drafts awaiting finalization
 * 
 * Access: Users who belong to accounting firms
 * Scope: Firm-scoped only, no client financial data
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

    // Get user's firm IDs
    const firmIds = await getUserFirmIds(supabase, user.id)

    if (firmIds.length === 0) {
      return NextResponse.json({ alerts: [] })
    }

    // Use provided firm_id or first firm
    const targetFirmId = firmId && firmIds.includes(firmId) ? firmId : firmIds[0]

    // Check user's role in the firm (Partner/Senior can see full view, Readonly can see limited view)
    const { data: firmUser, error: firmUserError } = await supabase
      .from("accounting_firm_users")
      .select("role")
      .eq("firm_id", targetFirmId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (firmUserError || !firmUser) {
      return NextResponse.json(
        { error: "User is not a member of this firm" },
        { status: 403 }
      )
    }

    // All firm users (Partner, Senior, Junior, Readonly) can view alerts
    // No additional role restriction needed for alerts (read-only data)

    const alerts: Array<{
      type: string
      client_name: string
      client_id: string
      timestamp: string
      link: string
    }> = []

    // Get all engagements for this firm
    const { data: engagements, error: engagementsError } = await supabase
      .from("firm_client_engagements")
      .select("id, client_business_id, status, created_at, updated_at")
      .eq("accounting_firm_id", targetFirmId)

    if (engagementsError) {
      console.error("Error fetching engagements:", engagementsError)
      return NextResponse.json(
        { error: "Failed to fetch engagements" },
        { status: 500 }
      )
    }

    if (!engagements || engagements.length === 0) {
      return NextResponse.json({ alerts })
    }

    // Get business names
    const businessIds = engagements.map((e) => e.client_business_id)
    const { data: businesses, error: businessesError } = await supabase
      .from("businesses")
      .select("id, name")
      .in("id", businessIds)

    if (businessesError) {
      console.error("Error fetching businesses:", businessesError)
    }

    const businessMap = new Map(
      (businesses || []).map((b) => [b.id, b.name])
    )

    // 1. Engagement pending acceptance
    const pendingEngagements = engagements.filter((e) => e.status === "pending")
    for (const engagement of pendingEngagements) {
      alerts.push({
        type: "engagement_pending",
        client_name: businessMap.get(engagement.client_business_id) || "Unknown Client",
        client_id: engagement.client_business_id,
        timestamp: engagement.created_at,
        link: `/accounting/firm/engagements/${engagement.id}`,
      })
    }

    // 2. Engagement suspended
    const suspendedEngagements = engagements.filter((e) => e.status === "suspended")
    for (const engagement of suspendedEngagements) {
      alerts.push({
        type: "engagement_suspended",
        client_name: businessMap.get(engagement.client_business_id) || "Unknown Client",
        client_id: engagement.client_business_id,
        timestamp: engagement.updated_at || engagement.created_at,
        link: `/accounting/firm/engagements/${engagement.id}`,
      })
    }

    // 3. Preflight failures requiring review
    const activeBusinessIds = engagements
      .filter((e) => e.status === "active")
      .map((e) => e.client_business_id)

    if (activeBusinessIds.length > 0) {
      const { data: exceptions, error: exceptionsError } = await supabase
        .from("accounting_exceptions")
        .select("business_id, created_at, severity")
        .in("business_id", activeBusinessIds)
        .in("severity", ["critical", "error"])
        .eq("resolved", false)
        .order("created_at", { ascending: false })

      // If table doesn't exist, ignore the error (table may not exist yet)
      if (!exceptionsError && exceptions) {
        // Group by business_id and get latest
        const latestExceptions = new Map<string, typeof exceptions[0]>()
        for (const exception of exceptions) {
          if (!latestExceptions.has(exception.business_id)) {
            latestExceptions.set(exception.business_id, exception)
          }
        }

        for (const [businessId, exception] of latestExceptions) {
          alerts.push({
            type: "preflight_failure",
            client_name: businessMap.get(businessId) || "Unknown Client",
            client_id: businessId,
            timestamp: exception.created_at,
            link: `/accounting/businesses/${businessId}/exceptions`,
          })
        }
      } else if (exceptionsError && !exceptionsError.message?.includes("does not exist") && !exceptionsError.message?.includes("relation")) {
        console.error("Error checking accounting exceptions:", exceptionsError)
      }
    }

    // 4. Periods awaiting close
    if (activeBusinessIds.length > 0) {
      const today = new Date().toISOString().split("T")[0]
      const { data: openPeriods, error: periodsError } = await supabase
        .from("accounting_periods")
        .select("business_id, period_end")
        .in("business_id", activeBusinessIds)
        .eq("status", "open")
        .lt("period_end", today)
        .order("period_end", { ascending: false })

      if (!periodsError && openPeriods) {
        // Group by business_id and get latest
        const latestPeriods = new Map<string, typeof openPeriods[0]>()
        for (const period of openPeriods) {
          if (!latestPeriods.has(period.business_id)) {
            latestPeriods.set(period.business_id, period)
          }
        }

        for (const [businessId, period] of latestPeriods) {
          alerts.push({
            type: "period_awaiting_close",
            client_name: businessMap.get(businessId) || "Unknown Client",
            client_id: businessId,
            timestamp: period.period_end,
            link: `/accounting/businesses/${businessId}/periods`,
          })
        }
      }
    }

    // 5. AFS drafts awaiting finalization
    if (activeBusinessIds.length > 0) {
      const { data: draftAfs, error: afsError } = await supabase
        .from("afs_runs")
        .select("business_id, created_at")
        .in("business_id", activeBusinessIds)
        .eq("status", "draft")
        .order("created_at", { ascending: false })

      if (!afsError && draftAfs) {
        // Group by business_id and get latest
        const latestAfs = new Map<string, typeof draftAfs[0]>()
        for (const afs of draftAfs) {
          if (!latestAfs.has(afs.business_id)) {
            latestAfs.set(afs.business_id, afs)
          }
        }

        for (const [businessId, afs] of latestAfs) {
          alerts.push({
            type: "afs_draft_awaiting_finalization",
            client_name: businessMap.get(businessId) || "Unknown Client",
            client_id: businessId,
            timestamp: afs.created_at,
            link: `/accounting/businesses/${businessId}/afs`,
          })
        }
      }
    }

    // Sort alerts by timestamp (most recent first)
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    return NextResponse.json({ alerts })
  } catch (error: any) {
    console.error("Error in firm ops alerts API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
