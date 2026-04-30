import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { isFounderTaskArea } from "@/lib/founder/akwasiConstants"

export const runtime = "nodejs"

function parseFilePaths(v: unknown): string[] | undefined {
  if (v === undefined) return undefined
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
 * PATCH /api/founder/akwasi/code-context/[id] — update or soft-delete.
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

  if (body.soft_delete === true) {
    const { data, error } = await ctx.admin
      .from("founder_code_context")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id,title,summary,related_area,file_paths,source_type,created_at,updated_at,deleted_at")
      .maybeSingle()

    if (error) {
      console.error("[code-context PATCH soft_delete]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ item: data })
  }

  const patch: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const t = String(body.title).trim()
    if (!t) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 })
    patch.title = t
  }
  if (body.summary !== undefined) {
    const s = String(body.summary).trim()
    if (!s) return NextResponse.json({ error: "summary cannot be empty" }, { status: 400 })
    patch.summary = s
  }
  if (body.related_area !== undefined) {
    const ra =
      body.related_area == null || body.related_area === ""
        ? null
        : String(body.related_area).trim() || null
    if (ra != null && !isFounderTaskArea(ra)) {
      return NextResponse.json({ error: "invalid related_area" }, { status: 400 })
    }
    patch.related_area = ra
  }
  if (body.file_paths !== undefined) {
    const fp = parseFilePaths(body.file_paths)
    if (fp !== undefined) patch.file_paths = fp
  }
  if (body.source_type !== undefined && typeof body.source_type === "string") {
    patch.source_type = body.source_type.trim().slice(0, 120) || "cursor_summary"
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid fields" }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from("founder_code_context")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id,title,summary,related_area,file_paths,source_type,created_at,updated_at")
    .maybeSingle()

  if (error) {
    console.error("[code-context PATCH]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ item: data })
}
