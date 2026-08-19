import type { PracticeWorkFilters, PracticeWorkItem } from "./types"

function matchesSearch(item: PracticeWorkItem, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return (
    item.business_name.toLowerCase().includes(q) ||
    item.title.toLowerCase().includes(q)
  )
}

export function filterPracticeWorkItems(
  items: PracticeWorkItem[],
  filters: PracticeWorkFilters
): PracticeWorkItem[] {
  const includeDone = Boolean(filters.includeDone)
  const search = filters.search?.trim() ?? ""

  return items.filter((item) => {
    if (!includeDone && item.status_group === "done") return false

    if (filters.view === "my") {
      if (item.assigned_user_id !== filters.currentUserId) return false
    } else if (filters.view === "unassigned") {
      if (item.assigned_user_id) return false
    }

    if (filters.clientId && item.business_id !== filters.clientId) return false
    if (filters.type && item.source !== filters.type && item.type !== filters.type) return false
    if (filters.statusGroup && item.status_group !== filters.statusGroup) return false

    if (filters.assignee) {
      if (filters.assignee === "unassigned") {
        if (item.assigned_user_id) return false
      } else if (item.assigned_user_id !== filters.assignee) {
        return false
      }
    }

    if (filters.dueState && item.urgency !== filters.dueState) return false
    if (search && !matchesSearch(item, search)) return false

    return true
  })
}

const URGENCY_RANK: Record<PracticeWorkItem["urgency"], number> = {
  overdue: 0,
  today: 1,
  soon: 2,
  later: 3,
  none: 4,
}

const GROUP_RANK: Record<PracticeWorkItem["status_group"], number> = {
  needs_action: 0,
  waiting: 1,
  done: 2,
}

export function sortPracticeWorkItems(items: PracticeWorkItem[]): PracticeWorkItem[] {
  return [...items].sort((a, b) => {
    const group = GROUP_RANK[a.status_group] - GROUP_RANK[b.status_group]
    if (group !== 0) return group
    const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (urgency !== 0) return urgency
    if (a.due_at && b.due_at && a.due_at !== b.due_at) {
      return a.due_at.localeCompare(b.due_at)
    }
    if (a.due_at && !b.due_at) return -1
    if (!a.due_at && b.due_at) return 1
    const name = a.business_name.localeCompare(b.business_name)
    if (name !== 0) return name
    return a.created_at.localeCompare(b.created_at)
  })
}
