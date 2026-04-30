import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { isFounderDecisionStatus, isFounderTaskArea } from "@/lib/founder/akwasiConstants"

export const runtime = "nodejs"

/**
 * DELETE /api/founder/akwasi/decisions/[id] — soft delete (sets deleted_at).
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from("founder_decisions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id,decision,reason,area,status,created_at,updated_at,deleted_at")
    .maybeSingle()

  if (error) {
    console.error("[founder/akwasi/decisions DELETE]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Decision not found" }, { status: 404 })
  }

  return NextResponse.json({ decision: data })
}

/**
 * PATCH /api/founder/akwasi/decisions/[id] — update fields or soft-delete.
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
      .from("founder_decisions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id,decision,reason,area,status,created_at,updated_at,deleted_at")
      .maybeSingle()

    if (error) {
      console.error("[founder/akwasi/decisions PATCH soft_delete]", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: "Decision not found" }, { status: 404 })
    }
    return NextResponse.json({ decision: data })
  }

  const patch: Record<string, unknown> = {}

  if (body.decision !== undefined) {
    const d = String(body.decision).trim()
    if (!d) return NextResponse.json({ error: "decision cannot be empty" }, { status: 400 })
    patch.decision = d
  }
  if (body.reason !== undefined) {
    patch.reason =
      body.reason == null || body.reason === "" ? null : String(body.reason).trim() || null
  }
  if (body.area !== undefined) {
    if (!isFounderTaskArea(body.area)) {
      return NextResponse.json({ error: "invalid area" }, { status: 400 })
    }
    patch.area = body.area
  }
  if (body.status !== undefined) {
    if (!isFounderDecisionStatus(body.status)) {
      return NextResponse.json({ error: "invalid status" }, { status: 400 })
    }
    patch.status = body.status
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid fields (use soft_delete: true to archive)" }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from("founder_decisions")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id,decision,reason,area,status,created_at,updated_at")
    .maybeSingle()

  if (error) {
    console.error("[founder/akwasi/decisions PATCH]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: "Decision not found" }, { status: 404 })
  }

  return NextResponse.json({ decision: data })
}
