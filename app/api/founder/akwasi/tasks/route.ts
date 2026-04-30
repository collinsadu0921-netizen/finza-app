import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import {
  isFounderTaskArea,
  isFounderTaskPriority,
  isFounderTaskStatus,
} from "@/lib/founder/akwasiConstants"

export const runtime = "nodejs"

/**
 * GET /api/founder/akwasi/tasks — list tasks (filters: status, area, priority).
 * POST /api/founder/akwasi/tasks — create task.
 */
export async function GET(request: NextRequest) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const area = searchParams.get("area")
  const priority = searchParams.get("priority")

  let q = ctx.admin
    .from("founder_tasks")
    .select(
      "id,title,description,area,priority,status,due_date,source_note_id,created_at,updated_at"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(500)

  if (status && isFounderTaskStatus(status)) {
    q = q.eq("status", status)
  }
  if (area && isFounderTaskArea(area)) {
    q = q.eq("area", area)
  }
  if (priority && isFounderTaskPriority(priority)) {
    q = q.eq("priority", priority)
  }

  const { data, error } = await q

  if (error) {
    console.error("[founder/akwasi/tasks GET]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tasks: data ?? [] })
}

export async function POST(request: NextRequest) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const title = String(body?.title ?? "").trim()
  const description =
    body?.description == null ? null : String(body.description).trim() || null
  const area = body?.area
  const priority = body?.priority
  const status = body?.status
  const due_date =
    body?.due_date == null || body?.due_date === ""
      ? null
      : String(body.due_date).trim().slice(0, 10) || null
  const source_note_id =
    typeof body?.source_note_id === "string" && body.source_note_id.trim()
      ? body.source_note_id.trim()
      : null

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 })
  }
  if (!isFounderTaskArea(area)) {
    return NextResponse.json({ error: "invalid area" }, { status: 400 })
  }

  const p = isFounderTaskPriority(priority) ? priority : "medium"
  const s = isFounderTaskStatus(status) ? status : "not_started"

  const { data, error } = await ctx.admin
    .from("founder_tasks")
    .insert({
      title,
      description,
      area,
      priority: p,
      status: s,
      due_date,
      source_note_id,
      created_by: ctx.user.id,
    })
    .select(
      "id,title,description,area,priority,status,due_date,source_note_id,created_at,updated_at"
    )
    .single()

  if (error) {
    console.error("[founder/akwasi/tasks POST]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ task: data })
}
