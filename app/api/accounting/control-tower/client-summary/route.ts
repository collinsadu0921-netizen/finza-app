/**
 * GET /api/accounting/control-tower/client-summary?business_id=...
 *
 * Client command center summary for one client. Authority: getAccountingAuthority requiredLevel read.
 * Returns 403 with reason if denied.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { requireFirmMemberForApi } from "@/lib/requireFirmMember"
import { getAccountingAuthority } from "@/lib/accountingAuthorityEngine"
import type { ControlTowerClientSummary } from "@/lib/controlTower/types"

function qs(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
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

    const business_id = request.nextUrl.searchParams.get("business_id")
    if (!business_id?.trim()) {
      return NextResponse.json(
        { error: "MISSING_BUSINESS_ID" },
        { status: 400 }
      )
    }

    const auth = await getAccountingAuthority({
      supabase,
      firmUserId: user.id,
      businessId: business_id,
      requiredLevel: "read",
    })

    if (!auth.allowed) {
      return NextResponse.json(
        { error: "FORBIDDEN", reason: auth.reason },
        { status: 403 }
      )
    }

    const firmId = auth.firmId!
    const engagementId = auth.engagementId!

    const { data: business } = await supabase
      .from("businesses")
      .select("id, name")
      .eq("id", business_id)
      .maybeSingle()

    const { data: engagementRow } = await supabase
      .from("firm_client_engagements")
      .select("id, status, access_level, effective_from, effective_to")
      .eq("id", engagementId)
      .eq("client_business_id", business_id)
      .eq("accounting_firm_id", firmId)
      .maybeSingle()

    const [
      journalSubmitted,
      journalApprovedUnposted,
      obDraft,
      obApprovedUnposted,
      periods,
    ] = await Promise.all([
      supabase
        .from("manual_journal_drafts")
        .select("id", { count: "exact", head: true })
        .eq("accounting_firm_id", firmId)
        .eq("client_business_id", business_id)
        .eq("status", "submitted"),
      supabase
        .from("manual_journal_drafts")
        .select("id", { count: "exact", head: true })
        .eq("accounting_firm_id", firmId)
        .eq("client_business_id", business_id)
        .eq("status", "approved")
        .is("journal_entry_id", null),
      supabase
        .from("opening_balance_imports")
        .select("id", { count: "exact", head: true })
        .eq("accounting_firm_id", firmId)
        .eq("client_business_id", business_id)
        .eq("status", "draft"),
      supabase
        .from("opening_balance_imports")
        .select("id", { count: "exact", head: true })
        .eq("accounting_firm_id", firmId)
        .eq("client_business_id", business_id)
        .eq("status", "approved")
        .is("journal_entry_id", null),
      supabase
        .from("accounting_periods")
        .select("id, period_start, status")
        .eq("business_id", business_id)
        .order("period_start", { ascending: false })
        .limit(10),
    ])

    let periodBlockers = 0
    const openPeriods = (periods.data ?? []).filter(
      (p) => p.status === "open" || p.status === "soft_closed"
    )
    const currentPeriod = openPeriods[0] ?? null
    const lockedPeriods = (periods.data ?? []).filter((p) => p.status === "locked")
    const lastClosedPeriod = lockedPeriods[0] ?? null

    if (currentPeriod) {
      const { data: readiness } = await supabase.rpc("check_period_close_readiness", {
        p_business_id: business_id,
        p_period_start: currentPeriod.period_start,
      })
      if ((readiness as { status?: string } | null)?.status === "BLOCKED") {
        periodBlockers = 1
      }
    }

    const origin = request.nextUrl.origin
    const cookie = request.headers.get("cookie") ?? ""
    let reconExceptions = 0
    try {
      const res = await fetch(
        `${origin}/api/accounting/reconciliation/mismatches?businessId=${encodeURIComponent(business_id)}&limit=10`,
        { headers: { cookie } }
      )
      const data = await res.json()
      reconExceptions = Array.isArray(data.mismatches) ? data.mismatches.length : 0
    } catch {
      // ignore
    }

    const base = `/accounting`
    const summary: ControlTowerClientSummary = {
      business_id,
      client_name: business?.name ?? "Unknown",
      engagement: {
        status: engagementRow?.status ?? "unknown",
        access_level: engagementRow?.access_level ?? "read",
        effective_from: engagementRow?.effective_from ?? "",
        effective_to: engagementRow?.effective_to ?? null,
      },
      counts: {
        approvals_pending: (journalSubmitted as { count?: number }).count ?? 0,
        approved_unposted: (journalApprovedUnposted as { count?: number }).count ?? 0,
        ob_pending: (obDraft as { count?: number }).count ?? 0,
        ob_unposted: (obApprovedUnposted as { count?: number }).count ?? 0,
        recon_exceptions: reconExceptions,
        period_blockers: periodBlockers,
      },
      periods: {
        current_period_id: currentPeriod?.id ?? null,
        current_status: currentPeriod?.status ?? null,
        last_closed_period_id: lastClosedPeriod?.id ?? null,
      },
      links: {
        ledger: `${base}/ledger?${qs({ business_id })}`,
        journals: `${base}/journals?${qs({ business_id })}`,
        openingBalances: `${base}/opening-balances-imports?${qs({ business_id })}`,
        reconciliation: `${base}/reconciliation?${qs({ business_id })}`,
        periods: `${base}/periods?${qs({ business_id })}`,
        reports: `${base}/reports/trial-balance?${qs({ business_id })}`,
      },
    }

    return NextResponse.json(summary)
  } catch (err) {
    console.error("Control tower client-summary error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
