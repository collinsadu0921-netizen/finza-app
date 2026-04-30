import { NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { AKWASI_BRIEFING_SYSTEM } from "@/lib/founder/akwasiPrompts"
import { akwasiGroqJsonCompletion } from "@/lib/founder/akwasiGroqJson"
import { safeParseJsonObject } from "@/lib/founder/akwasiJsonParse"

export const runtime = "nodejs"
export const maxDuration = 90

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x).trim()).filter(Boolean)
}

/**
 * POST /api/founder/akwasi/briefing/generate — builds briefing from founder data, saves row, returns it.
 */
export async function POST() {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const [{ data: openTasks, error: tErr }, { data: recentNotes, error: nErr }, { data: decisions, error: dErr }] =
    await Promise.all([
      ctx.admin
        .from("founder_tasks")
        .select("id,title,area,priority,status,due_date,description")
        .is("deleted_at", null)
        .neq("status", "completed")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(80),
      ctx.admin
        .from("founder_notes")
        .select("id,title,content,source_type,source_date,created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(25),
      ctx.admin
        .from("founder_decisions")
        .select("id,decision,reason,area,status,created_at")
        .is("deleted_at", null)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(30),
    ])

  if (tErr || nErr || dErr) {
    const err = tErr || nErr || dErr
    console.error("[briefing/generate] load", err)
    return NextResponse.json({ error: err?.message ?? "load failed" }, { status: 500 })
  }

  const contextPayload = {
    open_tasks: openTasks ?? [],
    recent_notes: recentNotes ?? [],
    active_decisions: decisions ?? [],
  }

  let summary = "Briefing could not be generated (AI unavailable)."
  let priorities: string[] = []
  let risks: string[] = []
  let blockers: string[] = []
  let recommended_actions: string[] = []

  try {
    const rawJson = await akwasiGroqJsonCompletion({
      system: AKWASI_BRIEFING_SYSTEM,
      user: `Context JSON:\n${JSON.stringify(contextPayload)}`,
      temperature: 0.35,
    })
    const obj = safeParseJsonObject(rawJson)
    if (obj) {
      summary = String(obj.summary ?? summary).trim() || summary
      priorities = asStringArray(obj.priorities)
      risks = asStringArray(obj.risks)
      blockers = asStringArray(obj.blockers)
      recommended_actions = asStringArray(obj.recommended_actions)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI error"
    console.error("[briefing/generate] AI", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const { data: row, error: insErr } = await ctx.admin
    .from("founder_briefings")
    .insert({
      summary,
      priorities,
      risks,
      blockers,
      recommended_actions,
      created_by: ctx.user.id,
    })
    .select(
      "id,briefing_date,summary,priorities,risks,blockers,recommended_actions,created_at,created_by"
    )
    .single()

  if (insErr) {
    console.error("[briefing/generate] insert", insErr)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ briefing: row })
}
