/**
 * Canonical types for Control Tower (accountant multi-client ops hub).
 * Authority-safe, deterministic work items and client summary.
 */

export type WorkItemType =
  | "journal_approval"
  | "journal_post"
  | "ob_approval"
  | "ob_post"
  | "period_blocker"
  | "recon_exception"
  | "accounting_not_initialized"
  | "engagement_pending_acceptance"
  | "engagement_suspended"
  | "engagement_terminated"
  | "engagement_not_effective"
  | "engagement_missing"

export type WorkItemSeverity = "critical" | "high" | "medium" | "low" | "blocker"

export type AuthorityRequired = "read" | "write" | "approve" | "partner"

export type ActionRequired = "review" | "approve" | "post" | "resolve" | "close" | "initialize"

export interface ControlTowerWorkItem {
  id: string
  work_item_type: WorkItemType
  business_id: string
  client_name: string
  severity: WorkItemSeverity
  authority_required: AuthorityRequired
  action_required: ActionRequired
  aging_days: number
  reference_entity: { entity: string; id: string; meta?: Record<string, unknown> }
  drill_route: string
  audit_context: { firmId: string; engagementId: string; level: string }
}

export interface ControlTowerClientSummary {
  business_id: string
  client_name: string
  engagement: {
    status: string
    access_level: string
    effective_from: string
    effective_to: string | null
  }
  counts: {
    approvals_pending: number
    approved_unposted: number
    ob_pending: number
    ob_unposted: number
    recon_exceptions: number
    period_blockers: number
  }
  periods: {
    current_period_id: string | null
    current_status: string | null
    last_closed_period_id: string | null
  }
  links: {
    ledger: string
    journals: string
    openingBalances: string
    reconciliation: string
    periods: string
    reports: string
  }
}
