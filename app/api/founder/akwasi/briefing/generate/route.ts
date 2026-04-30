import { NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { AKWASI_BRIEFING_SYSTEM } from "@/lib/founder/akwasiPrompts"
import { akwasiGroqJsonCompletion } from "@/lib/founder/akwasiGroqJson"
import { safeParseJsonObject } from "@/lib/founder/akwasiJsonParse"
import { buildAreaOverview } from "@/lib/founder/akwasiAreaOverview"

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

  const [
    { data: openTasks, error: tErr },
    { data: recentNotes, error: nErr },
    { data: decisions, error: dErr },
    { data: priorBriefings, error: pbErr },
  ] = await Promise.all([
    ctx.admin
      .from("founder_tasks")
      .select("id,title,area,priority,status,due_date,description")
      .is("deleted_at", null)
      .neq("status", "completed")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(100),
    ctx.admin
      .from("founder_notes")
      .select("id,title,content,source_type,source_date,tags,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
    ctx.admin
      .from("founder_decisions")
      .select("id,decision,reason,area,status,created_at")
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(40),
    ctx.admin
      .from("founder_briefings")
      .select(
        "id,briefing_date,summary,priorities,risks,blockers,recommended_actions,decision_highlights,area_overview,created_at"
      )
      .order("briefing_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(3),
  ])

  if (tErr || nErr || dErr || pbErr) {
    const err = tErr || nErr || dErr || pbErr
    console.error("[briefing/generate] load", err)
    return NextResponse.json({ error: err?.message ?? "load failed" }, { status: 500 })
  }

  const tasks = openTasks ?? []
  const notes = recentNotes ?? []
  const activeDecisions = decisions ?? []

  const area_overview = buildAreaOverview({
    tasks,
    notes,
    decisions: activeDecisions,
  })

  const area_overview_computed = area_overview

  const contextPayload = {
    previous_briefings: priorBriefings ?? [],
    open_tasks: tasks,
    recent_notes: notes,
    active_decisions: activeDecisions,
    area_overview_computed,
  }

  let summary = "Briefing could not be generated (AI unavailable)."
  let priorities: string[] = []
  let risks: string[] = []
  let blockers: string[] = []
  let recommended_actions: string[] = []
  let decision_highlights: string[] = []

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
      decision_highlights = asStringArray(obj.decision_highlights)
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
      decision_highlights,
      area_overview: area_overview_computed,
      created_by: ctx.user.id,
    })
    .select(
      "id,briefing_date,summary,priorities,risks,blockers,recommended_actions,decision_highlights,area_overview,created_at,created_by"
    )
    .single()

  if (insErr) {
    console.error("[briefing/generate] insert", insErr)
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  return NextResponse.json({ briefing: row })
}
