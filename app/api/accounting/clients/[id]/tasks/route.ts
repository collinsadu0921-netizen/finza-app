import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * GET /api/accounting/clients/[id]/tasks?status=&priority=&limit=
 * List tasks for a client (read authority), ordered by:
 *   1. due_at ASC NULLS LAST (overdue first)
 *   2. priority weight DESC (urgent → high → normal → low)
 *   3. created_at DESC
 *
 * POST /api/accounting/clients/[id]/tasks
 * Body: { title, description?, priority?, assigned_to_user_id?, due_at? }
 * Create a new task (write authority). Status starts as 'pending'.
 * Logs client_task_created.
 */

const VALID_STATUSES   = ["pending", "in_progress", "blocked", "completed", "cancelled"]
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"]

type RouteContext = { params: Promise<{ id: string }> }

// ── shared auth ───────────────────────────────────────────────────────────────

async function resolveAuth(
  request: NextRequest,
  businessId: string,
  requiredLevel: "read" | "write"
) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Unauthorized", status: 401 } as const

  try {
    assertAccountingAccess(accountingUserFromRequest(request))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Forbidden"
    return { error: msg, status: msg === "Unauthorized" ? 401 : 403 } as const
  }

  const resolved = await resolveAccountingContext({
    supabase,
    userId: user.id,
    searchParams: new URLSearchParams({ business_id: businessId }),
    pathname: new URL(request.url).pathname,
    source: "api",
  })
  if ("error" in resolved) {
    return { error: "Missing or invalid business context", status: 400 } as const
  }

  const auth = await getAccountingAuthority({
    supabase,
    firmUserId: user.id,
    businessId: resolved.businessId,
    requiredLevel,
  })
  if (!auth.allowed || !auth.firmId) {
    return { error: "Forbidden", reason: auth.reason, status: 403 } as const
  }

  return { supabase, user, resolved, auth }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

    const result = await resolveAuth(request, businessId, "read")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, auth } = result

    const { searchParams } = new URL(request.url)
    const statusFilter   = searchParams.get("status")?.trim()
    const priorityFilter = searchParams.get("priority")?.trim()
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10), 500)

    let query = supabase
      .from("client_tasks")
      .select("*")
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", businessId)
      .order("due_at",    { ascending: true,  nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit)

    if (statusFilter   && VALID_STATUSES.includes(statusFilter))   query = query.eq("status",   statusFilter)
    if (priorityFilter && VALID_PRIORITIES.includes(priorityFilter)) query = query.eq("priority", priorityFilter)

    const { data: tasks, error: listErr } = await query

    if (listErr) {
      console.error("client_tasks list:", listErr)
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    return NextResponse.json({ tasks: tasks ?? [] })
  } catch (e) {
    console.error("GET /api/accounting/clients/[id]/tasks:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const title       = typeof body.title       === "string" ? body.title.trim()       : ""
    const description = typeof body.description === "string" ? body.description.trim() : ""
    const priority    =
      typeof body.priority === "string" && VALID_PRIORITIES.includes(body.priority.trim())
        ? body.priority.trim()
        : "normal"
    const assignedTo  =
      typeof body.assigned_to_user_id === "string" ? body.assigned_to_user_id.trim() || null : null
    const dueAt       =
      typeof body.due_at === "string" ? body.due_at.trim() || null : null
    const metadata =
      body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? body.metadata
        : {}

    if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 })

    const result = await resolveAuth(request, businessId, "write")
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, ...("reason" in result ? { reason: result.reason } : {}) },
        { status: result.status }
      )
    }
    const { supabase, user, auth } = result

    const { data: inserted, error: insertErr } = await supabase
      .from("client_tasks")
      .insert({
        firm_id: auth.firmId,
        client_business_id: businessId,
        title,
        description,
        status: "pending",
        priority,
        assigned_to_user_id: assignedTo,
        created_by_user_id: user.id,
        due_at: dueAt,
        completed_at: null,
        metadata,
      })
      .select()
      .single()

    if (insertErr) {
      console.error("client_tasks insert:", insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId!,
      actorUserId: user.id,
      actionType: "client_task_created",
      entityType: "client",
      entityId: businessId,
      metadata: {
        task_id: inserted.id,
        title,
        priority,
        due_at: dueAt,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ task: inserted }, { status: 201 })
  } catch (e) {
    console.error("POST /api/accounting/clients/[id]/tasks:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
