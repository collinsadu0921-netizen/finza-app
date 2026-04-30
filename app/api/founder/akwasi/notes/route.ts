import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"

export const runtime = "nodejs"

/**
 * GET /api/founder/akwasi/notes — list non-deleted notes (newest first).
 * POST /api/founder/akwasi/notes — create note.
 */
export async function GET() {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const { data, error } = await ctx.admin
    .from("founder_notes")
    .select("id,title,content,source_type,source_date,tags,created_at,updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    console.error("[founder/akwasi/notes GET]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ notes: data ?? [] })
}

export async function POST(request: NextRequest) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const title = String(body?.title ?? "").trim()
  const content = String(body?.content ?? "").trim()
  const source_type =
    body?.source_type == null || body?.source_type === ""
      ? null
      : String(body.source_type).trim() || null
  const source_date =
    body?.source_date == null || body?.source_date === ""
      ? null
      : String(body.source_date).trim().slice(0, 10) || null
  const tagsRaw = body?.tags
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map((t) => String(t).trim()).filter(Boolean)
    : typeof tagsRaw === "string" && tagsRaw.trim()
      ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
      : []

  if (!title || !content) {
    return NextResponse.json({ error: "title and content are required" }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from("founder_notes")
    .insert({
      title,
      content,
      source_type,
      source_date,
      tags,
      created_by: ctx.user.id,
    })
    .select("id,title,content,source_type,source_date,tags,created_at,updated_at")
    .single()

  if (error) {
    console.error("[founder/akwasi/notes POST]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ note: data })
}
