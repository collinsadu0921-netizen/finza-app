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

type NoteRow = Record<string, unknown> & { id?: string }

function mergeRelevantNotes(params: {
  strategyFirst: NoteRow[] | null
  keywordNotes: NoteRow[] | null
  recentNotes: NoteRow[] | null
  maxTotal: number
}): NoteRow[] {
  const { strategyFirst, keywordNotes, recentNotes, maxTotal } = params
  const out: NoteRow[] = []
  const seen = new Set<string>()
  const push = (n: NoteRow) => {
    const id = typeof n.id === "string" ? n.id : null
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(n)
  }
  for (const n of strategyFirst ?? []) push(n)
  for (const n of keywordNotes ?? []) push(n)
  for (const n of recentNotes ?? []) push(n)
  return out.slice(0, maxTotal)
}

/**
 * POST /api/founder/akwasi/ask — founder Q&A from founder_* context only.
 * Priority: active decisions → relevant notes → open tasks → latest briefing.
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

  const notesKeywordP =
    tokens.length > 0
      ? ctx.admin
          .from("founder_notes")
          .select("id,title,content,source_type,source_date,tags,created_at")
          .is("deleted_at", null)
          .or(tokens.flatMap((t) => [`title.ilike.%${t}%`, `content.ilike.%${t}%`]).join(","))
          .order("created_at", { ascending: false })
          .limit(28)
      : Promise.resolve({ data: [] as NoteRow[], error: null })

  const [
    { data: decisionsActive, error: dErr },
    { data: notesStrategy, error: nsErr },
    { data: notesRecent, error: nrErr },
    { data: notesKeyword, error: nkErr },
    { data: tasksOpen, error: tErr },
    { data: briefings, error: bErr },
  ] = await Promise.all([
    ctx.admin
      .from("founder_decisions")
      .select("id,decision,reason,area,status,created_at")
      .is("deleted_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50),
    ctx.admin
      .from("founder_notes")
      .select("id,title,content,source_type,source_date,tags,created_at")
      .is("deleted_at", null)
      .eq("source_type", "strategy_note")
      .order("created_at", { ascending: false })
      .limit(25),
    ctx.admin
      .from("founder_notes")
      .select("id,title,content,source_type,source_date,tags,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(35),
    notesKeywordP,
    ctx.admin
      .from("founder_tasks")
      .select("id,title,description,area,priority,status,due_date,created_at,updated_at")
      .is("deleted_at", null)
      .neq("status", "completed")
      .neq("status", "cancelled")
      .order("updated_at", { ascending: false })
      .limit(70),
    ctx.admin
      .from("founder_briefings")
      .select("id,briefing_date,summary,priorities,risks,blockers,recommended_actions,created_at")
      .order("briefing_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1),
  ])

  if (dErr || nsErr || nrErr || nkErr || tErr || bErr) {
    const err = dErr || nsErr || nrErr || nkErr || tErr || bErr
    console.error("[akwasi/ask] load", err)
    return NextResponse.json({ error: err?.message ?? "load failed" }, { status: 500 })
  }

  const relevant_notes = mergeRelevantNotes({
    strategyFirst: (notesStrategy ?? []) as NoteRow[],
    keywordNotes: (notesKeyword ?? []) as NoteRow[],
    recentNotes: (notesRecent ?? []) as NoteRow[],
    maxTotal: 50,
  })

  const latest_briefing =
    briefings && briefings.length > 0 ? (briefings[0] as Record<string, unknown>) : null

  const contextBlocks = {
    active_decisions: decisionsActive ?? [],
    relevant_notes,
    open_tasks: tasksOpen ?? [],
    latest_briefing: latest_briefing,
  }

  const hasAny =
    (contextBlocks.active_decisions?.length ?? 0) > 0 ||
    (contextBlocks.relevant_notes?.length ?? 0) > 0 ||
    (contextBlocks.open_tasks?.length ?? 0) > 0 ||
    latest_briefing != null

  if (!hasAny) {
    return NextResponse.json({
      answer:
        "The information is missing: there are no active founder decisions, relevant notes, open tasks, or a prior briefing in Akwasi yet. Add decisions, founder memory, tasks, or generate a briefing first.",
      sources: [] as SourceRef[],
    })
  }

  try {
    const rawJson = await akwasiGroqJsonCompletion({
      system: AKWASI_ASK_SYSTEM,
      user: `Question:\n${question}\n\nContext JSON (use only this data; follow block priority 1–4):\n${JSON.stringify(contextBlocks)}`,
      temperature: 0.3,
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
