"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { FounderBriefingRow } from "./founderBriefingTypes"
import {
  FOUNDER_TASK_AREAS,
  FOUNDER_TASK_PRIORITIES,
  FOUNDER_TASK_STATUSES,
  type FounderTaskArea,
  type FounderTaskPriority,
  type FounderTaskStatus,
} from "@/lib/founder/akwasiConstants"

type FounderNote = {
  id: string
  title: string
  content: string
  source_type: string | null
  source_date: string | null
  tags: string[] | null
  created_at: string
}

type FounderTask = {
  id: string
  title: string
  description: string | null
  area: FounderTaskArea
  priority: FounderTaskPriority
  status: FounderTaskStatus
  due_date: string | null
  source_note_id: string | null
  created_at: string
}

type ExtractedTask = {
  title: string
  description: string | null
  area: FounderTaskArea
  priority: FounderTaskPriority
  status: "not_started" | "in_progress" | "waiting" | "blocked"
  due_date: string | null
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x)).filter(Boolean)
}

function panelClass() {
  return "rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
}

function labelClass() {
  return "mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400"
}

export default function AkwasiDashboard({
  initialBriefing,
}: {
  initialBriefing: FounderBriefingRow | null
}) {
  const [briefing, setBriefing] = useState<FounderBriefingRow | null>(initialBriefing)
  const [briefingLoading, setBriefingLoading] = useState(false)

  const [notes, setNotes] = useState<FounderNote[]>([])
  const [tasks, setTasks] = useState<FounderTask[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [noteTitle, setNoteTitle] = useState("")
  const [noteContent, setNoteContent] = useState("")
  const [noteSourceType, setNoteSourceType] = useState("")
  const [noteSourceDate, setNoteSourceDate] = useState("")
  const [noteTags, setNoteTags] = useState("")
  const [noteSaving, setNoteSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [lastSavedNoteId, setLastSavedNoteId] = useState<string | null>(null)

  const [extractModal, setExtractModal] = useState<ExtractedTask[] | null>(null)
  const [extractSourceNoteId, setExtractSourceNoteId] = useState<string | null>(null)
  const [selectedExtractIdx, setSelectedExtractIdx] = useState<Set<number>>(() => new Set())

  const [filterStatus, setFilterStatus] = useState<string>("")
  const [filterArea, setFilterArea] = useState<string>("")
  const [filterPriority, setFilterPriority] = useState<string>("")

  const [question, setQuestion] = useState("")
  const [askAnswer, setAskAnswer] = useState<string | null>(null)
  const [askSources, setAskSources] = useState<{ kind: string; label: string; ref: string }[]>([])
  const [askLoading, setAskLoading] = useState(false)

  const reloadLists = useCallback(async () => {
    setError(null)
    setListLoading(true)
    try {
      const [nr, tr] = await Promise.all([
        fetch("/api/founder/akwasi/notes", { credentials: "same-origin" }),
        fetch(
          `/api/founder/akwasi/tasks?${new URLSearchParams({
            ...(filterStatus ? { status: filterStatus } : {}),
            ...(filterArea ? { area: filterArea } : {}),
            ...(filterPriority ? { priority: filterPriority } : {}),
          })}`,
          { credentials: "same-origin" }
        ),
      ])
      if (nr.status === 403 || tr.status === 403) {
        setError("Forbidden")
        return
      }
      if (!nr.ok || !tr.ok) {
        setError("Failed to load notes or tasks")
        return
      }
      const nj = (await nr.json()) as { notes?: FounderNote[] }
      const tj = (await tr.json()) as { tasks?: FounderTask[] }
      setNotes(nj.notes ?? [])
      setTasks(tj.tasks ?? [])
    } catch {
      setError("Network error")
    } finally {
      setListLoading(false)
    }
  }, [filterArea, filterPriority, filterStatus])

  useEffect(() => {
    void reloadLists()
  }, [reloadLists])

  const groupedTasks = useMemo(() => {
    const orderP: FounderTaskPriority[] = ["urgent", "high", "medium", "low"]
    const byP = new Map<string, FounderTask[]>()
    for (const t of tasks) {
      const k = t.priority
      if (!byP.has(k)) byP.set(k, [])
      byP.get(k)!.push(t)
    }
    const out: { priority: FounderTaskPriority; items: FounderTask[] }[] = []
    for (const p of orderP) {
      const items = byP.get(p)
      if (items?.length) out.push({ priority: p, items })
    }
    return out
  }, [tasks])

  const saveNote = async () => {
    setNoteSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/founder/akwasi/notes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: noteTitle,
          content: noteContent,
          source_type: noteSourceType || null,
          source_date: noteSourceDate || null,
          tags: noteTags,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(String((j as { error?: string }).error ?? "Save failed"))
        return
      }
      const j = (await res.json()) as { note?: { id: string } }
      if (j.note?.id) setLastSavedNoteId(j.note.id)
      setNoteTitle("")
      setNoteContent("")
      setNoteSourceType("")
      setNoteSourceDate("")
      setNoteTags("")
      await reloadLists()
    } catch {
      setError("Save failed")
    } finally {
      setNoteSaving(false)
    }
  }

  const runExtract = async (opts: { note_id?: string; content?: string }) => {
    setExtracting(true)
    setError(null)
    try {
      const res = await fetch("/api/founder/akwasi/extract-tasks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String((j as { error?: string }).error ?? "Extract failed"))
        return
      }
      const tasks = (j as { tasks?: ExtractedTask[] }).tasks ?? []
      setExtractModal(tasks)
      setSelectedExtractIdx(new Set(tasks.map((_, i) => i)))
      setExtractSourceNoteId(opts.note_id ?? null)
    } catch {
      setError("Extract failed")
    } finally {
      setExtracting(false)
    }
  }

  const saveSelectedExtracted = async () => {
    if (!extractModal) return
    const noteId = extractSourceNoteId
    for (let i = 0; i < extractModal.length; i++) {
      if (!selectedExtractIdx.has(i)) continue
      const t = extractModal[i]
      const res = await fetch("/api/founder/akwasi/tasks", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t.title,
          description: t.description,
          area: t.area,
          priority: t.priority,
          status: t.status,
          due_date: t.due_date,
          source_note_id: noteId,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(String((j as { error?: string }).error ?? "Task save failed"))
        return
      }
    }
    setExtractModal(null)
    setExtractSourceNoteId(null)
    await reloadLists()
  }

  const generateBriefing = async () => {
    setBriefingLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/founder/akwasi/briefing/generate", {
        method: "POST",
        credentials: "same-origin",
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String((j as { error?: string }).error ?? "Briefing failed"))
        return
      }
      const b = (j as { briefing?: FounderBriefingRow }).briefing
      if (b) setBriefing(b)
    } catch {
      setError("Briefing failed")
    } finally {
      setBriefingLoading(false)
    }
  }

  const patchTaskStatus = async (id: string, status: FounderTaskStatus) => {
    setError(null)
    const res = await fetch(`/api/founder/akwasi/tasks/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(String((j as { error?: string }).error ?? "Update failed"))
      return
    }
    await reloadLists()
  }

  const ask = async () => {
    setAskLoading(true)
    setAskAnswer(null)
    setAskSources([])
    setError(null)
    try {
      const res = await fetch("/api/founder/akwasi/ask", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String((j as { error?: string }).error ?? "Ask failed"))
        return
      }
      setAskAnswer(String((j as { answer?: string }).answer ?? ""))
      setAskSources((j as { sources?: typeof askSources }).sources ?? [])
    } catch {
      setError("Ask failed")
    } finally {
      setAskLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Akwasi</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">Founder AI Chief of Staff for Finza</p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {error}
        </div>
      )}

      <section className={panelClass()}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Founder briefing</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Latest saved briefing (server-loaded on page open).</p>
        <button
          type="button"
          className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          disabled={briefingLoading}
          onClick={() => void generateBriefing()}
        >
          {briefingLoading ? "Generating…" : "Generate Today’s Briefing"}
        </button>
        {briefing ? (
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <p className={labelClass()}>Summary</p>
              <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">{briefing.summary}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className={labelClass()}>Top priorities</p>
                <ul className="list-inside list-disc text-slate-700 dark:text-slate-300">
                  {asStrings(briefing.priorities).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className={labelClass()}>Risks</p>
                <ul className="list-inside list-disc text-slate-700 dark:text-slate-300">
                  {asStrings(briefing.risks).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className={labelClass()}>Blockers</p>
                <ul className="list-inside list-disc text-slate-700 dark:text-slate-300">
                  {asStrings(briefing.blockers).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className={labelClass()}>Recommended actions</p>
                <ul className="list-inside list-disc text-slate-700 dark:text-slate-300">
                  {asStrings(briefing.recommended_actions).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Briefing date {briefing.briefing_date} · {new Date(briefing.created_at).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No briefing yet — generate one.</p>
        )}
      </section>

      <section className={panelClass()}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Add founder note</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass()}>Title</label>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass()}>Content</label>
            <textarea
              className="min-h-[120px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass()}>Source type</label>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={noteSourceType}
              onChange={(e) => setNoteSourceType(e.target.value)}
              placeholder="e.g. meeting, slack, email"
            />
          </div>
          <div>
            <label className={labelClass()}>Source date</label>
            <input
              type="date"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={noteSourceDate}
              onChange={(e) => setNoteSourceDate(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass()}>Tags (comma-separated)</label>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={noteTags}
              onChange={(e) => setNoteTags(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            disabled={noteSaving || !noteTitle.trim() || !noteContent.trim()}
            onClick={() => void saveNote()}
          >
            {noteSaving ? "Saving…" : "Save Note"}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 dark:border-slate-600 dark:text-slate-200"
            disabled={extracting || (!noteContent.trim() && !lastSavedNoteId)}
            onClick={() =>
              void runExtract(
                lastSavedNoteId && !noteContent.trim()
                  ? { note_id: lastSavedNoteId }
                  : { content: noteContent }
              )
            }
          >
            {extracting ? "Extracting…" : "Extract Tasks from Note"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Extract uses the text in Content, or the last saved note if Content is empty and you saved a note this session.
        </p>
        {notes.length > 0 && (
          <div className="mt-6 border-t border-slate-100 pt-4 dark:border-slate-800">
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Recent notes</h3>
            <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-400">
              {notes.slice(0, 8).map((n) => (
                <li key={n.id} className="flex justify-between gap-2">
                  <span className="truncate font-medium text-slate-800 dark:text-slate-200">{n.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {new Date(n.created_at).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className={panelClass()}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Founder tasks</h2>
          <div className="flex flex-wrap gap-2">
            <select
              className="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {FOUNDER_TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={filterArea}
              onChange={(e) => setFilterArea(e.target.value)}
            >
              <option value="">All areas</option>
              {FOUNDER_TASK_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              <option value="">All priorities</option>
              {FOUNDER_TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
        {listLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading…</p>
        ) : groupedTasks.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No tasks match filters.</p>
        ) : (
          <div className="mt-4 space-y-6">
            {groupedTasks.map(({ priority, items }) => (
              <div key={priority}>
                <h3 className="text-sm font-semibold uppercase text-slate-600 dark:text-slate-400">{priority}</h3>
                <ul className="mt-2 space-y-3">
                  {items.map((t) => (
                    <li
                      key={t.id}
                      className="rounded border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/50"
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium text-slate-900 dark:text-slate-100">{t.title}</p>
                          {t.description && (
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t.description}</p>
                          )}
                          <p className="mt-1 text-xs text-slate-500">
                            {t.area} · due {t.due_date ?? "—"}
                          </p>
                        </div>
                        <select
                          className="max-w-[200px] rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
                          value={t.status}
                          onChange={(e) => void patchTaskStatus(t.id, e.target.value as FounderTaskStatus)}
                        >
                          {FOUNDER_TASK_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={panelClass()}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Ask Akwasi</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Answers use only founder notes, tasks, decisions, and briefings — not tenant data.
        </p>
        <textarea
          className="mt-3 min-h-[88px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          placeholder="Your question…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button
          type="button"
          className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          disabled={askLoading || !question.trim()}
          onClick={() => void ask()}
        >
          {askLoading ? "Thinking…" : "Ask Akwasi"}
        </button>
        {askAnswer && (
          <div className="mt-4 rounded border border-slate-100 bg-slate-50 p-3 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200">
            <p className="whitespace-pre-wrap">{askAnswer}</p>
            {askSources.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className={labelClass()}>Context cited</p>
                <ul className="text-xs text-slate-600 dark:text-slate-400">
                  {askSources.map((s, i) => (
                    <li key={i}>
                      [{s.kind}] {s.label}
                      {s.ref ? ` — ${s.ref}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {extractModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl dark:bg-slate-900">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Review extracted tasks</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Nothing is saved until you confirm. Toggle rows off to skip.
            </p>
            <ul className="mt-4 space-y-2">
              {extractModal.map((t, i) => (
                <li key={i} className="flex gap-2 rounded border border-slate-200 p-2 dark:border-slate-700">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedExtractIdx.has(i)}
                    onChange={(e) => {
                      const next = new Set(selectedExtractIdx)
                      if (e.target.checked) next.add(i)
                      else next.delete(i)
                      setSelectedExtractIdx(next)
                    }}
                  />
                  <div className="text-sm">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{t.title}</p>
                    <p className="text-xs text-slate-500">
                      {t.area} · {t.priority} · {t.status}
                      {t.due_date ? ` · due ${t.due_date}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
                onClick={() => {
                  setExtractModal(null)
                  setExtractSourceNoteId(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
                onClick={() => void saveSelectedExtracted()}
              >
                Save selected
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
