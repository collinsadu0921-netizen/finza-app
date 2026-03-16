import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getActiveFirmId } from "@/lib/firmSession"
import { getActiveEngagement, isEngagementEffective } from "@/lib/firmEngagements"
import { resolveAuthority } from "@/lib/firmAuthority"

/**
 * GET /api/accounting/drafts
 * 
 * Lists manual journal drafts for the active firm and client
 * 
 * Query params:
 * - status: 'draft' | 'submitted' | 'approved' | 'rejected' (optional)
 * - period_id: UUID (optional)
 * - start_date: DATE (optional)
 * - end_date: DATE (optional)
 * 
 * Access: Firm users with read engagement access
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

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const periodId = searchParams.get("period_id")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    // Get active firm and client from session
    // Note: In server-side, we need to get these from headers or pass them as params
    // For now, we'll require them as query params
    const firmId = searchParams.get("firm_id")
    const clientBusinessId = searchParams.get("client_business_id")

    if (!firmId || !clientBusinessId) {
      return NextResponse.json(
        { error: "Missing required parameters: firm_id, client_business_id" },
        { status: 400 }
      )
    }

    // Check authority: View drafts requires read engagement access
    const { data: firmUser } = await supabase
      .from("accounting_firm_users")
      .select("role")
      .eq("firm_id", firmId)
      .eq("user_id", user.id)
      .maybeSingle()

    if (!firmUser) {
      return NextResponse.json(
        { error: "User is not a member of this firm" },
        { status: 403 }
      )
    }

    // Get active engagement
    const engagement = await getActiveEngagement(
      supabase,
      firmId,
      clientBusinessId
    )

    // Check authority
    const authority = resolveAuthority({
      firmRole: firmUser.role as any,
      engagementAccess: engagement?.access_level as any || null,
      action: "view_client_data", // Viewing drafts is similar to viewing client data
      engagementStatus: engagement?.status as any || null,
    })

    if (!authority.allowed) {
      return NextResponse.json(
        { error: authority.reason || "Insufficient authority" },
        { status: 403 }
      )
    }

    // Build query
    let query = supabase
      .from("manual_journal_drafts")
      .select(`
        id,
        status,
        entry_date,
        description,
        total_debit,
        total_credit,
        lines,
        created_by,
        submitted_by,
        approved_by,
        rejected_by,
        created_at,
        submitted_at,
        approved_at,
        rejected_at,
        rejection_reason,
        journal_entry_id,
        posted_at,
        posted_by,
        period_id,
        accounting_periods (
          period_start,
          period_end,
          status
        )
      `)
      .eq("accounting_firm_id", firmId)
      .eq("client_business_id", clientBusinessId)
      .order("created_at", { ascending: false })

    // Apply filters
    if (status) {
      query = query.eq("status", status)
    }

    if (periodId) {
      query = query.eq("period_id", periodId)
    }

    if (startDate) {
      query = query.gte("entry_date", startDate)
    }

    if (endDate) {
      query = query.lte("entry_date", endDate)
    }

    const { data: drafts, error } = await query

    if (error) {
      console.error("Error fetching drafts:", error)
      return NextResponse.json(
        { error: "Failed to fetch drafts" },
        { status: 500 }
      )
    }

    // Get user names for created_by, submitted_by, approved_by, rejected_by, posted_by
    const userIds = new Set<string>()
    drafts?.forEach((draft: any) => {
      if (draft.created_by) userIds.add(draft.created_by)
      if (draft.submitted_by) userIds.add(draft.submitted_by)
      if (draft.approved_by) userIds.add(draft.approved_by)
      if (draft.rejected_by) userIds.add(draft.rejected_by)
      if (draft.posted_by) userIds.add(draft.posted_by)
    })

    const userMap = new Map<string, { email: string; full_name: string | null }>()
    if (userIds.size > 0) {
      const { data: users } = await supabase
        .from("users")
        .select("id, email, full_name")
        .in("id", Array.from(userIds))

      users?.forEach((u: any) => {
        userMap.set(u.id, { email: u.email, full_name: u.full_name })
      })
    }

    // Enrich drafts with user names
    const enrichedDrafts = drafts?.map((draft: any) => ({
      ...draft,
      created_by_name: draft.created_by ? userMap.get(draft.created_by)?.email || "Unknown" : null,
      submitted_by_name: draft.submitted_by ? userMap.get(draft.submitted_by)?.email || "Unknown" : null,
      approved_by_name: draft.approved_by ? userMap.get(draft.approved_by)?.email || "Unknown" : null,
      rejected_by_name: draft.rejected_by ? userMap.get(draft.rejected_by)?.email || "Unknown" : null,
      posted_by_name: draft.posted_by ? userMap.get(draft.posted_by)?.email || "Unknown" : null,
    }))

    return NextResponse.json({
      drafts: enrichedDrafts || [],
    })
  } catch (error: any) {
    console.error("Error in drafts list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
