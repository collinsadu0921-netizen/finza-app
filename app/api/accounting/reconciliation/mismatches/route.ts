/**
 * GET /api/accounting/reconciliation/mismatches
 *
 * READ-ONLY. Query params: businessId (required), limit (optional, default 20), periodId (optional).
 * Finds recent non-draft invoices for business (limit N, newest first), runs reconciliation
 * (DISPLAY) per invoice, keeps only WARN/FAIL, attaches proposal per result.
 * Returns { results, proposals, mismatches }.
 *
 * Single source of truth for discrepancy state: the dashboard calls this with limit=1
 * to drive the "Accounting discrepancies detected" banner so it and the reconciliation
 * list cannot disagree. Banner clears when results.length === 0.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getUserRole } from "@/lib/userRoles"
import {
  getLedgerAdjustmentPolicy,
  proposalHashFromResultAndProposal,
} from "@/lib/accounting/reconciliation/governance"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "@/lib/accounting/reconciliation/types"
import { produceLedgerCorrectionProposal } from "@/lib/accounting/reconciliation/resolution"
import { runWithConcurrencyLimit } from "@/lib/accounting/concurrencyLimit"
import type { ReconciliationResult } from "@/lib/accounting/reconciliation/types"
import type { LedgerCorrectionProposal } from "@/lib/accounting/reconciliation/resolution-types"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const CONCURRENCY = 5

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("businessId") ?? ""

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      resolvedBusinessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 })
    }

    const writeAuth = await checkAccountingAuthority(
      supabase,
      user.id,
      resolvedBusinessId,
      "write"
    )
    const canPostLedger = writeAuth.authorized
    const policy = await getLedgerAdjustmentPolicy(supabase, resolvedBusinessId)

    const limitParam = searchParams.get("limit")
    const periodId = searchParams.get("periodId") ?? undefined
    const limit = Math.min(
      Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
      MAX_LIMIT
    )

    const { data: invoices } = await supabase
      .from("invoices")
      .select("id")
      .eq("business_id", resolvedBusinessId)
      .neq("status", "draft")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit)

    const results: ReconciliationResult[] = []
    const proposals: LedgerCorrectionProposal[] = []

    if (invoices && invoices.length > 0) {
      const engine = createReconciliationEngine(supabase)
      const scopeBase = { businessId: resolvedBusinessId, periodId }
      const pairs = await runWithConcurrencyLimit(
        invoices,
        CONCURRENCY,
        async (inv) => {
          const result = await engine.reconcileInvoice(
            { ...scopeBase, invoiceId: inv.id },
            ReconciliationContext.DISPLAY
          )
          return { result }
        }
      )
      for (const { result } of pairs) {
        // Only true accounting mismatches: WARN/FAIL with nonzero delta. Exclude ERROR and zero-delta.
        const isMismatch =
          (result.status === ReconciliationStatus.WARN || result.status === ReconciliationStatus.FAIL) &&
          result.delta != null &&
          result.delta !== 0
        if (isMismatch) {
          results.push(result)
          proposals.push(produceLedgerCorrectionProposal(result))
        }
      }
    }

    // Spec: { results, proposals, mismatches, canPostLedger, policy, userRole }. Each mismatch includes proposal_hash (hash-locked).
    const mismatches = results.map((result, i) => {
      const proposal = proposals[i]
      const proposal_hash =
        proposal?.proposed_fix != null
          ? proposalHashFromResultAndProposal(result, proposal.proposed_fix)
          : undefined
      return { result, proposal, proposal_hash }
    })
    const userRole =
      auth.authority_source === "owner"
        ? "owner"
        : auth.authority_source === "employee"
          ? await getUserRole(supabase, user.id, resolvedBusinessId)
          : "accountant"
    return NextResponse.json({ results, proposals, mismatches, canPostLedger, policy, userRole: userRole ?? "accountant" })
  } catch (err: unknown) {
    console.error("Reconciliation mismatches error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load mismatches" },
      { status: 500 }
    )
  }
}
