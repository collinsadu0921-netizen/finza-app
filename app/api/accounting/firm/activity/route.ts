import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { getUserFirmIds } from "@/lib/accounting/firm/activityLog"
import { getEngagementById } from "@/lib/accounting/firm/engagements"

/**
 * GET /api/accounting/firm/activity
 *
 * Returns activity logs for the user's accounting firm(s)
 *
 * Query Parameters:
 * - date_from (optional) - Filter logs from this date (ISO string)
 * - date_to (optional) - Filter logs to this date (ISO string)
 * - action_type (optional) - Filter by action type
 * - actor_user_id (optional) - Filter by actor user ID
 * - engagement_id (optional) - Filter to logs for this engagement (engagement + blocked attempts for same client)
 * - business_id (optional) - Filter to logs for this business (blocked_attempt entity_id or engagement metadata)
 * - limit (optional) - Maximum number of logs to return (default: 100, max: 500)
 * - offset (optional) - Offset for pagination (default: 0)
 *
 * Access: Users who belong to accounting firms
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
    const dateFrom = searchParams.get("date_from")
    const dateTo = searchParams.get("date_to")
    const actionType = searchParams.get("action_type")
    const actorUserId = searchParams.get("actor_user_id")
    const engagementId = searchParams.get("engagement_id")
    const businessIdParam = searchParams.get("business_id")
    const limitParam = searchParams.get("limit")
    const offsetParam = searchParams.get("offset")

    // Get user's firm IDs
    const firmIds = await getUserFirmIds(supabase, user.id)

    if (firmIds.length === 0) {
      return NextResponse.json({ logs: [], total: 0 })
    }

    let businessId: string | null = businessIdParam
    if (engagementId && !businessId) {
      const engagement = await getEngagementById(supabase, engagementId)
      if (engagement && firmIds.includes(engagement.accounting_firm_id)) {
        businessId = engagement.client_business_id
      }
    }

    // Build query
    let query = supabase
      .from("accounting_firm_activity_logs")
      .select("*", { count: "exact" })
      .in("firm_id", firmIds)
      .order("created_at", { ascending: false })

    // Filter by engagement or business: engagement events + blocked attempts for same client
    if (engagementId || businessId) {
      const engagementClause = engagementId
        ? `(entity_type.eq.engagement,entity_id.eq.${engagementId})`
        : null
      const businessClause = businessId
        ? `(entity_type.eq.blocked_attempt,entity_id.eq.${businessId})`
        : null
      const orParts = [engagementClause, businessClause].filter(Boolean)
      if (orParts.length === 1) {
        query = query.or(orParts[0] as string)
      } else if (orParts.length === 2) {
        query = query.or(`${orParts[0]}.or.${orParts[1]}`)
      }
    }

    // Apply filters
    if (dateFrom) {
      query = query.gte("created_at", dateFrom)
    }

    if (dateTo) {
      query = query.lte("created_at", dateTo)
    }

    if (actionType) {
      query = query.eq("action_type", actionType)
    }

    if (actorUserId) {
      query = query.eq("actor_user_id", actorUserId)
    }

    // Apply pagination
    const limit = Math.min(parseInt(limitParam || "100", 10), 500)
    const offset = parseInt(offsetParam || "0", 10)

    query = query.range(offset, offset + limit - 1)

    const { data: logs, error: logsError, count } = await query

    if (logsError) {
      console.error("Error fetching activity logs:", logsError)
      return NextResponse.json(
        { error: logsError.message || "Failed to fetch activity logs" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      logs: logs || [],
      total: count || 0,
      limit,
      offset,
    })
  } catch (error: unknown) {
    console.error("Error in firm activity API:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
