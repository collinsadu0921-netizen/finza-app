/**
 * C5A — Reconciliation engine implementation (READ-ONLY).
 * Invoice reconciliation only. When periodId exists uses get_ar_balances_by_invoice RPC;
 * otherwise fallback: get_general_ledger + operational tables.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ReconciliationEngine } from "./engine"
import { getArBalancesByInvoice } from "./arBalancesRpc"
import type {
  ReconciliationScope,
  ReconciliationContext,
  ReconciliationResult,
  ReconciliationBatchResult,
} from "./types"
import { ReconciliationContext as ContextEnum, ReconciliationStatus } from "./types"
import { withinTolerance } from "./money"

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

function getTolerance(context: ReconciliationContext): number {
  switch (context) {
    case ContextEnum.DISPLAY:
      return 0.01
    case ContextEnum.VALIDATE:
    case ContextEnum.PERIOD_CLOSE:
      return 0
    default:
      return 0.01
  }
}

function statusFromDelta(
  delta: number,
  tolerance: number,
  context: ReconciliationContext
): ReconciliationStatus {
  const absDelta = Math.abs(delta)
  if (withinTolerance(delta, tolerance)) return ReconciliationStatus.OK
  if (tolerance === 0.01 && absDelta > 0.01) return ReconciliationStatus.WARN
  if (tolerance === 0 && absDelta > 0) return ReconciliationStatus.FAIL
  return ReconciliationStatus.OK
}

/** Resolve AR account id: chart_of_accounts_control_map 'AR' -> accounts.id; fallback to accounts by code 1100/1200. */
async function resolveARAccountId(
  supabase: SupabaseClient,
  businessId: string
): Promise<{ id: string } | null> {
  const { data: mapping } = await supabase
    .from("chart_of_accounts_control_map")
    .select("account_code")
    .eq("business_id", businessId)
    .eq("control_key", "AR")
    .maybeSingle()

  const code = mapping?.account_code
  if (code) {
    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", businessId)
      .eq("code", code)
      .is("deleted_at", null)
      .maybeSingle()
    if (account) return { id: account.id }
  }

  // Fallback: aging-style — accounts with AR codes 1100 or 1200 (first match)
  const { data: fallbackRows } = await supabase
    .from("accounts")
    .select("id")
    .eq("business_id", businessId)
    .in("code", ["1100", "1200"])
    .is("deleted_at", null)
    .limit(1)
  const first = (fallbackRows as { id: string }[] | null)?.[0]
  return first ? { id: first.id } : null
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Engine/system failure — not an accounting mismatch. Excluded from mismatches and dashboard. */
function buildErrorResult(
  scope: ReconciliationScope,
  context: ReconciliationContext,
  notes: string[]
): ReconciliationResult {
  const tolerance = getTolerance(context)
  return {
    scope,
    context,
    expectedBalance: 0,
    ledgerBalance: 0,
    delta: null,
    tolerance,
    status: ReconciliationStatus.ERROR,
    notes,
  }
}

export function createReconciliationEngine(supabase: SupabaseClient): ReconciliationEngine {
  return {
    async reconcileInvoice(
      scope: ReconciliationScope,
      context: ReconciliationContext
    ): Promise<ReconciliationResult> {
      const notes: string[] = []

      if (!scope.businessId || !scope.invoiceId) {
        return buildErrorResult(scope, context, [
          "Missing required scope: businessId and invoiceId are required for invoice reconciliation.",
        ])
      }

      // Load invoice
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .select("id, business_id, total, issue_date, status")
        .eq("id", scope.invoiceId)
        .eq("business_id", scope.businessId)
        .maybeSingle()

      if (invErr || !invoice) {
        return buildErrorResult(scope, context, [
          invErr?.message ? `Invoice fetch error: ${invErr.message}` : "Invoice not found.",
        ])
      }

      // Draft invoices are excluded from reconciliation; never produce a mismatch
      if (invoice.status === "draft") {
        return {
          scope,
          context,
          expectedBalance: 0,
          ledgerBalance: 0,
          delta: 0,
          tolerance: getTolerance(context),
          status: ReconciliationStatus.OK,
          notes: ["Draft invoice — excluded from reconciliation."],
        }
      }

      const invoiceTotal = Number(invoice.total)
      const issueDate = (invoice.issue_date as string) || ""

      let ledgerBalance: number

      if (scope.periodId) {
        // Canonical RPC: period-native, no client-side grouping
        try {
          const rows = await getArBalancesByInvoice(supabase, {
            businessId: scope.businessId,
            periodId: scope.periodId,
            invoiceId: scope.invoiceId,
          })
          ledgerBalance = rows[0]?.balance ?? 0
          notes.push("Ledger balance from get_ar_balances_by_invoice RPC (period-native).")
          if (rows.length === 0) {
            notes.push("No AR lines for this invoice in period; ledgerBalance = 0.")
          }
        } catch (err) {
          return buildErrorResult(scope, context, [
            err instanceof Error ? err.message : "get_ar_balances_by_invoice failed.",
          ])
        }
      } else {
        // Fallback when periodId missing: get_general_ledger + filter by invoice
        const startDate = issueDate || new Date().toISOString().slice(0, 10)
        const endDate = new Date().toISOString().slice(0, 10)
        const ar = await resolveARAccountId(supabase, scope.businessId)
        if (!ar) {
          return buildErrorResult(scope, context, [
            "AR account not found for business.",
          ])
        }
        const { data: ledgerRows, error: glErr } = await supabase.rpc("get_general_ledger", {
          p_business_id: scope.businessId,
          p_account_id: ar.id,
          p_start_date: startDate,
          p_end_date: endDate,
        })
        if (glErr) {
          return buildErrorResult(scope, context, [
            `Ledger fetch error: ${glErr.message || "get_general_ledger failed."}`,
          ])
        }
        notes.push("Ledger balance computed from AR account via get_general_ledger (fallback, no periodId).")
        const rows = (ledgerRows as Array<{ reference_type?: string; reference_id?: string; debit?: number; credit?: number }>) || []
        const invoiceRows = rows.filter(
          (r) => r.reference_type === "invoice" && r.reference_id === scope.invoiceId
        )
        ledgerBalance = invoiceRows.reduce(
          (sum, r) => sum + (Number(r.debit) || 0) - (Number(r.credit) || 0),
          0
        )
        if (invoiceRows.length === 0) {
          notes.push("No ledger rows found for this invoice; ledgerBalance = 0.")
        }
      }

      // Expected: invoice.total - sum(payments.amount) - sum(applied credit_notes.total)
      const { data: payments } = await supabase
        .from("payments")
        .select("amount")
        .eq("invoice_id", scope.invoiceId)
        .is("deleted_at", null)

      const { data: creditNotes } = await supabase
        .from("credit_notes")
        .select("total")
        .eq("invoice_id", scope.invoiceId)
        .eq("status", "applied")
        .is("deleted_at", null)

      const totalPaid = (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
      const totalCredits = (creditNotes || []).reduce((s, cn) => s + Number(cn.total || 0), 0)
      const expectedBalance = invoiceTotal - totalPaid - totalCredits
      notes.push("Expected balance computed from invoices/payments/credit_notes operational tables.")

      const delta = ledgerBalance - expectedBalance
      const tolerance = getTolerance(context)
      // Zero-delta invariant: |delta| ≤ tolerance → status MUST be OK; classification never overrides.
      const status = statusFromDelta(delta, tolerance, context)

      return {
        scope,
        context,
        expectedBalance,
        ledgerBalance,
        delta,
        tolerance,
        status,
        notes,
      }
    },

    async reconcileCustomer(
      _scope: ReconciliationScope,
      _context: ReconciliationContext
    ): Promise<ReconciliationResult> {
      throw new Error("reconcileCustomer not implemented (C5A scope: invoice only)")
    },

    async reconcilePeriod(
      _scope: ReconciliationScope,
      _context: ReconciliationContext
    ): Promise<ReconciliationResult> {
      throw new Error("reconcilePeriod not implemented (C5A scope: invoice only)")
    },

    async reconcileBatch(
      _scope: ReconciliationScope,
      _context: ReconciliationContext
    ): Promise<ReconciliationBatchResult> {
      throw new Error("reconcileBatch not implemented (C5A scope: invoice only)")
    },
  }
}
