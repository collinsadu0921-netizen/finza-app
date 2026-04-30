import {
  FOUNDER_TASK_AREAS,
  type FounderTaskArea,
} from "@/lib/founder/akwasiConstants"

export type FounderTaskLike = {
  area: string
  status: string
}

export type FounderNoteLike = {
  title: string
  created_at: string
  tags?: string[] | null
}

export type FounderDecisionLike = {
  area: string
  status: string
}

const AREA_TAG_PREFIX = "area:"

export function areaTagForNote(area: FounderTaskArea): string {
  return `${AREA_TAG_PREFIX}${area}`
}

export function noteHasAreaTag(note: FounderNoteLike, area: FounderTaskArea): boolean {
  const tags = note.tags ?? []
  return tags.includes(areaTagForNote(area))
}

export type AreaOverviewRow = {
  area: FounderTaskArea
  open_tasks: number
  blocked_tasks: number
  waiting_tasks: number
  active_decisions: number
  latest_note_title: string | null
  latest_note_date: string | null
}

/**
 * Per-area snapshot from founder_tasks, founder_decisions, founder_notes (area tagged via tags contains `area:<area>`).
 */
export function buildAreaOverview(params: {
  tasks: FounderTaskLike[]
  notes: FounderNoteLike[]
  decisions: FounderDecisionLike[]
}): AreaOverviewRow[] {
  const { tasks, notes, decisions } = params
  const openTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled")

  return FOUNDER_TASK_AREAS.map((area) => {
    const inArea = openTasks.filter((t) => t.area === area)
    const open_tasks = inArea.length
    const blocked_tasks = inArea.filter((t) => t.status === "blocked").length
    const waiting_tasks = inArea.filter((t) => t.status === "waiting").length
    const active_decisions = decisions.filter(
      (d) => d.area === area && d.status === "active"
    ).length

    const tagged = notes
      .filter((n) => noteHasAreaTag(n, area))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const latest = tagged[0]
    return {
      area,
      open_tasks,
      blocked_tasks,
      waiting_tasks,
      active_decisions,
      latest_note_title: latest?.title ?? null,
      latest_note_date: latest?.created_at ?? null,
    }
  })
}
