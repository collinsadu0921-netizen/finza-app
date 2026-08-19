/**
 * GET /api/accounting/work
 *
 * Fast Practice Work index for the active firm.
 * Batch queries only — no per-client authority / readiness / recon / period RPC.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { aggregatePracticeWork } from "@/lib/practice/work/aggregate"
import { filterPracticeWorkItems, sortPracticeWorkItems } from "@/lib/practice/work/filter"
import { partitionFirmEngagements, resolveWorkFirmId } from "@/lib/practice/work/scope"
import type {
  FilingSourceRow,
  JournalSourceRow,
  OpeningBalanceSourceRow,
  PracticeWorkStatusGroup,
  PracticeWorkView,
  RequestSourceRow,
  TaskSourceRow,
} from "@/lib/practice/work/types"

const MAX_LIMIT = 1000

function staffDisplayName(row: { full_name?: string | null; email?: string | null; id: string }): string {
  const name = row.full_name?.trim()
  if (name) return name
  const email = row.email?.trim()
  if (email) return email
  return "Firm user"
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const forbidden = await requireFirmMemberForApi(supabase, user.id)
    if (forbidden) return forbidden

    const params = request.nextUrl.searchParams
    const requestedFirmId = params.get("firm_id")?.trim() || null

    const { data: memberships, error: memberErr } = await supabase
      .from("accounting_firm_users")
      .select("firm_id")
      .eq("user_id", user.id)

    if (memberErr) {
      return NextResponse.json({ error: memberErr.message }, { status: 500 })
    }

    const resolvedFirm = resolveWorkFirmId({
      memberships: memberships ?? [],
      requestedFirmId,
    })
    if (!resolvedFirm.firmId) {
      const status = resolvedFirm.reason === "firm_not_member" ? 403 : 403
      return NextResponse.json(
        {
          error:
            resolvedFirm.reason === "firm_not_member"
              ? "Forbidden. Not a member of the requested firm."
              : "Forbidden. Accounting firm membership required.",
        },
        { status }
      )
    }

    const firmId = resolvedFirm.firmId

    const { data: engagementRows, error: engErr } = await supabase
      .from("firm_client_engagements")
      .select(
        "id, accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to, created_at"
      )
      .eq("accounting_firm_id", firmId)

    if (engErr) {
      return NextResponse.json({ error: engErr.message }, { status: 500 })
    }

    const now = new Date()
    const { effectiveBusinessIds, issues } = partitionFirmEngagements(engagementRows ?? [], now)
    const allClientIds = [
      ...new Set([
        ...effectiveBusinessIds,
        ...issues.map((row) => row.client_business_id),
      ]),
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
        ? supabase.from("businesses").select("id, name").in("id", allClientIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("accounting_firm_users").select("user_id").eq("firm_id", firmId),
      effectiveBusinessIds.length
        ? supabase
            .from("client_tasks")
            .select(
              "id, client_business_id, title, status, priority, assigned_to_user_id, due_at, created_at"
            )
            .eq("firm_id", firmId)
            .in("client_business_id", effectiveBusinessIds)
            .limit(MAX_LIMIT)
        : Promise.resolve({ data: emptySources.tasks, error: null }),
      effectiveBusinessIds.length
        ? supabase
            .from("client_requests")
            .select("id, client_business_id, title, status, due_at, created_at")
            .eq("firm_id", firmId)
            .in("client_business_id", effectiveBusinessIds)
            .limit(MAX_LIMIT)
        : Promise.resolve({ data: emptySources.requests, error: null }),
      effectiveBusinessIds.length
        ? supabase
            .from("client_filings")
            .select("id, client_business_id, filing_type, status, created_at")
            .eq("firm_id", firmId)
            .in("client_business_id", effectiveBusinessIds)
            .limit(MAX_LIMIT)
        : Promise.resolve({ data: emptySources.filings, error: null }),
      effectiveBusinessIds.length
        ? supabase
            .from("manual_journal_drafts")
            .select("id, client_business_id, status, submitted_at, created_at")
            .eq("accounting_firm_id", firmId)
            .in("client_business_id", effectiveBusinessIds)
            .eq("status", "submitted")
            .limit(MAX_LIMIT)
        : Promise.resolve({ data: emptySources.journalsSubmitted, error: null }),
      effectiveBusinessIds.length
        ? supabase
            .from("manual_journal_drafts")
            .select("id, client_business_id, status, approved_at, created_at")
            .eq("accounting_firm_id", firmId)
            .in("client_business_id", effectiveBusinessIds)
            .eq("status", "approved")
            .is("journal_entry_id", null)
            .limit(MAX_LIMIT)
        : Promise.resolve({ data: emptySources.journalsApprovedUnposted, error: null }),
      effectiveBusinessIds.length
        ? supabase
            .from("opening_balance_imports")
            .select("id, client_business_id, status, created_at")
            .eq("accounting_firm_id", firmId)
            .in("client_business_id", effectiveBusinessIds)
            .eq("status", "draft")
            .limit(MAX_LIMIT)
        : Promise.resolve({ data: emptySources.openingBalanceDrafts, error: null }),
      effectiveBusinessIds.length
        ? supabase
            .from("opening_balance_imports")
            .select("id, client_business_id, status, approved_at, created_at")
            .eq("accounting_firm_id", firmId)
            .in("client_business_id", effectiveBusinessIds)
            .eq("status", "approved")
            .is("journal_entry_id", null)
            .limit(MAX_LIMIT)
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
      return NextResponse.json({ error: sourceError.message }, { status: 500 })
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
      ? await supabase.from("users").select("id, email, full_name").in("id", staffIds)
      : { data: [], error: null }

    if (usersRes.error) {
      return NextResponse.json({ error: usersRes.error.message }, { status: 500 })
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

    const viewParam = params.get("view")
    const view: PracticeWorkView =
      viewParam === "my" || viewParam === "unassigned" || viewParam === "all"
        ? viewParam
        : "all"
    const statusGroupParam = params.get("status_group")
    const statusGroup: PracticeWorkStatusGroup | null =
      statusGroupParam === "needs_action" ||
      statusGroupParam === "waiting" ||
      statusGroupParam === "done"
        ? statusGroupParam
        : null
    const dueParam = params.get("due")
    const dueState =
      dueParam === "overdue" ||
      dueParam === "today" ||
      dueParam === "soon" ||
      dueParam === "none"
        ? dueParam
        : null
    const includeDone = params.get("include_done") === "1"

    const filtered = sortPracticeWorkItems(
      filterPracticeWorkItems(items, {
        view,
        currentUserId: user.id,
        clientId: params.get("client") || params.get("business_id"),
        type: params.get("type"),
        statusGroup,
        assignee: params.get("assignee"),
        dueState,
        search: params.get("q"),
        includeDone,
      })
    )

    const counts = {
      all: items.filter((item) => item.status_group !== "done").length,
      my: items.filter(
        (item) => item.status_group !== "done" && item.assigned_user_id === user.id
      ).length,
      unassigned: items.filter(
        (item) => item.status_group !== "done" && !item.assigned_user_id
      ).length,
      waiting: items.filter((item) => item.status_group === "waiting").length,
      needs_action: items.filter((item) => item.status_group === "needs_action").length,
    }

    const clients = allClientIds
      .map((id) => ({ id, name: businessNames[id] ?? "Unknown client" }))
      .sort((a, b) => a.name.localeCompare(b.name))

    return NextResponse.json({
      firm_id: firmId,
      items: filtered,
      staff,
      clients,
      counts,
      architecture: "fast_work_index",
    })
  } catch (err) {
    console.error("GET /api/accounting/work:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
