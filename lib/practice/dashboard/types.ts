import type { PracticeFirmRole } from "@/lib/practice/assignment/policy"
import type { PracticeWorkItem } from "@/lib/practice/work/types"

export const PRACTICE_REVIEW_SOURCES = [
  "journal_approval",
  "journal_post",
  "ob_approval",
  "ob_post",
] as const

export type PracticeDashboardSummary = {
  clients: number
  open_work: number
  overdue: number
  waiting_on_client: number
  due_today: number
  unassigned: number
  my_work: number
}

export type PracticeDashboardTeamRow = {
  user_id: string
  name: string
  role: PracticeFirmRole
  assigned_clients: number
  open_work: number
  overdue: number
  due_soon: number
  waiting: number
}

export type PracticeDashboardUnassigned = {
  open_work: number
  overdue: number
  assignable: number
  without_owner: number
  items: PracticeWorkItem[]
}

export type PracticeDashboardClientRisk = {
  business_id: string
  business_name: string
  overdue: number
  due_today: number
  due_soon: number
  waiting_on_client: number
  unassigned: number
  open_work: number
}

export type PracticeDashboardCoverage =
  | {
      enforcement_active: true
      effective_clients: number
      with_staff: number
      without_staff: number
    }
  | { enforcement_active: false }

export type PracticeDashboardStaffMember = {
  user_id: string
  name: string
  role: PracticeFirmRole
}

export type PracticeDashboardAssignment = {
  user_id: string
  client_business_id: string
}

export type PracticeDashboardShow = {
  team: boolean
  coverage: boolean
  unassigned: boolean
  review: boolean
}

export type PracticeDashboard = {
  firm_id: string
  firm_name: string | null
  role: PracticeFirmRole
  enforcement_active: boolean
  current_user_id: string
  summary: PracticeDashboardSummary
  team: PracticeDashboardTeamRow[]
  unassigned: PracticeDashboardUnassigned
  clients_at_risk: PracticeDashboardClientRisk[]
  needs_attention: PracticeWorkItem[]
  waiting_on_client: {
    items: PracticeWorkItem[]
    waiting_duration_available: false
  }
  review: {
    count: number
    items: PracticeWorkItem[]
  }
  coverage: PracticeDashboardCoverage
  show: PracticeDashboardShow
}

export type PracticeDashboardDeriveInput = {
  firmId: string
  role: PracticeFirmRole
  currentUserId: string
  enforcementActive: boolean
  authorizedBusinessIds: readonly string[]
  effectiveBusinessIds: readonly string[]
  clients: readonly { id: string; name: string }[]
  staff: readonly PracticeDashboardStaffMember[]
  assignments: readonly PracticeDashboardAssignment[]
  items: readonly PracticeWorkItem[]
}
