import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { AKWASI_EXTRACT_TASKS_SYSTEM } from "@/lib/founder/akwasiPrompts"
import { akwasiGroqJsonCompletion } from "@/lib/founder/akwasiGroqJson"
import { safeParseJsonObject } from "@/lib/founder/akwasiJsonParse"
import {
  isFounderTaskArea,
  isFounderTaskPriority,
  isFounderExtractTaskStatus,
  type FounderTaskArea,
  type FounderTaskPriority,
  type FounderExtractTaskStatus,
} from "@/lib/founder/akwasiConstants"

export const runtime = "nodejs"
export const maxDuration = 60

type ExtractedTask = {
  title: string
  description: string | null
  area: FounderTaskArea
  priority: FounderTaskPriority
  status: FounderExtractTaskStatus
  due_date: string | null
}

function normalizeExtractedTask(raw: Record<string, unknown>): ExtractedTask | null {
  const title = String(raw.title ?? "").trim()
  if (!title) return null
  const description =
    raw.description == null ? null : String(raw.description).trim() || null
  const area = isFounderTaskArea(raw.area) ? raw.area : ("product" as FounderTaskArea)
  const priority = isFounderTaskPriority(raw.priority) ? raw.priority : "medium"
  const status = isFounderExtractTaskStatus(raw.status) ? raw.status : "not_started"
  let due_date: string | null = null
  if (raw.due_date != null && raw.due_date !== "") {
    const d = String(raw.due_date).trim().slice(0, 10)
    due_date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
  }
  return { title, description, area, priority, status, due_date }
}

/**
 * POST /api/founder/akwasi/extract-tasks
 * Body: { note_id?: uuid, content?: string } — returns structured tasks JSON only (does not save).
 */
export async function POST(request: NextRequest) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const noteId = typeof body?.note_id === "string" ? body.note_id.trim() : ""
  const rawContent = typeof body?.content === "string" ? body.content : ""

  let text = rawContent.trim()
  if (noteId) {
    const { data: note, error } = await ctx.admin
      .from("founder_notes")
      .select("id,title,content")
      .eq("id", noteId)
      .is("deleted_at", null)
      .maybeSingle()
    if (error) {
      console.error("[extract-tasks] note load", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 })
    }
    text = `Title: ${note.title}\n\n${note.content}`
  }

  if (!text) {
    return NextResponse.json({ error: "note_id or content is required" }, { status: 400 })
  }

  try {
    const rawJson = await akwasiGroqJsonCompletion({
      system: AKWASI_EXTRACT_TASKS_SYSTEM,
      user: `Founder note / text to extract tasks from:\n\n${text}`,
      temperature: 0.2,
    })
    const obj = safeParseJsonObject(rawJson)
    const tasksRaw = obj?.tasks
    const list = Array.isArray(tasksRaw) ? tasksRaw : []
    const tasks: ExtractedTask[] = []
    for (const item of list) {
      if (!item || typeof item !== "object") continue
      const n = normalizeExtractedTask(item as Record<string, unknown>)
      if (n) tasks.push(n)
    }
    return NextResponse.json({ tasks })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI error"
    console.error("[extract-tasks]", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
