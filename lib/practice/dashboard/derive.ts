import { hasPortfolioWideVisibility, type PracticeFirmRole } from "@/lib/practice/assignment/policy"
import { sortPracticeWorkItems } from "@/lib/practice/work/filter"
import type { PracticeWorkItem } from "@/lib/practice/work/types"
import {
  PRACTICE_REVIEW_SOURCES,
  type PracticeDashboard,
  type PracticeDashboardClientRisk,
  type PracticeDashboardDeriveInput,
  type PracticeDashboardTeamRow,
} from "./types"

const REVIEW_SOURCE_SET = new Set<string>(PRACTICE_REVIEW_SOURCES)

const NEEDS_ATTENTION_LIMIT = 8
const WAITING_LIMIT = 8
const REVIEW_LIMIT = 5
const UNASSIGNED_LIMIT = 6
const CLIENT_RISK_LIMIT = 8

export function isDashboardActiveWork(item: PracticeWorkItem): boolean {
  return item.status_group !== "done"
}

export function isWaitingOnClient(item: PracticeWorkItem): boolean {
  return item.source === "request" && item.source_status === "waiting_on_client"
}

export function isReviewWork(item: PracticeWorkItem): boolean {
  return REVIEW_SOURCE_SET.has(item.source)
}

function inAuthorizedScope(
  item: PracticeWorkItem,
  authorized: Set<string>
): boolean {
  return authorized.has(item.business_id)
}

function clientName(
  businessId: string,
  names: Map<string, string>,
  fallback?: string
): string {
  return names.get(businessId) ?? fallback ?? "Unknown client"
}

/**
 * Portfolio summaries from one Work index + assignment rows.
 * Does not invent utilization, hours, or waiting duration.
 */
export function derivePracticeDashboard(input: PracticeDashboardDeriveInput): PracticeDashboard {
  const authorized = new Set(input.authorizedBusinessIds)
  const effective = new Set(input.effectiveBusinessIds)
  const names = new Map(input.clients.map((c) => [c.id, c.name]))
  for (const item of input.items) {
    if (!names.has(item.business_id)) names.set(item.business_id, item.business_name)
  }

  const scopedActive = input.items.filter(
    (item) => inAuthorizedScope(item, authorized) && isDashboardActiveWork(item)
  )

  const overdueItems = scopedActive.filter((item) => item.urgency === "overdue")
  const dueTodayItems = scopedActive.filter((item) => item.urgency === "today")
  const waitingItems = scopedActive.filter(isWaitingOnClient)
  const unassignedItems = scopedActive.filter((item) => !item.assigned_user_id)
  const myWorkItems = scopedActive.filter((item) => item.assigned_user_id === input.currentUserId)
  const reviewItems = scopedActive.filter(isReviewWork)

  const needsAttention = sortPracticeWorkItems(scopedActive).slice(0, NEEDS_ATTENTION_LIMIT)
  const waitingSorted = sortPracticeWorkItems(waitingItems).slice(0, WAITING_LIMIT)
  const reviewSorted = sortPracticeWorkItems(reviewItems).slice(0, REVIEW_LIMIT)
  const unassignedSorted = sortPracticeWorkItems(unassignedItems).slice(0, UNASSIGNED_LIMIT)

  const partnerView = hasPortfolioWideVisibility(input.role)
  const reviewer = input.role === "partner" || input.role === "senior"

  const team = partnerView
    ? buildTeamRows(input.staff, input.assignments, scopedActive, effective)
    : []

  return {
    firm_id: input.firmId,
    role: input.role,
    enforcement_active: input.enforcementActive,
    current_user_id: input.currentUserId,
    summary: {
      clients: input.authorizedBusinessIds.length,
      open_work: scopedActive.length,
      overdue: overdueItems.length,
      waiting_on_client: waitingItems.length,
      due_today: dueTodayItems.length,
      unassigned: unassignedItems.length,
      my_work: myWorkItems.length,
    },
    team,
    unassigned: {
      open_work: unassignedItems.length,
      overdue: unassignedItems.filter((item) => item.urgency === "overdue").length,
      assignable: unassignedItems.filter((item) => item.assignment_supported).length,
      without_owner: unassignedItems.filter((item) => !item.assignment_supported).length,
      items: unassignedSorted,
    },
    clients_at_risk: buildClientRisk(scopedActive, names).slice(0, CLIENT_RISK_LIMIT),
    needs_attention: needsAttention,
    waiting_on_client: {
      items: waitingSorted,
      waiting_duration_available: false,
    },
    review: {
      count: reviewItems.length,
      items: reviewSorted,
    },
    coverage: input.enforcementActive
      ? buildCoverage(input.effectiveBusinessIds, input.assignments)
      : { enforcement_active: false },
    show: {
      team: partnerView,
      coverage: partnerView,
      unassigned: partnerView,
      review: reviewer,
    },
  }
}

