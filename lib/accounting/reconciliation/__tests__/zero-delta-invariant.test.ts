/**
 * Zero-delta reconciliation invariant tests.
 *
 * Invariants enforced:
 * - If delta === 0, reconciliation status MUST be OK (never FAIL/WARN).
 * - Engine/system failures use status ERROR (not FAIL); delta is null.
 * - Mismatches API and dashboard include only WARN/FAIL with nonzero delta; ERROR excluded.
 * - Dashboard "discrepancies" count = 0 when only ERROR results exist.
 */

import { describe, it, expect, jest } from "@jest/globals"
import { createReconciliationEngine } from "../engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "../types"
import type { ReconciliationResult } from "../types"
import type { SupabaseClient } from "@supabase/supabase-js"

// Same predicate as GET /api/accounting/reconciliation/mismatches (single source of truth)
function isAccountingMismatch(result: ReconciliationResult): boolean {
  return (
    (result.status === ReconciliationStatus.WARN || result.status === ReconciliationStatus.FAIL) &&
    result.delta != null &&
    result.delta !== 0
  )
}

describe("Zero-delta invariant", () => {
  it("delta = 0 → status OK (engine normal path: ledger balance equals expected)", async () => {
    const invoiceId = "inv-zero-delta"
    const businessId = "biz-1"
    const periodId = "period-1"
    const total = 100

    const mockFrom = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() =>
                  Promise.resolve({
                    data: {
                      id: invoiceId,
                      business_id: businessId,
                      total,
                      issue_date: "2025-01-01",
                      status: "sent",
                    },
                    error: null,
                  })
                ),
              })),
            })),
          })),
        }
      }
      if (table === "payments") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              is: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        }
      }
      if (table === "credit_notes") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                is: jest.fn(() => Promise.resolve({ data: [], error: null })),
              })),
            })),
          })),
        }
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
      }
    })

    const rpc = jest.fn((name: string) => {
      if (name === "get_ar_balances_by_invoice") {
        return Promise.resolve({
          data: [{ invoice_id: invoiceId, balance: String(total) }],
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    const supabase = {
      from: mockFrom,
      rpc,
    } as unknown as SupabaseClient

    const engine = createReconciliationEngine(supabase)
    const result = await engine.reconcileInvoice(
      { businessId, periodId, invoiceId },
      ReconciliationContext.DISPLAY
    )

    expect(result.delta).toBe(0)
    expect(result.status).toBe(ReconciliationStatus.OK)
    expect(result.expectedBalance).toBe(total)
    expect(result.ledgerBalance).toBe(total)
  })

  it("engine error → status ERROR (not FAIL) and delta null", async () => {
    const supabase = null as unknown as SupabaseClient
    const engine = createReconciliationEngine(supabase)

    const result = await engine.reconcileInvoice(
      { businessId: "", invoiceId: "any" },
      ReconciliationContext.DISPLAY
    )

    expect(result.status).toBe(ReconciliationStatus.ERROR)
    expect(result.status).not.toBe(ReconciliationStatus.FAIL)
    expect(result.delta).toBeNull()
  })

  it("ERROR never appears in mismatches list (filter excludes ERROR and zero-delta)", () => {
    const results: ReconciliationResult[] = [
      {
        scope: { businessId: "b", invoiceId: "i1" },
        context: ReconciliationContext.DISPLAY,
        expectedBalance: 0,
        ledgerBalance: 0,
        delta: null,
        tolerance: 0.01,
        status: ReconciliationStatus.ERROR,
        notes: ["Engine failure"],
      },
      {
        scope: { businessId: "b", invoiceId: "i2" },
        context: ReconciliationContext.DISPLAY,
        expectedBalance: 100,
        ledgerBalance: 100,
        delta: 0,
        tolerance: 0.01,
        status: ReconciliationStatus.OK,
      },
      {
        scope: { businessId: "b", invoiceId: "i3" },
        context: ReconciliationContext.DISPLAY,
        expectedBalance: 100,
        ledgerBalance: 98,
        delta: -2,
        tolerance: 0.01,
        status: ReconciliationStatus.WARN,
      },
    ]

    const mismatches = results.filter(isAccountingMismatch)

    expect(mismatches).toHaveLength(1)
    expect(mismatches[0].status).toBe(ReconciliationStatus.WARN)
    expect(mismatches[0].delta).toBe(-2)
    expect(mismatches.every((r) => r.status !== ReconciliationStatus.ERROR)).toBe(true)
  })

  it("dashboard clears when only ERROR exists (no accounting mismatches)", () => {
    const results: ReconciliationResult[] = [
      {
        scope: { businessId: "b", invoiceId: "i1" },
        context: ReconciliationContext.DISPLAY,
        expectedBalance: 0,
        ledgerBalance: 0,
        delta: null,
        tolerance: 0.01,
        status: ReconciliationStatus.ERROR,
        notes: ["Invoice not found"],
      },
    ]

    const mismatches = results.filter(isAccountingMismatch)

    expect(mismatches).toHaveLength(0)
    // Banner is driven by results.length from API; when only ERROR, API returns results = [] so banner clears
  })
})
