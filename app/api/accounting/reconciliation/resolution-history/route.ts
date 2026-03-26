/**
 * GET /api/accounting/reconciliation/resolution-history?businessId=...&scopeType=...&scopeId=...
 * Returns resolution history for a specific scope (invoice/customer/period).
 * Read-only; used for status timeline display.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("businessId") ?? ""
    const scopeType = searchParams.get("scopeType") ?? ""
    const scopeId = searchParams.get("scopeId") ?? ""

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
    if (!resolvedBusinessId || !scopeType || !scopeId) {
      return NextResponse.json(
        { error: "Missing required query params: businessId, scopeType, scopeId" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    // Fetch resolution (posted adjustment)
    const { data: resolution, error: resolutionError } = await supabase
      .from("reconciliation_resolutions")
      .select("approved_by, approved_at, reference_id")
      .eq("business_id", resolvedBusinessId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (resolutionError) {
      console.error("Resolution history error:", resolutionError)
      return NextResponse.json(
        { error: resolutionError.message || "Failed to load resolution history" },
        { status: 500 }
      )
    }

    // Fetch approvals (including pending)
    const { data: approvals, error: approvalsError } = await supabase
      .from("ledger_adjustment_approvals")
      .select("approved_by, approved_at, approver_role")
      .eq("business_id", resolvedBusinessId)
      .eq("scope_type", scopeType)
      .eq("scope_id", scopeId)
      .order("approved_at", { ascending: true })

    if (approvalsError) {
      console.error("Approvals history error:", approvalsError)
      return NextResponse.json(
        { error: approvalsError.message || "Failed to load approvals history" },
        { status: 500 }
      )
    }

    // Get journal entry ID from reference_id if resolution exists
    let journalEntryId: string | null = null
    if (resolution?.reference_id) {
      const { data: je } = await supabase
        .from("journal_entries")
        .select("id")
        .eq("business_id", resolvedBusinessId)
        .eq("reference_type", "reconciliation")
        .eq("reference_id", resolution.reference_id)
        .maybeSingle()
      journalEntryId = je?.id ?? null
    }

    return NextResponse.json({
      resolution: resolution
        ? {
            approved_by: resolution.approved_by,
            approved_at: resolution.approved_at,
            journal_entry_id: journalEntryId,
            reference_id: resolution.reference_id,
          }
        : null,
      approvals: (approvals ?? []).map((a) => ({
        approved_by: a.approved_by,
        approved_at: a.approved_at,
        approver_role: a.approver_role,
      })),
    })
  } catch (err: unknown) {
    console.error("Resolution history error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load resolution history" },
      { status: 500 }
    )
  }
}
