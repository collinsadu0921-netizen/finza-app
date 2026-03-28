import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"

/**
 * GET /api/accounting/tasks
 *
 * Firm-wide task listing across all clients.
 * Returns tasks for every client the accountant's firm manages.
 * Client name is joined from businesses.name.
 *
 * Query params:
 *   status   — filter by task status
 *   priority — filter by task priority
 *   client   — filter by client_business_id
 *   limit    — max results (default 200, max 500)
 *
 * Auth: firm membership required (requireFirmMemberForApi).
 * No cross-firm leakage: query is scoped to user's firm_id(s).
 */

const VALID_STATUSES   = ["pending", "in_progress", "blocked", "completed", "cancelled"]
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"]

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Forbidden"
      return NextResponse.json({ error: msg }, { status: msg === "Unauthorized" ? 401 : 403 })
    }

    // Enforce firm membership
    const memberForbidden = await requireFirmMemberForApi(supabase, user.id)
    if (memberForbidden) return memberForbidden

    // Resolve firm IDs for this user
    const { data: firmUsers, error: firmErr } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)

    if (firmErr || !firmUsers?.length) {
      return NextResponse.json({ error: "Not a firm member" }, { status: 403 })
    }

    const firmIds = firmUsers.map((f) => f.firm_id as string).filter(Boolean)

    const { searchParams } = new URL(request.url)
    const statusFilter   = searchParams.get("status")?.trim()
    const priorityFilter = searchParams.get("priority")?.trim()
    const clientFilter   = searchParams.get("client")?.trim()
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10), 500)

    // Join businesses to get client name in a single query
    let query = supabase
      .from("client_tasks")
      .select(`
        id,
        firm_id,
        client_business_id,
        title,
        description,
        status,
        priority,
        assigned_to_user_id,
        created_by_user_id,
        due_at,
        completed_at,
        metadata,
        created_at,
        updated_at,
        businesses!client_tasks_client_business_id_fkey (
          id,
          name
        )
      `)
      .in("firm_id", firmIds)
      .order("due_at",    { ascending: true,  nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit)

    if (statusFilter   && VALID_STATUSES.includes(statusFilter))     query = query.eq("status",   statusFilter)
    if (priorityFilter && VALID_PRIORITIES.includes(priorityFilter)) query = query.eq("priority", priorityFilter)
    if (clientFilter)  query = query.eq("client_business_id", clientFilter)

    const { data: rows, error: listErr } = await query

    if (listErr) {
      console.error("firm-wide client_tasks list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    // Flatten the joined business name for convenience
    const tasks = (rows ?? []).map((row) => {
      const businessRaw = row.businesses as unknown
      const bizCandidate = Array.isArray(businessRaw)
        ? (businessRaw[0] as { id?: string; name?: string } | undefined)
        : (businessRaw as { id?: string; name?: string } | null)
      const biz =
        bizCandidate && typeof bizCandidate.name === "string"
          ? { id: String(bizCandidate.id ?? ""), name: bizCandidate.name }
          : null
      const { businesses: _drop, ...rest } = row as typeof row & { businesses: unknown }
      return { ...rest, client_name: biz?.name ?? null }
    })

    return NextResponse.json({ tasks })
  } catch (e) {
    console.error("GET /api/accounting/tasks:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
