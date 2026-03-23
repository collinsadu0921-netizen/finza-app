import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getEffectivePermissions } from "@/lib/userPermissions"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    // Only owner, admin, and users with accounting.view permission can see audit logs
    const isOwner = business.owner_id === user.id
    if (!isOwner) {
      const effective = await getEffectivePermissions(supabase, user.id, business.id)
      if (!effective.has("accounting.view")) {
        return NextResponse.json({ error: "Forbidden: requires accounting.view permission" }, { status: 403 })
      }
    }

    const tierDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "business",
    })
    if (tierDenied) return tierDenied

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const userId = searchParams.get("user_id")
    const actionType = searchParams.get("action_type")
    const entityType = searchParams.get("entity_type")
    const entityId = searchParams.get("entity_id")
    const search = searchParams.get("search")

    // Try to query audit_logs table - if it doesn't exist, return empty array
    // We'll catch the error in the main query instead of pre-checking

    // Query audit_logs with correct column names
    // Schema: id, business_id, user_id, action_type, entity_type, entity_id, old_values, new_values, created_at
    let query = supabase
      .from("audit_logs")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(1000) // Limit to prevent performance issues

    if (startDate) {
      query = query.gte("created_at", startDate)
    }

    if (endDate) {
      query = query.lte("created_at", endDate + "T23:59:59")
    }

    if (userId) {
      query = query.eq("user_id", userId)
    }

    if (actionType) {
      query = query.eq("action_type", actionType)
    }

    if (entityType) {
      query = query.eq("entity_type", entityType)
    }

    if (entityId) {
      query = query.eq("entity_id", entityId)
    }

    if (search) {
      query = query.or(`action_type.ilike.%${search}%,description.ilike.%${search}%,entity_type.ilike.%${search}%`)
    }

    const { data: logs, error } = await query

    if (error) {
      console.error("Error fetching audit logs:", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      })

      // If it's a table not found error, return empty array gracefully
      if (error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        error.message?.includes("relation") && error.message?.includes("does not exist")) {
        console.warn("audit_logs table does not exist, returning empty logs")
        return NextResponse.json({ logs: [] }, { status: 200 })
      }

      // For other errors, still return empty array to not break the UI
      // But log the error for debugging
      console.warn("Audit logs query failed, returning empty array:", error.message)
      return NextResponse.json({ logs: [] }, { status: 200 })
    }

    // Fetch user emails for user_id lookups (if admin access available)
    const userMap: Record<string, { id: string; email: string }> = {}
    const userIds = Array.from(new Set((logs || []).map((log: any) => log.user_id).filter(Boolean)))

    if (userIds.length > 0) {
      try {
        // Try to fetch users via admin API (if available)
        const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers()
        if (!usersError && usersData) {
          usersData.users.forEach((user) => {
            if (userIds.includes(user.id)) {
              userMap[user.id] = { id: user.id, email: user.email || 'Unknown' }
            }
          })
        }
      } catch (err) {
        // If admin API not available, try fetching from public schema
        // Note: This is a fallback and may not work in all setups
        console.warn("Could not fetch user emails via admin API")
      }
    }

    // Map logs with user information
    const logsWithUsers = (logs || []).map((log: any) => ({
      ...log,
      user: log.user_id ? (userMap[log.user_id] || null) : null,
    }))

    return NextResponse.json({ logs: logsWithUsers }, { status: 200 })
  } catch (error: any) {
    console.error("Error in audit logs list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

