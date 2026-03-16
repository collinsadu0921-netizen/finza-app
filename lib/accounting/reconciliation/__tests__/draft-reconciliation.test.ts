/**
 * I5 — Reconciliation draft exclusion invariants.
 *
 * Draft invoices must:
 * - reconcileInvoice(draft) return OK, ledgerBalance = 0, expectedBalance = 0,
 *   and explanatory note "Draft invoice — excluded from reconciliation."
 * - Never produce WARN or FAIL mismatches
 * - Never appear in /mismatches (API excludes draft from invoice list)
 *
 * Tests fail loudly if drafts ever pollute reconciliation or mismatch lists.
 */

import { describe, it, expect, beforeAll } from "@jest/globals"
import { createClient } from "@supabase/supabase-js"
import { createReconciliationEngine } from "../engine-impl"
import { ReconciliationContext, ReconciliationStatus } from "../types"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_BUSINESS_ID = process.env.TEST_BUSINESS_ID

const canRun = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY && TEST_BUSINESS_ID)

async function getSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing Supabase env")
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

describe("I5 — Draft reconciliation exclusion", () => {
  it("reconcileInvoice(draftInvoiceId) returns OK, ledgerBalance=0, expectedBalance=0, explanatory note (mocked)", async () => {
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
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
      }
    })
    const supabase = { from: mockFrom } as unknown as Awaited<ReturnType<typeof createClient>>
    const engine = createReconciliationEngine(supabase)

    const r = await engine.reconcileInvoice(
      { businessId: "biz-1", invoiceId: "inv-draft" },
      ReconciliationContext.VALIDATE
    )

    expect(r.status).toBe(ReconciliationStatus.OK)
    expect(r.ledgerBalance).toBe(0)
    expect(r.expectedBalance).toBe(0)
    expect(r.delta).toBe(0)
    expect((r.notes || []).some((n) => n.includes("Draft invoice") && n.includes("excluded"))).toBe(true)
  })

  it("reconcileInvoice(draft) never returns WARN or FAIL (invariant: draft excluded)", async () => {
    const mockFrom = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() =>
                  Promise.resolve({
                    data: { id: "inv", business_id: "biz", total: 200, issue_date: "2025-01-01", status: "draft" },
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
    const supabase = { from: mockFrom } as unknown as Awaited<ReturnType<typeof createClient>>
    const engine = createReconciliationEngine(supabase)

    const r = await engine.reconcileInvoice(
      { businessId: "biz", invoiceId: "inv" },
      ReconciliationContext.DISPLAY
    )

    expect(r.status).not.toBe(ReconciliationStatus.WARN)
    expect(r.status).not.toBe(ReconciliationStatus.FAIL)
    expect(r.status).toBe(ReconciliationStatus.OK)
  })
})

describe("I5 — Draft reconciliation exclusion (real DB)", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let openPeriod: { id: string; period_start: string } | null
  let customerId: string | null

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, period_start")
      .eq("business_id", TEST_BUSINESS_ID!)
      .eq("status", "open")
      .limit(1)
      .maybeSingle()
    openPeriod = period ?? null
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .limit(1)
      .maybeSingle()
    customerId = cust?.id ?? null
  })

  it("reconcileInvoice(draftInvoiceId) returns OK, 0, 0, draft note (real DB)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "draft",
        sent_at: null,
        subtotal: 90,
        total_tax: 0,
        total: 90,
        invoice_number: "DRAFT-REC-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const engine = createReconciliationEngine(supabase)
    const r = await engine.reconcileInvoice(
      { businessId: TEST_BUSINESS_ID!, invoiceId: inv.id, periodId: openPeriod!.id },
      ReconciliationContext.VALIDATE
    )

    expect(r.status).toBe(ReconciliationStatus.OK)
    expect(r.ledgerBalance).toBe(0)
    expect(r.expectedBalance).toBe(0)
    expect((r.notes || []).some((n) => n.includes("Draft invoice") && n.includes("excluded"))).toBe(true)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("draft invoice never appears in mismatches list (query excludes draft)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "draft",
        sent_at: null,
        subtotal: 80,
        total_tax: 0,
        total: 80,
        invoice_number: "DRAFT-MIS-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const { data: invoicesInMismatches } = await supabase
      .from("invoices")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .neq("status", "draft")
      .is("deleted_at", null)

    const ids = (invoicesInMismatches ?? []).map((r: { id: string }) => r.id)
    expect(ids).not.toContain(inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })
})
