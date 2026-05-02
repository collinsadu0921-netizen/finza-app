/**
 * GET /api/accounting/reconciliation/pending-approvals?businessId=...
 * Returns pending approvals (by proposal_hash) for two-person rule: scope + hash + count.
 * UI uses this to show "Awaiting second approver" and to know if current user can post.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("businessId") ?? ""

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 })
    }
    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    const resolvedBusinessId = "error" in resolved ? null : resolved.businessId
    if (!resolvedBusinessId) {
      return NextResponse.json(
        { error: "Missing required query param: businessId" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const tierBlockPa = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlockPa) return tierBlockPa

    const { data: rows, error } = await supabase
      .from("ledger_adjustment_approvals")
      .select("scope_type, scope_id, proposal_hash, delta, approved_by, approved_at, approver_role")
      .eq("business_id", resolvedBusinessId)
      .order("approved_at", { ascending: false })

    if (error) {
      console.error("Pending approvals error:", error)
      return NextResponse.json(
        { error: error.message || "Failed to load pending approvals" },
        { status: 500 }
      )
    }

    const byKey = new Map<string, { scope_type: string; scope_id: string; proposal_hash: string; delta: number; approvals: { approved_by: string; approved_at: string; approver_role: string }[] }>()
    for (const r of rows ?? []) {
      const key = `${r.scope_type}:${r.scope_id}:${r.proposal_hash}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          scope_type: r.scope_type,
          scope_id: r.scope_id,
          proposal_hash: r.proposal_hash,
          delta: Number(r.delta),
          approvals: [],
        })
      }
      byKey.get(key)!.approvals.push({
        approved_by: r.approved_by,
        approved_at: r.approved_at,
        approver_role: r.approver_role,
      })
    }

    const pending = Array.from(byKey.values())
      .filter((g) => g.approvals.length === 1)
      .map((g) => ({
        scope_type: g.scope_type,
        scope_id: g.scope_id,
        proposal_hash: g.proposal_hash,
        delta: g.delta,
        approval_count: g.approvals.length,
        first_approver: g.approvals[0],
      }))

    return NextResponse.json({ pending })
  } catch (err: unknown) {
    console.error("Pending approvals error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load pending approvals" },
      { status: 500 }
    )
  }
}
