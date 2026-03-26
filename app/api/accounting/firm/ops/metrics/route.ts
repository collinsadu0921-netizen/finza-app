import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { getUserFirmIds } from "@/lib/accounting/firm/activityLog"
import { getActiveEngagement, isEngagementEffective } from "@/lib/accounting/firm/engagements"

/**
 * GET /api/accounting/firm/ops/metrics
 * 
 * Returns firm-level operational metrics (read-only):
 * - Active clients (engagements with status = active and effective)
 * - Pending engagements (status = pending)
 * - Suspended engagements (status = suspended)
 * - Clients blocked by preflight (latest preflight status = blocked/fail)
 * - Periods awaiting close (period ended but not closed)
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
      return NextResponse.json({
        active_clients: 0,
        pending_engagements: 0,
        suspended_engagements: 0,
        clients_blocked_by_preflight: 0,
        periods_awaiting_close: 0,
      })
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

    // All firm users (Partner, Senior, Junior, Readonly) can view ops metrics
    // No additional role restriction needed for metrics (read-only data)

    // Get all engagements for this firm
    const { data: engagements, error: engagementsError } = await supabase
      .from("firm_client_engagements")
      .select("id, client_business_id, status, effective_from, effective_to")
      .eq("accounting_firm_id", targetFirmId)

    if (engagementsError) {
      console.error("Error fetching engagements:", engagementsError)
      return NextResponse.json(
        { error: "Failed to fetch engagements" },
        { status: 500 }
      )
    }

    if (!engagements || engagements.length === 0) {
      return NextResponse.json({
        active_clients: 0,
        pending_engagements: 0,
        suspended_engagements: 0,
        clients_blocked_by_preflight: 0,
        periods_awaiting_close: 0,
      })
    }

    // Count engagements by status
    const today = new Date().toISOString().split("T")[0]
    let activeClients = 0
    let pendingEngagements = 0
    let suspendedEngagements = 0

    for (const engagement of engagements) {
      if (engagement.status === "pending") {
        pendingEngagements++
      } else if (engagement.status === "suspended") {
        suspendedEngagements++
      } else if (engagement.status === "active") {
        // Check if engagement is effective
        if (
          engagement.effective_from <= today &&
          (!engagement.effective_to || engagement.effective_to >= today)
        ) {
          activeClients++
        }
      }
    }

    // Get business IDs for active engagements
    const activeBusinessIds = engagements
      .filter((e) => {
        if (e.status !== "active") return false
        return (
          e.effective_from <= today &&
          (!e.effective_to || e.effective_to >= today)
        )
      })
      .map((e) => e.client_business_id)

    // Count clients blocked by preflight
    // Check for accounting_exceptions with severity = 'critical' or 'error'
    // Note: accounting_exceptions table may not exist, so we handle errors gracefully
    let clientsBlockedByPreflight = 0
    if (activeBusinessIds.length > 0) {
      const { data: exceptions, error: exceptionsError } = await supabase
        .from("accounting_exceptions")
        .select("business_id")
        .in("business_id", activeBusinessIds)
        .in("severity", ["critical", "error"])
        .eq("resolved", false)

      // If table doesn't exist, ignore the error (table may not exist yet)
      if (!exceptionsError && exceptions) {
        clientsBlockedByPreflight = new Set(exceptions.map((e) => e.business_id)).size
      } else if (exceptionsError && !exceptionsError.message?.includes("does not exist") && !exceptionsError.message?.includes("relation")) {
        console.error("Error checking accounting exceptions:", exceptionsError)
      }
    }

    // Count periods awaiting close
    // Periods that have ended (period_end < today) but status is still 'open'
    let periodsAwaitingClose = 0
    if (activeBusinessIds.length > 0) {
      const { data: openPeriods, error: periodsError } = await supabase
        .from("accounting_periods")
        .select("business_id")
        .in("business_id", activeBusinessIds)
        .eq("status", "open")
        .lt("period_end", today)

      if (!periodsError && openPeriods) {
        periodsAwaitingClose = new Set(openPeriods.map((p) => p.business_id)).size
      }
    }

    return NextResponse.json({
      active_clients: activeClients,
      pending_engagements: pendingEngagements,
      suspended_engagements: suspendedEngagements,
      clients_blocked_by_preflight: clientsBlockedByPreflight,
      periods_awaiting_close: periodsAwaitingClose,
    })
  } catch (error: any) {
    console.error("Error in firm ops metrics API:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
