import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import {
  isFounderTaskArea,
  isFounderTaskPriority,
  isFounderTaskStatus,
} from "@/lib/founder/akwasiConstants"

export const runtime = "nodejs"

/**
 * PATCH /api/founder/akwasi/tasks/[id] — update task (partial). Soft-delete via status is not used; set deleted_at optional.
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const t = String(body.title).trim()
    if (!t) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 })
    patch.title = t
  }
  if (body.description !== undefined) {
    patch.description =
      body.description == null ? null : String(body.description).trim() || null
  }
  if (body.area !== undefined) {
    if (!isFounderTaskArea(body.area)) {
      return NextResponse.json({ error: "invalid area" }, { status: 400 })
    }
    patch.area = body.area
  }
  if (body.priority !== undefined) {
    if (!isFounderTaskPriority(body.priority)) {
      return NextResponse.json({ error: "invalid priority" }, { status: 400 })
    }
    patch.priority = body.priority
  }
  if (body.status !== undefined) {
    if (!isFounderTaskStatus(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 })
    }
    patch.status = body.status
  }
  if (body.due_date !== undefined) {
    patch.due_date =
      body.due_date == null || body.due_date === ""
        ? null
        : String(body.due_date).trim().slice(0, 10) || null
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from("founder_tasks")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select(
      "id,title,description,area,priority,status,due_date,source_note_id,created_at,updated_at"
    )
    .maybeSingle()

  if (error) {
    console.error("[founder/akwasi/tasks PATCH]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  return NextResponse.json({ task: data })
}
