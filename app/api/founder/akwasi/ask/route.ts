import { NextRequest, NextResponse } from "next/server"
import { getFounderAkwasiAuthContext } from "@/lib/founder/founderAkwasiRouteGuards"
import { AKWASI_ASK_SYSTEM } from "@/lib/founder/akwasiPrompts"
import { akwasiGroqJsonCompletion } from "@/lib/founder/akwasiGroqJson"
import { safeParseJsonObject } from "@/lib/founder/akwasiJsonParse"

export const runtime = "nodejs"
export const maxDuration = 90

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && !["the", "and", "for", "with", "from", "that", "this"].includes(s))
    .slice(0, 8)
}

type SourceRef = { kind: string; label: string; ref: string }

/**
 * POST /api/founder/akwasi/ask — founder Q&A from founder_* context only.
 */
export async function POST(request: NextRequest) {
  const ctx = await getFounderAkwasiAuthContext()
  if (!ctx.ok) return ctx.response

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const question = String(body?.question ?? "").trim()
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 })
  }

  const tokens = tokenize(question)

  const notesRecentP = ctx.admin
    .from("founder_notes")
    .select("id,title,content,source_type,source_date,created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(18)

  const notesKeywordP =
    tokens.length > 0
      ? ctx.admin
          .from("founder_notes")
          .select("id,title,content,source_type,source_date,created_at")
          .is("deleted_at", null)
          .or(tokens.flatMap((t) => [`title.ilike.%${t}%`, `content.ilike.%${t}%`]).join(","))
          .order("created_at", { ascending: false })
          .limit(25)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null })

  const [
    { data: notesRecent, error: nRecErr },
    { data: notesKeyword, error: nKeyErr },
    { data: tasksOpen, error: tErr },
    { data: decisions, error: dErr },
    { data: briefings, error: bErr },
  ] = await Promise.all([
    notesRecentP,
    notesKeywordP,
    ctx.admin
      .from("founder_tasks")
      .select("id,title,description,area,priority,status,due_date,created_at")
      .is("deleted_at", null)
      .neq("status", "completed")
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(50),
    ctx.admin
      .from("founder_decisions")
      .select("id,decision,reason,area,status,created_at")
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(25),
    ctx.admin
      .from("founder_briefings")
      .select("id,briefing_date,summary,priorities,risks,blockers,recommended_actions,created_at")
      .order("briefing_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  if (nRecErr || nKeyErr || tErr || dErr || bErr) {
    const err = nRecErr || nKeyErr || tErr || dErr || bErr
    console.error("[akwasi/ask] load", err)
    return NextResponse.json({ error: err?.message ?? "load failed" }, { status: 500 })
  }

  const noteMap = new Map<string, Record<string, unknown>>()
  for (const n of [...(notesRecent ?? []), ...(notesKeyword ?? [])]) {
    if (n && typeof n === "object" && "id" in n && typeof (n as { id: string }).id === "string") {
      noteMap.set((n as { id: string }).id, n as Record<string, unknown>)
    }
  }
  const mergedNotes = [...noteMap.values()].slice(0, 40)

  const contextBlocks = {
    notes: mergedNotes,
    open_tasks: tasksOpen ?? [],
    active_decisions: decisions ?? [],
    recent_briefings: briefings ?? [],
  }

  const hasAny =
    (contextBlocks.notes?.length ?? 0) > 0 ||
    (contextBlocks.open_tasks?.length ?? 0) > 0 ||
    (contextBlocks.active_decisions?.length ?? 0) > 0 ||
    (contextBlocks.recent_briefings?.length ?? 0) > 0

  if (!hasAny) {
    return NextResponse.json({
      answer:
        "There is not enough founder context in Akwasi yet (no notes, open tasks, active decisions, or briefings). Add notes or tasks first, or generate a briefing.",
      sources: [] as SourceRef[],
    })
  }

  try {
    const rawJson = await akwasiGroqJsonCompletion({
      system: AKWASI_ASK_SYSTEM,
      user: `Question:\n${question}\n\nContext JSON:\n${JSON.stringify(contextBlocks)}`,
      temperature: 0.35,
    })
    const obj = safeParseJsonObject(rawJson)
    const answer = String(obj?.answer ?? "").trim()
    const sourcesRaw = obj?.sources
    const sources: SourceRef[] = []
    if (Array.isArray(sourcesRaw)) {
      for (const s of sourcesRaw) {
        if (!s || typeof s !== "object") continue
        const rec = s as Record<string, unknown>
        const kind = String(rec.kind ?? "").trim()
        const label = String(rec.label ?? "").trim()
        const ref = String(rec.ref ?? "").trim()
        if (!kind || !label) continue
        sources.push({ kind, label, ref })
      }
    }
    if (!answer) {
      return NextResponse.json({
        answer: "The model returned an empty answer. Try rephrasing the question.",
        sources,
      })
    }
    return NextResponse.json({ answer, sources })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI error"
    console.error("[akwasi/ask] AI", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
