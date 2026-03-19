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

      // Load invoice (include FX fields so we compare home-currency amounts in the ledger)
      const { data: invoice, error: invErr } = await supabase
        .from("invoices")
        .select("id, business_id, total, home_currency_total, fx_rate, issue_date, status")
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

      // For FX invoices, ledger posts home_currency_total (= total × fx_rate).
      // Expected balance must also be in home currency.
      const invoiceFxRate = invoice.fx_rate != null ? Number(invoice.fx_rate) : null
      const invoiceTotal = invoiceFxRate != null
        ? Number(invoice.home_currency_total ?? (Number(invoice.total) * invoiceFxRate))
        : Number(invoice.total)
      const issueDate = (invoice.issue_date as string) || ""

      // Fetch operational data upfront — needed for both expectedBalance and fallback ledger filter.
      // Include settlement_fx_rate so we can compute the home-currency AR credit for FX payments.
      const { data: payments } = await supabase
        .from("payments")
        .select("id, amount, settlement_fx_rate")
        .eq("invoice_id", scope.invoiceId)
        .is("deleted_at", null)

      const { data: creditNotes } = await supabase
        .from("credit_notes")
        .select("id, total")
        .eq("invoice_id", scope.invoiceId)
        .eq("status", "applied")
        .is("deleted_at", null)

      let ledgerBalance: number

      if (scope.periodId) {
        // Canonical RPC: period-native, includes invoice + payment + credit_note JEs.
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
        // Fallback when periodId missing: get_general_ledger filtered by invoice +
        // its payment and credit_note references (mirrors get_ar_balances_by_invoice logic).
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

        // Build ID sets so we can match payment/credit_note JEs back to this invoice.
        const paymentIds = new Set((payments || []).map((p) => (p as { id: string }).id))
        const creditNoteIds = new Set((creditNotes || []).map((cn) => (cn as { id: string }).id))

        const rows = (ledgerRows as Array<{ reference_type?: string; reference_id?: string; debit?: number; credit?: number }>) || []
        // Include: (a) the invoice JE itself, (b) payment JEs for this invoice,
        // (c) credit_note JEs for applied credits on this invoice.
        // This matches the RPC logic in get_ar_balances_by_invoice (migration 288).
        const relevantRows = rows.filter(
          (r) =>
            (r.reference_type === "invoice" && r.reference_id === scope.invoiceId) ||
            (r.reference_type === "payment" && r.reference_id != null && paymentIds.has(r.reference_id)) ||
            (r.reference_type === "credit_note" && r.reference_id != null && creditNoteIds.has(r.reference_id))
        )
        ledgerBalance = relevantRows.reduce(
          (sum, r) => sum + (Number(r.debit) || 0) - (Number(r.credit) || 0),
          0
        )
        if (relevantRows.length === 0) {
          notes.push("No ledger rows found for this invoice (including payments and credit notes); ledgerBalance = 0.")
        }
      }

      // Expected balance in home currency:
      //   invoiceTotal (already home-currency for FX invoices)
      //   − sum of AR credits from payments (home currency)
      //   − sum of applied credit notes (assumed home currency)
      //
      // For FX payments (invoice has fx_rate AND payment has settlement_fx_rate):
      //   AR credit = payment.amount × invoice.fx_rate  (original booking rate)
      // For home-currency payments (no settlement_fx_rate or no invoice fx_rate):
      //   AR credit = payment.amount  (already home currency)
      const totalPaid = (payments || []).reduce((s, p) => {
        const pmt = p as { amount: number; settlement_fx_rate: number | null }
        const amt = Number(pmt.amount || 0)
        // FX payment: amount is in foreign currency; AR cleared at invoice booking rate
        if (invoiceFxRate != null && pmt.settlement_fx_rate != null) {
          return s + Math.round(amt * invoiceFxRate * 100) / 100
        }
        return s + amt
      }, 0)
      const totalCredits = (creditNotes || []).reduce((s, cn) => s + Number((cn as { total: number }).total || 0), 0)
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
