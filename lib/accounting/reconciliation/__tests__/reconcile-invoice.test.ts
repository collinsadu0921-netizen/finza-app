/**
 * C5A — Minimal harness for reconcileInvoice.
 * Tests scope validation path (no DB); full reconciliation requires Supabase.
 */

import { createReconciliationEngine } from "../engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "../types"
import type { SupabaseClient } from "@supabase/supabase-js"

describe("reconcileInvoice (C5A)", () => {
  it("returns ERROR (not FAIL) with delta null when businessId or invoiceId is missing", async () => {
    const supabase = null as unknown as SupabaseClient
    const engine = createReconciliationEngine(supabase)

    const r1 = await engine.reconcileInvoice(
      { businessId: "", invoiceId: "some-id" },
      ReconciliationContext.DISPLAY
    )
    expect(r1.status).toBe(ReconciliationStatus.ERROR)
    expect(r1.delta).toBeNull()
    expect(r1.notes).toBeDefined()
    expect(
      (r1.notes || []).some((n) => n.includes("businessId") || n.includes("invoiceId") || n.includes("required"))
    ).toBe(true)

    const r2 = await engine.reconcileInvoice(
      { businessId: "biz-1", invoiceId: undefined as unknown as string },
      ReconciliationContext.VALIDATE
    )
    expect(r2.status).toBe(ReconciliationStatus.ERROR)
    expect(r2.delta).toBeNull()
    expect(r2.notes).toBeDefined()
    expect(
      (r2.notes || []).some((n) => n.includes("required") || n.includes("invoiceId"))
    ).toBe(true)
  })

  it("returns OK with zero balances and draft note when invoice is draft", async () => {
    const mockFrom = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() =>
                  Promise.resolve({
                    data: {
                      id: "inv-draft",
                      business_id: "biz-1",
                      total: 100,
                      issue_date: "2025-01-01",
                      status: "draft",
                    },
                    error: null,
                  })
                ),
              })),
            })),
          })),
        }
      }
      return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })) })) })) }
    })
    const supabase = { from: mockFrom } as unknown as SupabaseClient
    const engine = createReconciliationEngine(supabase)

    const r = await engine.reconcileInvoice(
      { businessId: "biz-1", invoiceId: "inv-draft" },
      ReconciliationContext.VALIDATE
    )

    expect(r.status).toBe(ReconciliationStatus.OK)
    expect(r.expectedBalance).toBe(0)
    expect(r.ledgerBalance).toBe(0)
    expect(r.delta).toBe(0)
    expect((r.notes || []).some((n) => n.includes("Draft invoice") && n.includes("excluded"))).toBe(true)
  })
})
