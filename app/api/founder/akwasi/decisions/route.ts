import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { isFounderDecisionStatus, isFounderTaskArea } from "@/lib/founder/akwasiConstants"

export const runtime = "nodejs"

/**
 * GET /api/founder/akwasi/decisions — list non-deleted decisions (newest first).
 * POST /api/founder/akwasi/decisions — create decision.
 */
export async function GET() {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const { data, error } = await ctx.admin
    .from("founder_decisions")
    .select("id,decision,reason,area,status,created_at,updated_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(300)

  if (error) {
    console.error("[founder/akwasi/decisions GET]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ decisions: data ?? [] })
}

export async function POST(request: NextRequest) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const decision = String(body?.decision ?? "").trim()
  const reason =
    body?.reason == null || body?.reason === "" ? null : String(body.reason).trim() || null
  const area = body?.area
  const statusRaw = body?.status
  const status = isFounderDecisionStatus(statusRaw) ? statusRaw : "active"

  if (!decision) {
    return NextResponse.json({ error: "decision is required" }, { status: 400 })
  }
  if (!isFounderTaskArea(area)) {
    return NextResponse.json({ error: "invalid area" }, { status: 400 })
  }

  const { data, error } = await ctx.admin
    .from("founder_decisions")
    .insert({
      decision,
      reason,
      area,
      status,
      created_by: ctx.user.id,
    })
    .select("id,decision,reason,area,status,created_at,updated_at")
    .single()

  if (error) {
    console.error("[founder/akwasi/decisions POST]", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ decision: data })
}
