import { buildAccountingRoute } from "@/lib/accounting/routes"
import type {
  EngagementIssueRow,
  FilingSourceRow,
  JournalSourceRow,
  OpeningBalanceSourceRow,
  PracticeWorkItem,
  PracticeWorkPriority,
  PracticeWorkSource,
  PracticeWorkStatusGroup,
  PracticeWorkUrgency,
  RequestSourceRow,
  TaskSourceRow,
} from "./types"

const PRIORITIES = new Set<PracticeWorkPriority>(["low", "normal", "high", "urgent"])

export function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

export function classifyUrgency(dueAt: string | null | undefined, now: Date): PracticeWorkUrgency {
  if (!dueAt) return "none"
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return "none"

  const todayKey = toDateKey(now)
  const dueKey = toDateKey(due)
  if (dueKey < todayKey) return "overdue"
  if (dueKey === todayKey) return "today"

  const horizon = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 7
  ))
  if (dueKey <= toDateKey(horizon)) return "soon"
  return "later"
}

export function workItemId(source: PracticeWorkSource, sourceId: string): string {
  return `${source}:${sourceId}`
}

export function mapTaskStatusGroup(status: string): PracticeWorkStatusGroup {
  if (status === "completed" || status === "cancelled") return "done"
  return "needs_action"
}

export function mapRequestStatusGroup(status: string): PracticeWorkStatusGroup {
  if (status === "waiting_on_client") return "waiting"
  if (status === "completed" || status === "cancelled") return "done"
  return "needs_action"
}

export function mapFilingStatusGroup(status: string): PracticeWorkStatusGroup {
  if (status === "cancelled" || status === "filed" || status === "accepted") return "done"
  return "needs_action"
}

export function mapEngagementStatusGroup(
  state: EngagementIssueRow["state"]
): PracticeWorkStatusGroup {
  return state === "PENDING" ? "waiting" : "needs_action"
}

function staffName(userId: string | null, staffNames: Record<string, string>): string | null {
  if (!userId) return null
  return staffNames[userId] ?? null
}

function clientName(businessId: string, names: Record<string, string>): string {
  return names[businessId] ?? "Unknown client"
}

function realPriority(value: string | null | undefined): PracticeWorkPriority | null {
  if (!value) return null
  return PRIORITIES.has(value as PracticeWorkPriority) ? (value as PracticeWorkPriority) : null
}

export function fromTask(
  row: TaskSourceRow,
  businessNames: Record<string, string>,
  staffNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  return {
    id: workItemId("task", row.id),
    source: "task",
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: "Task",
    title: row.title,
    source_status: row.status,
    status_group: mapTaskStatusGroup(row.status),
    priority: realPriority(row.priority),
    assigned_user_id: row.assigned_to_user_id,
    assigned_user_name: staffName(row.assigned_to_user_id, staffNames),
    due_at: row.due_at,
    created_at: row.created_at,
    urgency: classifyUrgency(row.due_at, now),
    action_url: `/accounting/clients/${row.client_business_id}/tasks`,
    assignment_supported: true,
  }
}

export function fromRequest(
  row: RequestSourceRow,
  businessNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  return {
    id: workItemId("request", row.id),
    source: "request",
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: "Request",
    title: row.title,
    source_status: row.status,
    status_group: mapRequestStatusGroup(row.status),
    priority: null,
    assigned_user_id: null,
    assigned_user_name: null,
    due_at: row.due_at,
    created_at: row.created_at,
    urgency: classifyUrgency(row.due_at, now),
    action_url: `/accounting/clients/${row.client_business_id}/requests`,
    assignment_supported: false,
  }
}

export function fromFiling(
  row: FilingSourceRow,
  businessNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  return {
    id: workItemId("filing", row.id),
    source: "filing",
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: "Filing",
    title: row.filing_type,
    source_status: row.status,
    status_group: mapFilingStatusGroup(row.status),
    priority: null,
    assigned_user_id: null,
    assigned_user_name: null,
    due_at: null,
    created_at: row.created_at,
    urgency: classifyUrgency(null, now),
    action_url: `/accounting/clients/${row.client_business_id}/filings`,
    assignment_supported: false,
  }
}

