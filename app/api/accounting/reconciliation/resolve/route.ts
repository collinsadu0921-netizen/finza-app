/**
 * POST /api/accounting/reconciliation/resolve
 *
 * Approval-gated: re-validates scope, compares to clientSeen, optionally records
 * approval only (approve_only) or posts JE and records in reconciliation_resolutions.
 * Requires proposal_hash to prevent bait-and-switch. Policy: small delta (<=0.01)
 * can be posted by accountant alone; larger deltas require owner or two-person approval.
 *
 * Body: { businessId, scopeType, scopeId, proposed_fix, clientSeen, proposal_hash, approve_only?: boolean }
 * Errors: UNAUTHORIZED (401), FORBIDDEN (403), STALE_RECONCILIATION (409), POSTING_FAILED (500)
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getUserRole } from "@/lib/userRoles"
import { logAudit } from "@/lib/auditLog"
import { assertBusinessNotArchived } from "@/lib/accounting/archivedBusiness"
import {
  proposalHashFromResultAndProposal,
  getLedgerAdjustmentPolicy,
  isSmallDelta,
  requiresOwnerApproval,
  requiresTwoPersonApproval,
} from "@/lib/accounting/reconciliation/governance"
import { createReconciliationEngine } from "@/lib/accounting/reconciliation/engine-impl"
import { ReconciliationContext } from "@/lib/accounting/reconciliation/types"
import { produceLedgerCorrectionProposal } from "@/lib/accounting/reconciliation/resolution"
import type { ReconciliationResult, ReconciliationScope } from "@/lib/accounting/reconciliation/types"
import type {
  LedgerCorrectionProposal,
  ProposedFixStrict,
  ProposedJELineStrict,
} from "@/lib/accounting/reconciliation/resolution-types"

function buildScope(scopeType: string, scopeId: string, businessId: string): ReconciliationScope | null {
  switch (scopeType) {
    case "invoice":
      return { businessId, invoiceId: scopeId }
    case "customer":
      return { businessId, customerId: scopeId }
    case "period":
      return { businessId, periodId: scopeId }
    default:
      return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const body = await request.json().catch(() => ({}))
    const businessId = body.businessId as string | undefined
    const scopeType = body.scopeType as string | undefined
    const scopeId = body.scopeId as string | undefined
    const proposed_fix = body.proposed_fix as ProposedFixStrict | null | undefined
    const proposal_hash = body.proposal_hash as string | undefined
    const approve_only = body.approve_only === true
    const clientSeen = body.clientSeen as
      | { detected_delta: number; ledgerBalance: number; expectedBalance: number }
      | undefined

    if (!businessId || !scopeType || !scopeId || !clientSeen) {
      return NextResponse.json(
        { error: "Missing required fields: businessId, scopeType, scopeId, clientSeen" },
        { status: 400 }
      )
    }
    if (!proposed_fix?.journal_entry?.lines?.length) {
      return NextResponse.json(
        { error: "proposed_fix with journal_entry.lines is required" },
        { status: 400 }
      )
    }
    if (!proposal_hash || typeof proposal_hash !== "string") {
      return NextResponse.json(
        { error: "proposal_hash is required (hash-locked proposal from /mismatches)" },
        { status: 400 }
      )
    }

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
      searchParams: new URLSearchParams({ businessId: String(businessId) }),
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    const resolvedBusinessId = "error" in resolved ? null : resolved.businessId
    if (!resolvedBusinessId) {
      return NextResponse.json(
        { error: "Missing required fields: businessId, scopeType, scopeId, clientSeen" },
        { status: 400 }
      )
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "write")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Only accountants, admins, or owner can post ledger adjustments." },
        { status: 403 }
      )
    }

    try {
      await assertBusinessNotArchived(supabase, resolvedBusinessId)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Business is archived" }, { status: 403 })
    }

    const role =
      authResult.authority_source === "owner"
        ? "owner"
        : authResult.authority_source === "employee"
          ? await getUserRole(supabase, user.id, businessId) ?? "accountant"
          : "accountant"
    const auth = { userId: user.id, businessId: resolvedBusinessId, role }

    const scope = buildScope(scopeType, scopeId, auth.businessId)
    if (!scope) {
      return NextResponse.json(
        { error: "scopeType must be invoice, customer, or period" },
        { status: 400 }
      )
    }
    if (scopeType !== "invoice") {
      return NextResponse.json(
        { error: "Only invoice scope is supported for resolve. Customer/period not implemented." },
        { status: 501 }
      )
    }

    const engine = createReconciliationEngine(supabase)
    const resultBefore = await engine.reconcileInvoice(scope, ReconciliationContext.VALIDATE)
    const proposal = produceLedgerCorrectionProposal(resultBefore)
    if (!proposal.proposed_fix) {
      return NextResponse.json(
        {
          error: "STALE_RECONCILIATION",
          result: resultBefore,
          proposal,
        },
        { status: 409 }
      )
    }
    const serverHash = proposalHashFromResultAndProposal(resultBefore, proposal.proposed_fix)
    if (serverHash !== proposal_hash) {
      return NextResponse.json(
        {
          error: "STALE_RECONCILIATION",
          result: resultBefore,
          proposal,
          proposal_hash: serverHash,
        },
        { status: 409 }
      )
    }

    const rawDelta = resultBefore.delta
    if (rawDelta === null || rawDelta === undefined || typeof rawDelta !== "number") {
      return NextResponse.json(
        { error: "Reconciliation result delta is missing or invalid" },
        { status: 400 }
      )
    }
    const delta = rawDelta
    const fixToPost = proposal.proposed_fix
    const policy = await getLedgerAdjustmentPolicy(supabase, auth.businessId)

    const roleForApproval = auth.role as "owner" | "admin" | "accountant"

    const recordApproval = async () => {
      await supabase.from("ledger_adjustment_approvals").insert({
        business_id: auth.businessId,
        scope_type: scopeType,
        scope_id: scopeId,
        proposal_hash,
        delta,
        approved_by: auth.userId,
        approved_at: new Date().toISOString(),
        approver_role: roleForApproval,
        proposal_snapshot: fixToPost,
      })
      await logAudit({
        businessId: auth.businessId,
        userId: auth.userId,
        actionType: "approval",
        entityType: "adjustment",
        entityId: null,
        description: "adjustment approved",
        newValues: { approver_id: auth.userId, proposal_hash, scope_type: scopeType, scope_id: scopeId },
        request,
      })
    }

    let mayPost = false
    if (isSmallDelta(delta)) {
      if (approve_only) {
        await recordApproval()
        return NextResponse.json({
          success: true,
          posted: false,
          message: "Approval recorded; small delta may be posted without additional approval.",
        })
      }
      mayPost = true
    } else {
      // Large delta: owner or two-person
      if (requiresOwnerApproval(policy, delta)) {
        if (auth.role !== "owner") {
          return NextResponse.json(
            {
              error: "This adjustment requires owner approval.",
              awaiting_owner_approval: true,
            },
            { status: 403 }
          )
        }
        if (approve_only) {
          await recordApproval()
          return NextResponse.json({
            success: true,
            posted: false,
            awaiting_second_approval: false,
          })
        }
        mayPost = true
      } else if (requiresTwoPersonApproval(policy)) {
        const { data: existing } = await supabase
          .from("ledger_adjustment_approvals")
          .select("id, approved_by")
          .eq("business_id", auth.businessId)
          .eq("scope_type", scopeType)
          .eq("scope_id", scopeId)
          .eq("proposal_hash", proposal_hash)

        const approvals = existing ?? []
        const alreadyApproved = approvals.some((a: { approved_by: string }) => a.approved_by === auth.userId)

        if (approvals.length === 0) {
          if (!approve_only) {
            return NextResponse.json(
              {
                error: "Two-person rule: first approver must submit approval only (approve_only=true).",
                awaiting_second_approval: false,
              },
              { status: 403 }
            )
          }
          await recordApproval()
          return NextResponse.json({
            success: true,
            posted: false,
            awaiting_second_approval: true,
          })
        }

        if (approvals.length >= 2) {
          return NextResponse.json(
            { error: "This proposal has already been fully approved and posted." },
            { status: 403 }
          )
        }

        if (alreadyApproved) {
          return NextResponse.json(
            { error: "You have already approved this proposal; a different approver must post." },
            { status: 403 }
          )
        }

        if (approve_only) {
          await recordApproval()
          return NextResponse.json({
            success: true,
            posted: false,
            awaiting_second_approval: true,
          })
        }
        mayPost = true
      } else {
        if (approve_only) {
          await recordApproval()
          return NextResponse.json({ success: true, posted: false })
        }
        mayPost = true
      }
    }

    if (!mayPost) {
      return NextResponse.json(
        { error: "Not allowed to post this adjustment." },
        { status: 403 }
      )
    }

    await recordApproval()
    const je = fixToPost.journal_entry
    const codes = [...new Set(je.lines.map((l: ProposedJELineStrict) => l.account_code))]
    const { data: accounts } = await supabase
      .from("accounts")
      .select("id, code")
      .eq("business_id", auth.businessId)
      .in("code", codes)
      .is("deleted_at", null)

    const codeToId = new Map<string, string>()
    accounts?.forEach((a: { id: string; code: string }) => codeToId.set(a.code, a.id))
    let missing = codes.filter((c) => !codeToId.has(c))

    // Fallback resolution for standard COA codes that may differ per business.
    // AR codes (1100, 1200): resolve via control map 'AR', then any asset account.
    // Revenue codes (4000, 4100): resolve via any income account.
    // Cash/bank codes (1000, 1010): resolve via control map 'CASH' or 'BANK'.
    if (missing.length > 0) {
      const arCodes = missing.filter((c) => c === "1100" || c === "1200")
      if (arCodes.length > 0) {
        const { data: arMapping } = await supabase
          .from("chart_of_accounts_control_map")
          .select("account_code")
          .eq("business_id", auth.businessId)
          .eq("control_key", "AR")
          .maybeSingle()
        const arLookupCode = arMapping?.account_code ?? null
        if (arLookupCode) {
          const { data: arAcc } = await supabase
            .from("accounts")
            .select("id")
            .eq("business_id", auth.businessId)
            .eq("code", arLookupCode)
            .is("deleted_at", null)
            .maybeSingle()
          if (arAcc?.id) arCodes.forEach((c) => codeToId.set(c, arAcc.id))
        }
        // Last resort: any non-deleted asset account
        if (arCodes.some((c) => !codeToId.has(c))) {
          const { data: anyAsset } = await supabase
            .from("accounts")
            .select("id")
            .eq("business_id", auth.businessId)
            .eq("type", "asset")
            .is("deleted_at", null)
            .limit(1)
          if (anyAsset?.[0]?.id) arCodes.filter((c) => !codeToId.has(c)).forEach((c) => codeToId.set(c, anyAsset[0].id))
        }
      }

      const revCodes = missing.filter((c) => c === "4000" || c === "4100")
      if (revCodes.length > 0) {
        const { data: anyIncome } = await supabase
          .from("accounts")
          .select("id")
          .eq("business_id", auth.businessId)
          .eq("type", "income")
          .is("deleted_at", null)
          .limit(1)
        if (anyIncome?.[0]?.id) revCodes.filter((c) => !codeToId.has(c)).forEach((c) => codeToId.set(c, anyIncome[0].id))
      }

      const cashCodes = missing.filter((c) => c === "1000" || c === "1010" || c === "1020")
      if (cashCodes.length > 0) {
        for (const controlKey of ["CASH", "BANK"]) {
          const { data: cashMapping } = await supabase
            .from("chart_of_accounts_control_map")
            .select("account_code")
            .eq("business_id", auth.businessId)
            .eq("control_key", controlKey)
            .maybeSingle()
          const cashLookupCode = cashMapping?.account_code ?? null
          if (cashLookupCode) {
            const { data: cashAcc } = await supabase
              .from("accounts")
              .select("id")
              .eq("business_id", auth.businessId)
              .eq("code", cashLookupCode)
              .is("deleted_at", null)
              .maybeSingle()
            if (cashAcc?.id) cashCodes.filter((c) => !codeToId.has(c)).forEach((c) => codeToId.set(c, cashAcc.id))
          }
          if (cashCodes.every((c) => codeToId.has(c))) break
        }
      }

      missing = codes.filter((c) => !codeToId.has(c))
    }

    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Account(s) not found for code(s): ${missing.join(", ")}. Ensure your chart of accounts includes AR and Revenue accounts.` },
        { status: 400 }
      )
    }

    const p_lines = je.lines.map((l: ProposedJELineStrict) => ({
      account_id: codeToId.get(l.account_code),
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      description: je.description ?? null,
    }))

    const entryDate = new Date().toISOString().slice(0, 10)

    // reference_id is always derived from proposal_hash (deterministic) via post_reconciliation_journal_entry; no random UUID.
    const { data: postResult, error: postError } = await supabase.rpc(
      "post_reconciliation_journal_entry",
      {
        p_business_id: auth.businessId,
        p_scope_id: scopeId,
        p_proposal_hash: proposal_hash,
        p_date: entryDate,
        p_description: je.description,
        p_lines,
        p_created_by: auth.userId,
        p_posted_by_accountant_id: auth.userId,
        p_posting_source: "accountant",
      }
    )

    if (postError) {
      console.error("Reconciliation resolve post_reconciliation_journal_entry error:", postError)
      return NextResponse.json(
        { error: "POSTING_FAILED", message: postError.message || "Failed to post journal entry" },
        { status: 500 }
      )
    }

    const row = Array.isArray(postResult) ? postResult[0] : postResult
    const journalEntryId = row?.journal_entry_id ?? null
    const referenceId = row?.reference_id ?? null
    if (journalEntryId == null || referenceId == null) {
      return NextResponse.json(
        { error: "POSTING_FAILED", message: "Posting did not return journal_entry_id and reference_id" },
        { status: 500 }
      )
    }

    const resultAfter = await engine.reconcileInvoice(scope, ReconciliationContext.VALIDATE)
    const fullProposal: LedgerCorrectionProposal = {
      diagnosis: { classification: "structural_error", possible_causes: [], evidence: [], summary: "" },
      proposed_fix: fixToPost,
      audit_metadata: {
        reason: "Approved reconciliation fix",
        detected_delta: resultBefore.delta,
        before_balance: resultBefore.ledgerBalance,
        after_balance: resultAfter.ledgerBalance,
        confidence_level: "HIGH",
        approval_required: true,
      },
      verification_plan: { reconciliation_to_re_run: "invoice", expected_delta: 0, expected_status: "OK" },
    }

    await supabase.from("reconciliation_resolutions").insert({
      business_id: auth.businessId,
      scope_type: scopeType,
      scope_id: scopeId,
      reference_id: referenceId,
      approved_by: auth.userId,
      approved_at: new Date().toISOString(),
      delta_before: resultBefore.delta,
      delta_after: resultAfter.delta,
      proposal: fullProposal,
    })

    await logAudit({
      businessId: auth.businessId,
      userId: auth.userId,
      actionType: "reconciliation_posted",
      entityType: "journal_entry",
      entityId: journalEntryId,
      description: "reconciliation posted",
      newValues: {
        proposal_hash: proposal_hash,
        scope_type: scopeType,
        scope_id: scopeId,
        reference_id: referenceId,
      },
      request,
    })

    return NextResponse.json({
      success: true,
      posted: true,
      before: resultBefore as ReconciliationResult,
      after: resultAfter as ReconciliationResult,
      journal_entry_id: journalEntryId,
    })
  } catch (err: unknown) {
    console.error("Reconciliation resolve error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve" },
      { status: 500 }
    )
  }
}
