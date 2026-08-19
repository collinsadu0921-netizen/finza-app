import {
  fromEngagementIssue,
  fromFiling,
  fromJournalApproval,
  fromJournalPost,
  fromOpeningBalanceApproval,
  fromOpeningBalancePost,
  fromRequest,
  fromTask,
} from "./normalize"
import type {
  EngagementIssueRow,
  FilingSourceRow,
  JournalSourceRow,
  OpeningBalanceSourceRow,
  PracticeWorkItem,
  RequestSourceRow,
  TaskSourceRow,
} from "./types"

export type PracticeWorkAggregateInput = {
  tasks: TaskSourceRow[]
  requests: RequestSourceRow[]
  filings: FilingSourceRow[]
  journalsSubmitted: JournalSourceRow[]
  journalsApprovedUnposted: JournalSourceRow[]
  openingBalanceDrafts: OpeningBalanceSourceRow[]
  openingBalanceApprovedUnposted: OpeningBalanceSourceRow[]
  engagementIssues: EngagementIssueRow[]
  businessNames: Record<string, string>
  staffNames: Record<string, string>
  effectiveBusinessIds: Iterable<string>
  now?: Date
}

/**
 * Fast Work index: tasks, requests, filings, journal/OB approvals, engagement issues.
 * Deep client health (period RPC, recon scan, readiness) is intentionally excluded.
 *
 * De-duplication: one item per `${source}:${source_id}`. Approvals are taken only
 * from the underlying journal/OB tables — never also from Control Tower.
 */
export function aggregatePracticeWork(input: PracticeWorkAggregateInput): PracticeWorkItem[] {
  const now = input.now ?? new Date()
  const effective = new Set(input.effectiveBusinessIds)
  const byId = new Map<string, PracticeWorkItem>()

  const push = (item: PracticeWorkItem, requireEffective: boolean) => {
    if (requireEffective && !effective.has(item.business_id)) return
    if (byId.has(item.id)) return
    byId.set(item.id, item)
  }

  for (const row of input.tasks) {
    push(fromTask(row, input.businessNames, input.staffNames, now), true)
  }
  for (const row of input.requests) {
    push(fromRequest(row, input.businessNames, now), true)
  }
  for (const row of input.filings) {
    push(fromFiling(row, input.businessNames, now), true)
  }
  for (const row of input.journalsSubmitted) {
    push(fromJournalApproval(row, input.businessNames, now), true)
  }
  for (const row of input.journalsApprovedUnposted) {
    push(fromJournalPost(row, input.businessNames, now), true)
  }
  for (const row of input.openingBalanceDrafts) {
    push(fromOpeningBalanceApproval(row, input.businessNames, now), true)
  }
  for (const row of input.openingBalanceApprovedUnposted) {
    push(fromOpeningBalancePost(row, input.businessNames, now), true)
  }
  for (const row of input.engagementIssues) {
    push(fromEngagementIssue(row, input.businessNames, now), false)
  }

  return [...byId.values()]
}

export function workItemDedupeKey(item: Pick<PracticeWorkItem, "source" | "source_id">): string {
  return `${item.source}:${item.source_id}`
}
