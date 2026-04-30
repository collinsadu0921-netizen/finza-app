import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { isFounderTaskArea } from "@/lib/founder/akwasiConstants"

export const runtime = "nodejs"

function parseFilePaths(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === "string" && v.trim()) {
    return v
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * GET /api/founder/akwasi/code-context — list non-deleted rows (newest first).
 * POST — save Cursor / implementation summary.
 */
export async function GET() {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const { data, error } = await ctx.admin
    .from("founder_code_context")
    .select("id,title,summary,related_area,file_paths,source_type,created_at,updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200)

  if (error) {
    console.error("[founder/akwasi/code-context GET]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ items: data ?? [] })
}

export async function POST(request: NextRequest) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const title = String(body?.title ?? "").trim()
  const summary = String(body?.summary ?? "").trim()
  const related_area =
    body?.related_area == null || body?.related_area === ""
      ? null
      : String(body.related_area).trim() || null
  const file_paths = parseFilePaths(body?.file_paths)
  const source_type =
    typeof body?.source_type === "string" && body.source_type.trim()
      ? body.source_type.trim().slice(0, 120)
      : "cursor_summary"

  if (!title || !summary) {
    return NextResponse.json({ error: "title and summary are required" }, { status: 400 })
  }
  if (related_area != null && !isFounderTaskArea(related_area)) {
    return NextResponse.json({ error: "invalid related_area" }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from("founder_code_context")
    .insert({
      title,
      summary,
      related_area,
      file_paths,
      source_type,
    })
    .select("id,title,summary,related_area,file_paths,source_type,created_at,updated_at")
    .single()

  if (error) {
    console.error("[founder/akwasi/code-context POST]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ item: data })
}