function buildTeamRows(
  staff: PracticeDashboardDeriveInput["staff"],
  assignments: PracticeDashboardDeriveInput["assignments"],
  scopedActive: PracticeWorkItem[],
  effective: Set<string>
): PracticeDashboardTeamRow[] {
  const assignedClients = new Map<string, Set<string>>()
  for (const row of assignments) {
    if (!effective.has(row.client_business_id)) continue
    const set = assignedClients.get(row.user_id) ?? new Set<string>()
    set.add(row.client_business_id)
    assignedClients.set(row.user_id, set)
  }

  const byStaff = new Map<string, PracticeWorkItem[]>()
  for (const item of scopedActive) {
    if (!item.assigned_user_id) continue
    const list = byStaff.get(item.assigned_user_id) ?? []
    list.push(item)
    byStaff.set(item.assigned_user_id, list)
  }

  return [...staff]
    .map((member) => {
      const work = byStaff.get(member.user_id) ?? []
      return {
        user_id: member.user_id,
        name: member.name,
        role: member.role,
        assigned_clients: assignedClients.get(member.user_id)?.size ?? 0,
        open_work: work.length,
        overdue: work.filter((item) => item.urgency === "overdue").length,
        due_soon: work.filter((item) => item.urgency === "today" || item.urgency === "soon").length,
        waiting: work.filter(isWaitingOnClient).length,
      }
    })
    .sort((a, b) => {
      if (b.open_work !== a.open_work) return b.open_work - a.open_work
      if (b.overdue !== a.overdue) return b.overdue - a.overdue
      return a.name.localeCompare(b.name)
    })
}

function buildClientRisk(
  scopedActive: PracticeWorkItem[],
  names: Map<string, string>
): PracticeDashboardClientRisk[] {
  const byClient = new Map<string, PracticeWorkItem[]>()
  for (const item of scopedActive) {
    const list = byClient.get(item.business_id) ?? []
    list.push(item)
    byClient.set(item.business_id, list)
  }

  return [...byClient.entries()]
    .map(([business_id, items]) => ({
      business_id,
      business_name: clientName(business_id, names, items[0]?.business_name),
      overdue: items.filter((item) => item.urgency === "overdue").length,
      due_today: items.filter((item) => item.urgency === "today").length,
      due_soon: items.filter((item) => item.urgency === "soon").length,
      waiting_on_client: items.filter(isWaitingOnClient).length,
      unassigned: items.filter((item) => !item.assigned_user_id).length,
      open_work: items.length,
    }))
    .sort((a, b) => {
      if (b.overdue !== a.overdue) return b.overdue - a.overdue
      if (b.due_today !== a.due_today) return b.due_today - a.due_today
      if (b.open_work !== a.open_work) return b.open_work - a.open_work
      return a.business_name.localeCompare(b.business_name)
    })
}

function buildCoverage(
  effectiveBusinessIds: readonly string[],
  assignments: PracticeDashboardDeriveInput["assignments"]
): Extract<PracticeDashboard["coverage"], { enforcement_active: true }> {
  const effective = new Set(effectiveBusinessIds)
  const covered = new Set<string>()
  for (const row of assignments) {
    if (effective.has(row.client_business_id)) covered.add(row.client_business_id)
  }
  return {
    enforcement_active: true,
    effective_clients: effective.size,
    with_staff: covered.size,
    without_staff: Math.max(0, effective.size - covered.size),
  }
}

export function canShowPartnerPanels(role: PracticeFirmRole): boolean {
  return hasPortfolioWideVisibility(role)
}
