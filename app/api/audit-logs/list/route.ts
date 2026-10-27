import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { resolveAuditActors } from "@/lib/audit/resolveAuditActors"
import { resolveBusinessScopeForUser } from "@/lib/business"
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

    const { searchParams } = new URL(request.url)
    const requestedBusinessId = searchParams.get("business_id")
    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    const businessId = scope.businessId

    const { data: businessRow } = await supabase
      .from("businesses")
      .select("owner_id")
      .eq("id", businessId)
      .maybeSingle()

    // Owner always; team members need operational or accounting visibility
    const isOwner = businessRow?.owner_id === user.id
    if (!isOwner) {
      const effective = await getEffectivePermissions(supabase, user.id, businessId)
      if (!effective.has("accounting.view") && !effective.has("reports.view")) {
        return NextResponse.json(
          { error: "Forbidden: requires reports.view or accounting.view permission" },
          { status: 403 }
        )
      }
    }

    const tierDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "business",
    })
    if (tierDenied) return tierDenied

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
      .eq("business_id", businessId)
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

    // Resolve only the actor IDs that appear on this business-scoped result.
    // No unrestricted auth-admin user listing is performed.
    const userIds = (logs || [])
      .map((log: { user_id?: string | null }) => log.user_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)

    let userMap = new Map<string, { id: string; name: string | null; email: string | null; label: string | null }>()
    try {
      const admin = createSupabaseAdminClient()
      userMap = await resolveAuditActors(admin, businessId, userIds)
    } catch (err) {
      console.warn("Could not resolve audit actor labels", err)
    }

    const logsWithUsers = (logs || []).map((log: any) => {
      const actor = log.user_id ? userMap.get(log.user_id) : null
      return {
        ...log,
        user: actor
          ? {
              id: actor.id,
              name: actor.name,
              display_name: actor.name,
              email: actor.email,
              label: actor.label,
            }
          : null,
      }
    })

    return NextResponse.json({ logs: logsWithUsers }, { status: 200 })
  } catch (error: any) {
    console.error("Error in audit logs list:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

