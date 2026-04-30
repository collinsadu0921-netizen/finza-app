"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { FounderBriefingRow } from "./founderBriefingTypes"
import {
  FOUNDER_TASK_AREAS,
  FOUNDER_TASK_PRIORITIES,
  FOUNDER_TASK_STATUSES,
  FOUNDER_DECISION_STATUSES,
  type FounderTaskArea,
  type FounderTaskPriority,
  type FounderTaskStatus,
  type FounderDecisionStatus,
} from "@/lib/founder/akwasiConstants"
import { buildAreaOverview, areaTagForNote } from "@/lib/founder/akwasiAreaOverview"

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

type FounderDecision = {
  id: string
  decision: string
  reason: string | null
  area: FounderTaskArea
  status: FounderDecisionStatus
  created_at: string
}

type CodeContextItem = {
  id: string
  title: string
  summary: string
  related_area: string | null
  file_paths: string[] | null
  source_type: string
  created_at: string
}

function asStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => String(x)).filter(Boolean)
}

type BriefingAreaOverviewRow = {
  area: string
  open_tasks: number
  blocked_tasks: number
  waiting_tasks: number
  active_decisions: number
  latest_note_title: string | null
  latest_note_date: string | null
}

function asAreaOverviewRows(v: unknown): BriefingAreaOverviewRow[] {
  if (!Array.isArray(v)) return []
  const out: BriefingAreaOverviewRow[] = []
  for (const row of v) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    out.push({
      area: String(r.area ?? ""),
      open_tasks: Number(r.open_tasks ?? 0) || 0,
      blocked_tasks: Number(r.blocked_tasks ?? 0) || 0,
      waiting_tasks: Number(r.waiting_tasks ?? 0) || 0,
      active_decisions: Number(r.active_decisions ?? 0) || 0,
      latest_note_title: r.latest_note_title == null ? null : String(r.latest_note_title),
      latest_note_date: r.latest_note_date == null ? null : String(r.latest_note_date),
    })
  }
  return out
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

  const [decisions, setDecisions] = useState<FounderDecision[]>([])
  const [codeItems, setCodeItems] = useState<CodeContextItem[]>([])
  const [memoryText, setMemoryText] = useState("")
  const [memoryTitle, setMemoryTitle] = useState("")
  const [memoryArea, setMemoryArea] = useState<string>("")
  const [memoryTagsExtra, setMemoryTagsExtra] = useState("")
  const [memorySaving, setMemorySaving] = useState(false)

  const [decisionText, setDecisionText] = useState("")
  const [decisionReason, setDecisionReason] = useState("")
  const [decisionArea, setDecisionArea] = useState<FounderTaskArea>("strategy")
  const [decisionSaving, setDecisionSaving] = useState(false)

  const [codeTitle, setCodeTitle] = useState("")
  const [codeSummary, setCodeSummary] = useState("")
  const [codeRelatedArea, setCodeRelatedArea] = useState<string>("")
  const [codeFilePaths, setCodeFilePaths] = useState("")
  const [codeSaving, setCodeSaving] = useState(false)

  const reloadLists = useCallback(async () => {
    setError(null)
    setListLoading(true)
    try {
      const [nr, tr, dr, cr] = await Promise.all([
        fetch("/api/founder/akwasi/notes", { credentials: "same-origin" }),
        fetch("/api/founder/akwasi/tasks", { credentials: "same-origin" }),
        fetch("/api/founder/akwasi/decisions", { credentials: "same-origin" }),
        fetch("/api/founder/akwasi/code-context", { credentials: "same-origin" }),
      ])
      if ([nr, tr, dr, cr].some((r) => r.status === 403)) {
        setError("Forbidden")
        return
      }
      if (!nr.ok || !tr.ok) {
        setError("Failed to load notes or tasks")
        return
      }
      if (!dr.ok) {
        setError("Failed to load decisions")
        return
      }
      const nj = (await nr.json()) as { notes?: FounderNote[] }
      const tj = (await tr.json()) as { tasks?: FounderTask[] }
      const dj = (await dr.json()) as { decisions?: FounderDecision[] }
      const cj = cr.ok
        ? ((await cr.json()) as { items?: CodeContextItem[] })
        : { items: [] as CodeContextItem[] }
      setNotes(nj.notes ?? [])
      setTasks(tj.tasks ?? [])
      setDecisions(dj.decisions ?? [])
      setCodeItems(cj.items ?? [])
    } catch {
      setError("Network error")
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void reloadLists()
  }, [reloadLists])

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filterStatus && t.status !== filterStatus) return false
      if (filterArea && t.area !== filterArea) return false
      if (filterPriority && t.priority !== filterPriority) return false
      return true
    })
  }, [tasks, filterStatus, filterArea, filterPriority])

  const groupedTasks = useMemo(() => {
    const orderP: FounderTaskPriority[] = ["urgent", "high", "medium", "low"]
    const byP = new Map<string, FounderTask[]>()
    for (const t of filteredTasks) {
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
  }, [filteredTasks])

  const areaOverviewRows = useMemo(() => {
    return buildAreaOverview({
      tasks,
      notes,
      decisions: decisions.filter((d) => d.status === "active"),
    })
  }, [tasks, notes, decisions])

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

  const saveFounderMemory = async () => {
    const content = memoryText.trim()
    if (!content) {
      setError("Paste strategic context first")
      return
    }
    const title =
      memoryTitle.trim() ||
      (content.split("\n").find((l) => l.trim())?.trim().slice(0, 120) || "Founder strategy memory")
    setMemorySaving(true)
    setError(null)
    try {
      const tags = ["founder_memory"]
      if (memoryArea && (FOUNDER_TASK_AREAS as readonly string[]).includes(memoryArea)) {
        tags.push(areaTagForNote(memoryArea as FounderTaskArea))
      }
      if (memoryTagsExtra.trim()) {
        tags.push(
          ...memoryTagsExtra
            .split(/[,]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        )
      }
      const res = await fetch("/api/founder/akwasi/notes", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          source_type: "strategy_note",
          source_date: null,
          tags,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String((j as { error?: string }).error ?? "Save failed"))
        return
      }
      const noteId = (j as { note?: { id: string } }).note?.id
      if (noteId) setLastSavedNoteId(noteId)
      setMemoryText("")
      setMemoryTitle("")
      setMemoryArea("")
      setMemoryTagsExtra("")
      await reloadLists()
    } catch {
      setError("Save failed")
    } finally {
      setMemorySaving(false)
    }
  }

  const saveDecision = async () => {
    const d = decisionText.trim()
    if (!d) {
      setError("Decision text is required")
      return
    }
    setDecisionSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/founder/akwasi/decisions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: d,
          reason: decisionReason.trim() || null,
          area: decisionArea,
          status: "active",
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String((j as { error?: string }).error ?? "Save decision failed"))
        return
      }
      setDecisionText("")
      setDecisionReason("")
      await reloadLists()
    } catch {
      setError("Save decision failed")
    } finally {
      setDecisionSaving(false)
    }
  }

  const patchDecision = async (id: string, patch: Record<string, unknown>) => {
    setError(null)
    const res = await fetch(`/api/founder/akwasi/decisions/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(String((j as { error?: string }).error ?? "Update decision failed"))
      return
    }
    await reloadLists()
  }

  const deleteDecision = async (id: string) => {
    setError(null)
    const res = await fetch(`/api/founder/akwasi/decisions/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(String((j as { error?: string }).error ?? "Delete failed"))
      return
    }
    await reloadLists()
  }

  const softDeleteCodeContext = async (id: string) => {
    setError(null)
    const res = await fetch(`/api/founder/akwasi/code-context/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ soft_delete: true }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(String((j as { error?: string }).error ?? "Remove failed"))
      return
    }
    await reloadLists()
  }

  const saveCodeContext = async () => {
    const title = codeTitle.trim()
    const summary = codeSummary.trim()
    if (!title || !summary) {
      setError("Code summary title and body are required")
      return
    }
    setCodeSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/founder/akwasi/code-context", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          related_area: codeRelatedArea || null,
          file_paths: codeFilePaths,
          source_type: "cursor_summary",
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String((j as { error?: string }).error ?? "Save code context failed"))
        return
      }
      setCodeTitle("")
      setCodeSummary("")
      setCodeRelatedArea("")
      setCodeFilePaths("")
      await reloadLists()
    } catch {
      setError("Save code context failed")
    } finally {
      setCodeSaving(false)
    }
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
            {asStrings(briefing.decision_highlights).length > 0 && (
              <div>
                <p className={labelClass()}>Decisions affecting priorities</p>
                <ul className="list-inside list-disc text-slate-700 dark:text-slate-300">
                  {asStrings(briefing.decision_highlights).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {asAreaOverviewRows(briefing.area_overview).length > 0 && (
              <div>
                <p className={labelClass()}>Area snapshot (at generation time)</p>
                <div className="mt-2 overflow-x-auto text-xs">
                  <table className="w-full border-collapse border border-slate-200 dark:border-slate-700">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800">
                        <th className="border border-slate-200 px-2 py-1 text-left dark:border-slate-700">Area</th>
                        <th className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">Open</th>
                        <th className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">Blocked</th>
                        <th className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">Waiting</th>
                        <th className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">Decisions</th>
                        <th className="border border-slate-200 px-2 py-1 text-left dark:border-slate-700">Latest tagged note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {asAreaOverviewRows(briefing.area_overview).map((row) => (
                        <tr key={row.area}>
                          <td className="border border-slate-200 px-2 py-1 dark:border-slate-700">
                            {row.area.replaceAll("_", " ")}
                          </td>
                          <td className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">
                            {row.open_tasks}
                          </td>
                          <td className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">
                            {row.blocked_tasks}
                          </td>
                          <td className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">
                            {row.waiting_tasks}
                          </td>
                          <td className="border border-slate-200 px-2 py-1 text-right dark:border-slate-700">
                            {row.active_decisions}
                          </td>
                          <td className="border border-slate-200 px-2 py-1 text-slate-600 dark:border-slate-700 dark:text-slate-400">
                            {row.latest_note_title
                              ? `${row.latest_note_title} (${row.latest_note_date ? new Date(row.latest_note_date).toLocaleDateString() : "—"})`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">
              Briefing date {briefing.briefing_date} · {new Date(briefing.created_at).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No briefing yet — generate one.</p>
        )}
      </section>

      <section className={panelClass()}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Project area summary</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          From founder tasks and active decisions. Latest note per area uses tag <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">area:product</code> (set via Founder Memory area picker).
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse border border-slate-200 text-sm dark:border-slate-700">
            <thead>
              <tr className="bg-slate-100 text-left dark:bg-slate-800">
                <th className="border border-slate-200 px-2 py-2 dark:border-slate-700">Area</th>
                <th className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">Open tasks</th>
                <th className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">Blocked</th>
                <th className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">Waiting</th>
                <th className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">Active decisions</th>
                <th className="border border-slate-200 px-2 py-2 dark:border-slate-700">Latest tagged note</th>
              </tr>
            </thead>
            <tbody>
              {areaOverviewRows.map((row) => (
                <tr key={row.area} className="text-slate-800 dark:text-slate-200">
                  <td className="border border-slate-200 px-2 py-2 capitalize dark:border-slate-700">
                    {row.area.replaceAll("_", " ")}
                  </td>
                  <td className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">{row.open_tasks}</td>
                  <td className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">{row.blocked_tasks}</td>
                  <td className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">{row.waiting_tasks}</td>
                  <td className="border border-slate-200 px-2 py-2 text-right dark:border-slate-700">{row.active_decisions}</td>
                  <td className="border border-slate-200 px-2 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
                    {row.latest_note_title ? (
                      <>
                        <span className="font-medium text-slate-800 dark:text-slate-200">{row.latest_note_title}</span>
                        {row.latest_note_date && (
                          <span className="ml-1">· {new Date(row.latest_note_date).toLocaleDateString()}</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={panelClass()}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Founder Memory</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Saves a <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">strategy_note</code> with tag{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">founder_memory</code>. Optional area adds an{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">area:…</code> tag for the area summary. Use{" "}
          <span className="font-medium">Extract Tasks from Note</span> in the general note panel if you want tasks.
        </p>
        <label className={`${labelClass()} mt-3`}>Title</label>
        <input
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          value={memoryTitle}
          onChange={(e) => setMemoryTitle(e.target.value)}
          placeholder="Optional — defaults to first line of context"
        />
        <label className={`${labelClass()} mt-3`}>Strategic context</label>
        <textarea
          className="mt-1 min-h-[140px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          value={memoryText}
          onChange={(e) => setMemoryText(e.target.value)}
          placeholder="Paste strategic context…"
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass()}>Area (optional, for tagged notes)</label>
            <select
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={memoryArea}
              onChange={(e) => setMemoryArea(e.target.value)}
            >
              <option value="">— None —</option>
              {FOUNDER_TASK_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-1">
            <label className={labelClass()}>Extra tags (comma-separated)</label>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={memoryTagsExtra}
              onChange={(e) => setMemoryTagsExtra(e.target.value)}
              placeholder="e.g. launch, partnerships"
            />
          </div>
        </div>
        <div className="mt-3">
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            disabled={memorySaving || !memoryText.trim()}
            onClick={() => void saveFounderMemory()}
          >
            {memorySaving ? "Saving…" : "Save as Founder Memory"}
          </button>
        </div>
      </section>

      <section className={panelClass()}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Founder decisions</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Log calls; status <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800">archived</code> or soft-delete removes from active lists. Superseded keeps history.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass()}>Decision</label>
            <textarea
              className="min-h-[72px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={decisionText}
              onChange={(e) => setDecisionText(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass()}>Reason (optional)</label>
            <textarea
              className="min-h-[56px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass()}>Area</label>
            <select
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={decisionArea}
              onChange={(e) => setDecisionArea(e.target.value as FounderTaskArea)}
            >
              {FOUNDER_TASK_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
              disabled={decisionSaving || !decisionText.trim()}
              onClick={() => void saveDecision()}
            >
              {decisionSaving ? "Saving…" : "Save decision"}
            </button>
          </div>
        </div>
        <div className="mt-6 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">All decisions</h3>
          {decisions.length === 0 ? (
            <p className="text-sm text-slate-500">No decisions yet.</p>
          ) : (
            <ul className="space-y-3">
              {decisions.map((d) => (
                <li
                  key={d.id}
                  className="rounded border border-slate-100 bg-slate-50/80 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <p className="font-medium text-slate-900 dark:text-slate-100">{d.decision}</p>
                  {d.reason && <p className="mt-1 text-slate-600 dark:text-slate-400">{d.reason}</p>}
                  <p className="mt-1 text-xs text-slate-500">
                    {d.area} · {d.status} · {new Date(d.created_at).toLocaleDateString()}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                      value={d.status}
                      onChange={(e) =>
                        void patchDecision(d.id, { status: e.target.value as FounderDecisionStatus })
                      }
                    >
                      {FOUNDER_DECISION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600"
                      onClick={() => void deleteDecision(d.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={panelClass()}>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Code / implementation context</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Save Cursor-style summaries into Akwasi (migration <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">456</code>).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass()}>Title</label>
            <input
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={codeTitle}
              onChange={(e) => setCodeTitle(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass()}>Summary</label>
            <textarea
              className="min-h-[100px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={codeSummary}
              onChange={(e) => setCodeSummary(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass()}>Related area (optional)</label>
            <select
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={codeRelatedArea}
              onChange={(e) => setCodeRelatedArea(e.target.value)}
            >
              <option value="">—</option>
              {FOUNDER_TASK_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass()}>File paths (comma or newline)</label>
            <textarea
              className="min-h-[56px] w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              value={codeFilePaths}
              onChange={(e) => setCodeFilePaths(e.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          className="mt-3 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          disabled={codeSaving || !codeTitle.trim() || !codeSummary.trim()}
          onClick={() => void saveCodeContext()}
        >
          {codeSaving ? "Saving…" : "Save code context"}
        </button>
        {codeItems.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
            {codeItems.slice(0, 12).map((c) => (
              <li key={c.id} className="rounded border border-slate-100 p-2 text-sm dark:border-slate-800">
                <p className="font-medium text-slate-900 dark:text-slate-100">{c.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-600 dark:text-slate-400">{c.summary}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {c.related_area ?? "—"} · {new Date(c.created_at).toLocaleString()}
                </p>
                <button
                  type="button"
                  className="mt-2 text-xs text-red-700 underline dark:text-red-400"
                  onClick={() => void softDeleteCodeContext(c.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
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
          Answers use only founder notes (strategy prioritized), tasks, active decisions, briefings, and code summaries — not tenant data.
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
