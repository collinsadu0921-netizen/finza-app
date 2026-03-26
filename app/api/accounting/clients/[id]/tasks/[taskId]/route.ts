import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { logFirmActivity } from "@/lib/accounting/firm/activityLog"

/**
 * PATCH /api/accounting/clients/[id]/tasks/[taskId]
 * Body: { status?, priority?, title?, description?, assigned_to_user_id?, due_at? }
 * Update a task (write authority).
 * - status → 'completed': sets completed_at to now (if not already set)
 * - status → anything else: clears completed_at
 * Logs client_task_updated with previous/new status.
 */

const VALID_STATUSES   = ["pending", "in_progress", "blocked", "completed", "cancelled"]
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"]

type RouteContext = { params: Promise<{ id: string; taskId: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id: businessId, taskId } = await context.params
    if (!businessId) return NextResponse.json({ error: "Missing client id" }, { status: 400 })
    if (!taskId)     return NextResponse.json({ error: "Missing taskId" }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json({ error: "Request body is empty" }, { status: 400 })
    }

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

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams: new URLSearchParams({ business_id: businessId }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json({ error: "Missing or invalid business context" }, { status: 400 })
    }

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId: resolved.businessId,
      requiredLevel: "write",
    })
    if (!auth.allowed || !auth.firmId) {
      return NextResponse.json({ error: "Forbidden", reason: auth.reason }, { status: 403 })
    }

    // Verify task belongs to this firm + client
    const { data: existing, error: fetchErr } = await supabase
      .from("client_tasks")
      .select("id, title, status, priority, completed_at")
      .eq("id", taskId)
      .eq("firm_id", auth.firmId)
      .eq("client_business_id", businessId)
      .maybeSingle()

    if (fetchErr) {
      console.error("client_tasks fetch:", fetchErr)
      return NextResponse.json({ error: fetchErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Build patch
    const patch: Record<string, unknown> = {}
    let newStatus = existing.status

    if (typeof body.status === "string") {
      const s = body.status.trim()
      if (!VALID_STATUSES.includes(s)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 }
        )
      }
      patch.status = s
      newStatus = s
      patch.completed_at =
        s === "completed"
          ? (existing.completed_at ?? new Date().toISOString())
          : null
    }

    if (typeof body.priority === "string") {
      const p = body.priority.trim()
      if (!VALID_PRIORITIES.includes(p)) {
        return NextResponse.json(
          { error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(", ")}` },
          { status: 400 }
        )
      }
      patch.priority = p
    }

    if (typeof body.title === "string") {
      const t = body.title.trim()
      if (!t) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 })
      patch.title = t
    }

    if (typeof body.description === "string") {
      patch.description = body.description.trim()
    }

    if ("assigned_to_user_id" in body) {
      patch.assigned_to_user_id =
        typeof body.assigned_to_user_id === "string"
          ? body.assigned_to_user_id.trim() || null
          : null
    }

    if ("due_at" in body) {
      patch.due_at =
        typeof body.due_at === "string" ? body.due_at.trim() || null : null
    }

    if (typeof body.metadata === "object" && body.metadata && !Array.isArray(body.metadata)) {
      patch.metadata = body.metadata
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data: updated, error: updateErr } = await supabase
      .from("client_tasks")
      .update(patch)
      .eq("id", taskId)
      .eq("firm_id", auth.firmId)
      .select()
      .single()

    if (updateErr) {
      console.error("client_tasks update:", updateErr)
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    await logFirmActivity({
      supabase,
      firmId: auth.firmId,
      actorUserId: user.id,
      actionType: "client_task_updated",
      entityType: "client",
      entityId: businessId,
      metadata: {
        task_id: taskId,
        title: existing.title,
        previous_status: existing.status,
        new_status: newStatus,
        client_business_id: businessId,
        engagement_id: auth.engagementId,
      },
    })

    return NextResponse.json({ task: updated })
  } catch (e) {
    console.error("PATCH /api/accounting/clients/[id]/tasks/[taskId]:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal server error" },
      { status: 500 }
    )
  }
}
