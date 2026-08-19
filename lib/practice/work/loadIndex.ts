/**
 * Shared Practice Work index loader.
 * Used by /api/accounting/work and the Practice dashboard.
 * Batch queries only — no per-client authority / readiness / recon / period RPC.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { resolveActivePracticeFirmScope } from "@/lib/practice/assignment/activeFirm"
import { hasPortfolioWideVisibility } from "@/lib/practice/assignment/policy"
import type { FirmUserClientScope } from "@/lib/practice/assignment/scope"
import { aggregatePracticeWork } from "./aggregate"
import { partitionFirmEngagements } from "./scope"
import type {
  FilingSourceRow,
  JournalSourceRow,
  OpeningBalanceSourceRow,
  PracticeWorkItem,
  PracticeWorkStaffMember,
  RequestSourceRow,
  TaskSourceRow,
} from "./types"

export const PRACTICE_WORK_SOURCE_LIMIT = 1000

export function staffDisplayName(row: {
  full_name?: string | null
  email?: string | null
  id: string
}): string {
  const name = row.full_name?.trim()
  if (name) return name
  const email = row.email?.trim()
  if (email) return email
  return "Firm user"
}

export type PracticeWorkIndexOk = {
  ok: true
  firmId: string
  scope: FirmUserClientScope
  items: PracticeWorkItem[]
  staff: PracticeWorkStaffMember[]
  clients: { id: string; name: string }[]
}

export type PracticeWorkIndexErr = {
  ok: false
  status: 403 | 500
  error: string
}

export type PracticeWorkIndexResult = PracticeWorkIndexOk | PracticeWorkIndexErr

export async function loadPracticeWorkIndex(opts: {
  supabase: SupabaseClient
  userId: string
  requestedFirmId?: string | null
  now?: Date
}): Promise<PracticeWorkIndexResult> {
  const now = opts.now ?? new Date()
  const resolved = await resolveActivePracticeFirmScope({
    supabase: opts.supabase,
    userId: opts.userId,
    requestedFirmId: opts.requestedFirmId,
    now,
  })
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error }
  }

  const firmId = resolved.firmId
  const scope = resolved.scope

  const { data: engagementRows, error: engErr } = await opts.supabase
    .from("firm_client_engagements")
    .select(
      "id, accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to, created_at"
    )
    .eq("accounting_firm_id", firmId)

  if (engErr) {
    return { ok: false, status: 500, error: engErr.message }
  }

  const { issues: allIssues } = partitionFirmEngagements(engagementRows ?? [], now)
  const effectiveBusinessIds = scope.authorizedBusinessIds
  const issues = hasPortfolioWideVisibility(scope.role)
    ? allIssues
    : allIssues.filter((row) => scope.assignedBusinessIds.includes(row.client_business_id))
  const allClientIds = [
    ...new Set([...effectiveBusinessIds, ...issues.map((row) => row.client_business_id)]),
  ]

  const emptySources = {
    tasks: [] as TaskSourceRow[],
    requests: [] as RequestSourceRow[],
    filings: [] as FilingSourceRow[],
    journalsSubmitted: [] as JournalSourceRow[],
    journalsApprovedUnposted: [] as JournalSourceRow[],
    openingBalanceDrafts: [] as OpeningBalanceSourceRow[],
    openingBalanceApprovedUnposted: [] as OpeningBalanceSourceRow[],
  }

  const [
    businessesRes,
    firmUsersRes,
    tasksRes,
    requestsRes,
    filingsRes,
    journalsSubmittedRes,
    journalsApprovedRes,
    obDraftsRes,
    obApprovedRes,
  ] = await Promise.all([
    allClientIds.length
      ? opts.supabase.from("businesses").select("id, name").in("id", allClientIds)
      : Promise.resolve({ data: [], error: null }),
    opts.supabase.from("accounting_firm_users").select("user_id").eq("firm_id", firmId),
    effectiveBusinessIds.length
      ? opts.supabase
          .from("client_tasks")
          .select("id, client_business_id, title, status, priority, assigned_to_user_id, due_at, created_at")
          .eq("firm_id", firmId)
          .in("client_business_id", effectiveBusinessIds)
          .limit(PRACTICE_WORK_SOURCE_LIMIT)
      : Promise.resolve({ data: emptySources.tasks, error: null }),
    effectiveBusinessIds.length
      ? opts.supabase
          .from("client_requests")
          .select("id, client_business_id, title, status, due_at, created_at")
          .eq("firm_id", firmId)
          .in("client_business_id", effectiveBusinessIds)
          .limit(PRACTICE_WORK_SOURCE_LIMIT)
      : Promise.resolve({ data: emptySources.requests, error: null }),
    effectiveBusinessIds.length
      ? opts.supabase
          .from("client_filings")
          .select("id, client_business_id, filing_type, status, created_at")
          .eq("firm_id", firmId)
          .in("client_business_id", effectiveBusinessIds)
          .limit(PRACTICE_WORK_SOURCE_LIMIT)
      : Promise.resolve({ data: emptySources.filings, error: null }),
    effectiveBusinessIds.length
      ? opts.supabase
          .from("manual_journal_drafts")
          .select("id, client_business_id, status, submitted_at, created_at")
          .eq("accounting_firm_id", firmId)
          .in("client_business_id", effectiveBusinessIds)
          .eq("status", "submitted")
          .limit(PRACTICE_WORK_SOURCE_LIMIT)
      : Promise.resolve({ data: emptySources.journalsSubmitted, error: null }),
    effectiveBusinessIds.length
      ? opts.supabase
          .from("manual_journal_drafts")
          .select("id, client_business_id, status, approved_at, created_at")
          .eq("accounting_firm_id", firmId)
          .in("client_business_id", effectiveBusinessIds)
          .eq("status", "approved")
          .is("journal_entry_id", null)
          .limit(PRACTICE_WORK_SOURCE_LIMIT)
      : Promise.resolve({ data: emptySources.journalsApprovedUnposted, error: null }),
    effectiveBusinessIds.length
      ? opts.supabase
          .from("opening_balance_imports")
          .select("id, client_business_id, status, created_at")
          .eq("accounting_firm_id", firmId)
          .in("client_business_id", effectiveBusinessIds)
          .eq("status", "draft")
          .limit(PRACTICE_WORK_SOURCE_LIMIT)
      : Promise.resolve({ data: emptySources.openingBalanceDrafts, error: null }),
    effectiveBusinessIds.length
      ? opts.supabase
          .from("opening_balance_imports")
          .select("id, client_business_id, status, approved_at, created_at")
          .eq("accounting_firm_id", firmId)
          .in("client_business_id", effectiveBusinessIds)
          .eq("status", "approved")
          .is("journal_entry_id", null)
          .limit(PRACTICE_WORK_SOURCE_LIMIT)
      : Promise.resolve({ data: emptySources.openingBalanceApprovedUnposted, error: null }),
  ])

  const sourceError =
    businessesRes.error ||
    firmUsersRes.error ||
    tasksRes.error ||
    requestsRes.error ||
    filingsRes.error ||
    journalsSubmittedRes.error ||
    journalsApprovedRes.error ||
    obDraftsRes.error ||
    obApprovedRes.error
  if (sourceError) {
    return { ok: false, status: 500, error: sourceError.message }
  }

  const assignedIds = (tasksRes.data ?? [])
    .map((row) => row.assigned_to_user_id)
    .filter((id): id is string => Boolean(id))
  const staffIds = [
    ...new Set([
      ...(firmUsersRes.data ?? []).map((row) => row.user_id as string),
      ...assignedIds,
    ]),
  ].filter(Boolean)

  const usersRes = staffIds.length
    ? await opts.supabase.from("users").select("id, email, full_name").in("id", staffIds)
    : { data: [], error: null }

  if (usersRes.error) {
    return { ok: false, status: 500, error: usersRes.error.message }
  }

  const businessNames: Record<string, string> = {}
  for (const row of businessesRes.data ?? []) {
    businessNames[row.id] = row.name ?? "Unknown client"
  }

  const staffNames: Record<string, string> = {}
  for (const row of usersRes.data ?? []) {
    staffNames[row.id] = staffDisplayName(row)
  }

  const staff = (firmUsersRes.data ?? [])
    .map((row) => {
      const userId = row.user_id as string
      return { user_id: userId, name: staffNames[userId] ?? "Firm user" }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const items = aggregatePracticeWork({
    tasks: (tasksRes.data ?? []) as TaskSourceRow[],
    requests: (requestsRes.data ?? []) as RequestSourceRow[],
    filings: (filingsRes.data ?? []) as FilingSourceRow[],
    journalsSubmitted: (journalsSubmittedRes.data ?? []) as JournalSourceRow[],
    journalsApprovedUnposted: (journalsApprovedRes.data ?? []) as JournalSourceRow[],
    openingBalanceDrafts: (obDraftsRes.data ?? []) as OpeningBalanceSourceRow[],
    openingBalanceApprovedUnposted: (obApprovedRes.data ?? []) as OpeningBalanceSourceRow[],
    engagementIssues: issues,
    businessNames,
    staffNames,
    effectiveBusinessIds,
    now,
  })

  const clients = allClientIds
    .map((id) => ({ id, name: businessNames[id] ?? "Unknown client" }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return {
    ok: true,
    firmId,
    scope,
    items,
    staff,
    clients,
  }
}
