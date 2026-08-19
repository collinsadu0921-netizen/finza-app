/**
 * Normalized Practice Work read model.
 * Source systems remain canonical; this type is display/aggregation only.
 */

export const PRACTICE_WORK_SOURCES = [
  "task",
  "request",
  "filing",
  "journal_approval",
  "journal_post",
  "ob_approval",
  "ob_post",
  "engagement_pending",
  "engagement_suspended",
  "engagement_terminated",
  "engagement_not_effective",
] as const

export type PracticeWorkSource = (typeof PRACTICE_WORK_SOURCES)[number]

export type PracticeWorkStatusGroup = "needs_action" | "waiting" | "done"

export type PracticeWorkUrgency = "overdue" | "today" | "soon" | "later" | "none"

export type PracticeWorkPriority = "low" | "normal" | "high" | "urgent"

export type PracticeWorkView = "my" | "unassigned" | "all"

export type PracticeWorkDueState = PracticeWorkUrgency

export type PracticeWorkItem = {
  id: string
  source: PracticeWorkSource
  source_id: string
  business_id: string
  business_name: string
  type: string
  title: string
  source_status: string
  status_group: PracticeWorkStatusGroup
  priority: PracticeWorkPriority | null
  assigned_user_id: string | null
  assigned_user_name: string | null
  due_at: string | null
  created_at: string
  urgency: PracticeWorkUrgency
  action_url: string
  assignment_supported: boolean
}

export type PracticeWorkStaffMember = {
  user_id: string
  name: string
}

export type TaskSourceRow = {
  id: string
  client_business_id: string
  title: string
  status: string
  priority: string
  assigned_to_user_id: string | null
  due_at: string | null
  created_at: string
}

export type RequestSourceRow = {
  id: string
  client_business_id: string
  title: string
  status: string
  due_at: string | null
  created_at: string
}

export type FilingSourceRow = {
  id: string
  client_business_id: string
  filing_type: string
  status: string
  created_at: string
}

export type JournalSourceRow = {
  id: string
  client_business_id: string
  status: string
  submitted_at?: string | null
  approved_at?: string | null
  created_at: string
}

export type OpeningBalanceSourceRow = {
  id: string
  client_business_id: string
  status: string
  approved_at?: string | null
  created_at: string
}

export type EngagementIssueRow = {
  id: string
  client_business_id: string
  state: "PENDING" | "SUSPENDED" | "TERMINATED" | "NOT_EFFECTIVE"
  status: string
  created_at?: string | null
}

export type PracticeWorkFilters = {
  view: PracticeWorkView
  currentUserId: string
  clientId?: string | null
  type?: string | null
  statusGroup?: PracticeWorkStatusGroup | null
  assignee?: string | null
  dueState?: PracticeWorkDueState | null
  search?: string | null
  includeDone?: boolean
}
