/**
 * GET /api/accounting/audit
 * Read-only. Lists audit_logs for the given business, scoped by accounting read authority.
 * Query: businessId (required), actionType, entityType, userId, entityId, startDate, endDate, limit, cursor.
 * No schema changes; uses existing audit_logs table and RLS.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

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
    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required query param: businessId" },
        { status: 400 }
      )
    }
    const businessId = resolved.businessId

    const tierDenied = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      businessId,
      "professional"
    )
    if (tierDenied) return tierDenied

    const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const actionType = searchParams.get("actionType") ?? searchParams.get("action_type") ?? null
    const entityType = searchParams.get("entityType") ?? searchParams.get("entity_type") ?? null
    const userId = searchParams.get("userId") ?? searchParams.get("user_id") ?? null
    const entityId = searchParams.get("entityId") ?? searchParams.get("entity_id") ?? null
    const startDate = searchParams.get("startDate") ?? searchParams.get("start_date") ?? null
    const endDate = searchParams.get("endDate") ?? searchParams.get("end_date") ?? null
    const limitParam = searchParams.get("limit")
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    )
    const cursor = searchParams.get("cursor") ?? null

    let query = supabase
      .from("audit_logs")
      .select("id, business_id, user_id, action_type, entity_type, entity_id, old_values, new_values, description, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit + 1)

    if (actionType) query = query.eq("action_type", actionType)
    if (entityType) query = query.eq("entity_type", entityType)
    if (userId) query = query.eq("user_id", userId)
    if (entityId) query = query.eq("entity_id", entityId)
    if (startDate) query = query.gte("created_at", startDate)
    if (endDate) query = query.lte("created_at", endDate + "T23:59:59.999Z")
    if (cursor) query = query.lt("created_at", cursor)

    const { data: rows, error } = await query

    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        (error.message?.includes("relation") && error.message?.includes("does not exist"))
      ) {
        return NextResponse.json({ logs: [], nextCursor: null }, { status: 200 })
      }
      console.error("Accounting audit list error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to fetch audit logs" },
        { status: 500 }
      )
    }

    const logs = rows ?? []
    const hasMore = logs.length > limit
    const returned = hasMore ? logs.slice(0, limit) : logs
    const nextCursor =
      hasMore && returned.length > 0
        ? returned[returned.length - 1].created_at
        : null

    return NextResponse.json({
      logs: returned,
      nextCursor,
    })
  } catch (err: unknown) {
    console.error("Accounting audit GET:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
