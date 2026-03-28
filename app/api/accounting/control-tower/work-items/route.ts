/**
 * GET /api/accounting/control-tower/work-items
 *
 * Aggregates work items across all effective client engagements for the logged-in firm user.
 * Authority: effective engagements + per-client authority engine. No cookie/session as authority.
 * Sources: manual_journal_drafts, opening_balance_imports, reconciliation mismatches, period close readiness.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/accounting/firm/requireMember"
import { getAccountingAuthority, getEffectiveBusinessIdsForFirmUser } from "@/lib/accounting/authorityEngine"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { buildAccountingRoute } from "@/lib/accounting/routes"
import { evaluateEngagementState } from "@/lib/accounting/evaluateEngagementState"
import type { ControlTowerWorkItem } from "@/lib/accounting/controlTower/types"

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const CONCURRENCY = 8

function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

function agingDays(from: string | null): number {
  if (!from) return 0
  const d = new Date(from)
  const now = new Date()
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000)))
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

    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    )

    // Step A — Authorized client universe (canonical helper)
    const authorizedIds = await getEffectiveBusinessIdsForFirmUser(supabase, user.id)
    if (!authorizedIds.length) {
      return NextResponse.json({ work_items: [] })
    }

    const authMap = new Map<
      string,
      { firmId: string; engagementId: string; level: string }
    >()
    for (const bid of authorizedIds) {
      const auth = await getAccountingAuthority({
        supabase,
        firmUserId: user.id,
        businessId: bid,
        requiredLevel: "read",
      })
      if (auth.allowed && auth.firmId && auth.engagementId && auth.level) {
        authMap.set(bid, {
      firmId: auth.firmId!,
          engagementId: auth.engagementId,
          level: auth.level,
        })
      }
    }

    const activeFirmId = authMap.size > 0 ? authMap.get(authorizedIds[0])!.firmId : null

    const { data: businesses } = await supabase
      .from("businesses")
      .select("id, name")
      .in("id", authorizedIds)
    const nameById = new Map<string, string>(
      (businesses ?? []).map((b) => [b.id, b.name ?? "Unknown"])
    )

    const workItems: ControlTowerWorkItem[] = []

    // Step B–C — Engagement work items: iterate authorized clients, fetch engagements for active firm only
    if (activeFirmId) {
      const { data: engagementRows } = await supabase
        .from("firm_client_engagements")
        .select("id, accounting_firm_id, client_business_id, status, access_level, effective_from, effective_to, accepted_at, accepted_by")
        .eq("accounting_firm_id", activeFirmId)
        .in("client_business_id", authorizedIds)

      type EngagementRow = NonNullable<typeof engagementRows>[number]
      const engagementByClientId = new Map<string, EngagementRow>()
      for (const row of engagementRows ?? []) {
        if (!engagementByClientId.has(row.client_business_id)) {
          engagementByClientId.set(row.client_business_id, row)
        }
      }

      const stateToWorkItemType: Record<string, ControlTowerWorkItem["work_item_type"]> = {
        NO_ENGAGEMENT: "engagement_missing",
        PENDING: "engagement_pending_acceptance",
        SUSPENDED: "engagement_suspended",
        TERMINATED: "engagement_terminated",
        NOT_EFFECTIVE: "engagement_not_effective",
      }
      const stateToSeverity: Record<string, "critical" | "high"> = {
        NO_ENGAGEMENT: "critical",
        PENDING: "critical",
        SUSPENDED: "critical",
        TERMINATED: "high",
        NOT_EFFECTIVE: "high",
      }
      const now = new Date()

      for (const bid of authorizedIds) {
        const engagement = engagementByClientId.get(bid) ?? null
        const evalResult = evaluateEngagementState({
          engagement: engagement
            ? {
                status: engagement.status,
                effective_from: engagement.effective_from,
                effective_to: engagement.effective_to ?? null,
              }
            : null,
          now,
        })
        if (evalResult.state === "ACTIVE") continue
        const workItemType = stateToWorkItemType[evalResult.state]
        if (!workItemType) continue
        workItems.push({
          id: `${workItemType}:${bid}:${engagement?.id ?? "none"}`,
          work_item_type: workItemType,
          business_id: bid,
          client_name: nameById.get(bid) ?? "Unknown",
          severity: stateToSeverity[evalResult.state] ?? "high",
          authority_required: "partner",
          action_required: "review",
          aging_days: 0,
          reference_entity: {
            entity: engagement ? "firm_client_engagement" : "business",
            id: engagement?.id ?? bid,
            meta: {
              status: engagement?.status,
              state: evalResult.state,
              reason_code: evalResult.reason_code,
            },
          },
          drill_route: `/accounting/control-tower?business_id=${encodeURIComponent(bid)}`,
          audit_context: {
            firmId: authMap.get(bid)?.firmId ?? activeFirmId,
            engagementId: engagement?.id ?? "",
            level: "read",
          },
        })
      }
    }

    const firmId = activeFirmId ?? ""

    // Accounting not initialized: for each engaged client with !ready
    for (const bid of authorizedIds) {
      const { ready } = await checkAccountingReadiness(supabase, bid)
      if (!ready) {
        const ctx = authMap.get(bid)
        if (!ctx) continue
        workItems.push({
          id: `accounting_not_initialized:${bid}`,
          work_item_type: "accounting_not_initialized",
          business_id: bid,
          client_name: nameById.get(bid) ?? "Unknown",
          severity: "blocker",
          authority_required: "read",
          action_required: "initialize",
          aging_days: 0,
          reference_entity: { entity: "business", id: bid },
          drill_route: buildAccountingRoute("/accounting", bid),
          audit_context: { firmId: ctx.firmId, engagementId: ctx.engagementId, level: ctx.level },
        })
      }
    }

    // Journal drafts: submitted (approval) and approved + unposted (post)
    const [submittedDrafts, approvedUnpostedDrafts] = await Promise.all([
      supabase
        .from("manual_journal_drafts")
        .select("id, client_business_id, status, submitted_at, created_at")
        .eq("accounting_firm_id", firmId)
        .in("client_business_id", authorizedIds)
        .eq("status", "submitted"),
      supabase
        .from("manual_journal_drafts")
        .select("id, client_business_id, status, approved_at, created_at")
        .eq("accounting_firm_id", firmId)
        .in("client_business_id", authorizedIds)
        .eq("status", "approved")
        .is("journal_entry_id", null),
    ])

    for (const row of submittedDrafts.data ?? []) {
      const ctx = authMap.get(row.client_business_id)
      if (!ctx) continue
      const clientName = nameById.get(row.client_business_id) ?? "Unknown"
      workItems.push({
        id: `journal_approval:${row.client_business_id}:${row.id}`,
        work_item_type: "journal_approval",
        business_id: row.client_business_id,
        client_name: clientName,
        severity: agingDays(row.submitted_at ?? row.created_at) > 7 ? "high" : "medium",
        authority_required: "approve",
        action_required: "approve",
        aging_days: agingDays(row.submitted_at ?? row.created_at),
        reference_entity: { entity: "manual_journal_draft", id: row.id },
        drill_route: buildAccountingRoute(`/accounting/journals/drafts/${row.id}`, row.client_business_id),
        audit_context: { firmId: ctx.firmId, engagementId: ctx.engagementId, level: ctx.level },
      })
    }
    for (const row of approvedUnpostedDrafts.data ?? []) {
      const ctx = authMap.get(row.client_business_id)
      if (!ctx) continue
      const clientName = nameById.get(row.client_business_id) ?? "Unknown"
      workItems.push({
        id: `journal_post:${row.client_business_id}:${row.id}`,
        work_item_type: "journal_post",
        business_id: row.client_business_id,
        client_name: clientName,
        severity: agingDays(row.approved_at ?? row.created_at) > 3 ? "high" : "medium",
        authority_required: "partner",
        action_required: "post",
        aging_days: agingDays(row.approved_at ?? row.created_at),
        reference_entity: { entity: "manual_journal_draft", id: row.id },
        drill_route: buildAccountingRoute(`/accounting/journals/drafts/${row.id}`, row.client_business_id),
        audit_context: { firmId: ctx.firmId, engagementId: ctx.engagementId, level: ctx.level },
      })
    }

    // Opening balance imports: draft = pending approval; approved + no journal_entry_id = unposted
    const [obDrafts, obApprovedUnposted] = await Promise.all([
      supabase
        .from("opening_balance_imports")
        .select("id, client_business_id, created_at")
        .eq("accounting_firm_id", firmId)
        .in("client_business_id", authorizedIds)
        .eq("status", "draft"),
      supabase
        .from("opening_balance_imports")
        .select("id, client_business_id, approved_at, created_at")
        .eq("accounting_firm_id", firmId)
        .in("client_business_id", authorizedIds)
        .eq("status", "approved")
        .is("journal_entry_id", null),
    ])

    for (const row of obDrafts.data ?? []) {
      const ctx = authMap.get(row.client_business_id)
      if (!ctx) continue
      const clientName = nameById.get(row.client_business_id) ?? "Unknown"
      workItems.push({
        id: `ob_approval:${row.client_business_id}:${row.id}`,
        work_item_type: "ob_approval",
        business_id: row.client_business_id,
        client_name: clientName,
        severity: agingDays(row.created_at) > 14 ? "high" : "medium",
        authority_required: "approve",
        action_required: "approve",
        aging_days: agingDays(row.created_at),
        reference_entity: { entity: "opening_balance_import", id: row.id },
        drill_route: buildAccountingRoute(`/accounting/opening-balances-imports/${row.id}`, row.client_business_id),
        audit_context: { firmId: ctx.firmId, engagementId: ctx.engagementId, level: ctx.level },
      })
    }
    for (const row of obApprovedUnposted.data ?? []) {
      const ctx = authMap.get(row.client_business_id)
      if (!ctx) continue
      const clientName = nameById.get(row.client_business_id) ?? "Unknown"
      workItems.push({
        id: `ob_post:${row.client_business_id}:${row.id}`,
        work_item_type: "ob_post",
        business_id: row.client_business_id,
        client_name: clientName,
        severity: agingDays(row.approved_at ?? row.created_at) > 3 ? "high" : "medium",
        authority_required: "partner",
        action_required: "post",
        aging_days: agingDays(row.approved_at ?? row.created_at),
        reference_entity: { entity: "opening_balance_import", id: row.id },
        drill_route: buildAccountingRoute(`/accounting/opening-balances-imports/${row.id}`, row.client_business_id),
        audit_context: { firmId: ctx.firmId, engagementId: ctx.engagementId, level: ctx.level },
      })
    }

    // Period close blockers: current period (open/soft_closed) not ready
    const periodsRes = await supabase
      .from("accounting_periods")
      .select("id, business_id, period_start, status")
      .in("business_id", authorizedIds)
      .in("status", ["open", "soft_closed"])
      .order("period_start", { ascending: false })

    const currentPeriodByBusiness = new Map<string, { id: string; period_start: string }>()
    for (const p of periodsRes.data ?? []) {
      if (!currentPeriodByBusiness.has(p.business_id)) {
        currentPeriodByBusiness.set(p.business_id, {
          id: p.id,
          period_start: p.period_start,
        })
      }
    }

    const readinessCalls = Array.from(currentPeriodByBusiness.entries()).map(
      async ([bid, { period_start }]) => {
        const { data } = await supabase.rpc("check_period_close_readiness", {
          p_business_id: bid,
          p_period_start: period_start,
        })
        return { bid, readiness: data as { status?: string } | null }
      }
    )
    const readinessResults = await Promise.all(readinessCalls)
    for (const { bid, readiness } of readinessResults) {
      if (readiness?.status === "BLOCKED") {
        const ctx = authMap.get(bid)
        if (!ctx) continue
        const curr = currentPeriodByBusiness.get(bid)!
        workItems.push({
          id: `period_blocker:${bid}:${curr.id}`,
          work_item_type: "period_blocker",
          business_id: bid,
          client_name: nameById.get(bid) ?? "Unknown",
          severity: "high",
          authority_required: "partner",
          action_required: "close",
          aging_days: 0,
          reference_entity: { entity: "accounting_period", id: curr.id, meta: { period_start: curr.period_start } },
          drill_route: buildAccountingRoute("/accounting/periods", bid),
          audit_context: { firmId: ctx.firmId, engagementId: ctx.engagementId, level: ctx.level },
        })
      }
    }

    // Reconciliation exceptions: call existing mismatches route per client (concurrency cap)
    const origin = request.nextUrl.origin
    const cookie = request.headers.get("cookie") ?? ""
    const reconPromises = authorizedIds.slice(0, CONCURRENCY * 2).map(async (bid) => {
      try {
        const res = await fetch(
          `${origin}/api/accounting/reconciliation/mismatches?businessId=${encodeURIComponent(bid)}&limit=5`,
          { headers: { cookie } }
        )
        const data = await res.json()
        const count = Array.isArray(data.mismatches) ? data.mismatches.length : 0
        return { bid, count }
      } catch {
        return { bid, count: 0 }
      }
    })
    const reconResults = await Promise.all(reconPromises)
    for (const { bid, count } of reconResults) {
      if (count > 0) {
        const ctx = authMap.get(bid)
        if (!ctx) continue
        workItems.push({
          id: `recon_exception:${bid}:mismatches`,
          work_item_type: "recon_exception",
          business_id: bid,
          client_name: nameById.get(bid) ?? "Unknown",
          severity: count > 5 ? "critical" : "high",
          authority_required: "write",
          action_required: "resolve",
          aging_days: 0,
          reference_entity: { entity: "reconciliation_mismatches", id: bid, meta: { count } },
          drill_route: buildAccountingRoute("/accounting/reconciliation", bid),
          audit_context: { firmId: ctx.firmId, engagementId: ctx.engagementId, level: ctx.level },
        })
      }
    }

    workItems.sort(
      (a, b) =>
        (severityOrder(b.severity) - severityOrder(a.severity)) ||
        b.aging_days - a.aging_days
    )
    const limited = workItems.slice(0, limit)

    return NextResponse.json({ work_items: limited })
  } catch (err) {
    console.error("Control tower work-items error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}

function severityOrder(s: string): number {
  switch (s) {
    case "blocker":
      return 5
    case "critical":
      return 4
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    default:
      return 0
  }
}