export function fromJournalApproval(
  row: JournalSourceRow,
  businessNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  return {
    id: workItemId("journal_approval", row.id),
    source: "journal_approval",
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: "Journal approval",
    title: "Journal awaiting approval",
    source_status: row.status,
    status_group: "needs_action",
    priority: null,
    assigned_user_id: null,
    assigned_user_name: null,
    due_at: null,
    created_at: row.submitted_at ?? row.created_at,
    urgency: classifyUrgency(null, now),
    action_url: buildAccountingRoute(`/accounting/journals/drafts/${row.id}`, row.client_business_id),
    assignment_supported: false,
  }
}

export function fromJournalPost(
  row: JournalSourceRow,
  businessNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  return {
    id: workItemId("journal_post", row.id),
    source: "journal_post",
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: "Journal post",
    title: "Approved journal awaiting post",
    source_status: row.status,
    status_group: "needs_action",
    priority: null,
    assigned_user_id: null,
    assigned_user_name: null,
    due_at: null,
    created_at: row.approved_at ?? row.created_at,
    urgency: classifyUrgency(null, now),
    action_url: buildAccountingRoute(`/accounting/journals/drafts/${row.id}`, row.client_business_id),
    assignment_supported: false,
  }
}

export function fromOpeningBalanceApproval(
  row: OpeningBalanceSourceRow,
  businessNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  return {
    id: workItemId("ob_approval", row.id),
    source: "ob_approval",
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: "Opening balance review",
    title: "Opening balance awaiting approval",
    source_status: row.status,
    status_group: "needs_action",
    priority: null,
    assigned_user_id: null,
    assigned_user_name: null,
    due_at: null,
    created_at: row.created_at,
    urgency: classifyUrgency(null, now),
    action_url: buildAccountingRoute(
      `/accounting/opening-balances-imports/${row.id}`,
      row.client_business_id
    ),
    assignment_supported: false,
  }
}

export function fromOpeningBalancePost(
  row: OpeningBalanceSourceRow,
  businessNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  return {
    id: workItemId("ob_post", row.id),
    source: "ob_post",
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: "Opening balance post",
    title: "Approved opening balance awaiting post",
    source_status: row.status,
    status_group: "needs_action",
    priority: null,
    assigned_user_id: null,
    assigned_user_name: null,
    due_at: null,
    created_at: row.approved_at ?? row.created_at,
    urgency: classifyUrgency(null, now),
    action_url: buildAccountingRoute(
      `/accounting/opening-balances-imports/${row.id}`,
      row.client_business_id
    ),
    assignment_supported: false,
  }
}

const ENGAGEMENT_META: Record<
  EngagementIssueRow["state"],
  { source: PracticeWorkSource; type: string; title: string; status: string }
> = {
  PENDING: {
    source: "engagement_pending",
    type: "Engagement",
    title: "Waiting for client owner to accept",
    status: "pending",
  },
  SUSPENDED: {
    source: "engagement_suspended",
    type: "Engagement",
    title: "Engagement suspended",
    status: "suspended",
  },
  TERMINATED: {
    source: "engagement_terminated",
    type: "Engagement",
    title: "Engagement terminated",
    status: "terminated",
  },
  NOT_EFFECTIVE: {
    source: "engagement_not_effective",
    type: "Engagement",
    title: "Engagement not in effective dates",
    status: "not_effective",
  },
}

export function fromEngagementIssue(
  row: EngagementIssueRow,
  businessNames: Record<string, string>,
  now: Date
): PracticeWorkItem {
  const meta = ENGAGEMENT_META[row.state]
  return {
    id: workItemId(meta.source, row.id),
    source: meta.source,
    source_id: row.id,
    business_id: row.client_business_id,
    business_name: clientName(row.client_business_id, businessNames),
    type: meta.type,
    title: meta.title,
    source_status: row.status || meta.status,
    status_group: mapEngagementStatusGroup(row.state),
    priority: null,
    assigned_user_id: null,
    assigned_user_name: null,
    due_at: null,
    created_at: row.created_at ?? now.toISOString(),
    urgency: classifyUrgency(null, now),
    action_url: `/accounting/clients/${row.client_business_id}/overview`,
    assignment_supported: false,
  }
}

export function urgencyLabel(urgency: PracticeWorkUrgency): string {
  switch (urgency) {
    case "overdue":
      return "Overdue"
    case "today":
      return "Due today"
    case "soon":
      return "Due soon"
    case "later":
      return "Upcoming"
    default:
      return "No due date"
  }
}

export function statusGroupLabel(group: PracticeWorkStatusGroup): string {
  switch (group) {
    case "needs_action":
      return "Needs action"
    case "waiting":
      return "Waiting"
    default:
      return "Done"
  }
}
