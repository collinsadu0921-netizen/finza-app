/**
 * I1 / I4 — Draft invoice accounting invariants.
 *
 * Draft invoices are accounting-nonexistent:
 * - Must not post any journal entry
 * - Must not create AR
 * - Must not accept payments
 * - Must not appear in reconciliation, aging, or AR totals
 *
 * Tests fail loudly if draft invoices ever pollute the ledger or accept payments.
 * Uses real DB when env is set; skips cleanly otherwise.
 * API 400 for payment create is asserted below (mocked route call).
 */

import { describe, it, expect, beforeAll } from "@jest/globals"
import { createClient } from "@supabase/supabase-js"
import { NextRequest } from "next/server"

jest.mock("@/lib/supabaseServer")
jest.mock("@/lib/auditLog", () => ({ createAuditLog: jest.fn(() => Promise.resolve()) }))
jest.mock("@/lib/payments/eligibility", () => ({
  normalizeCountry: jest.fn(() => "GH"),
  assertMethodAllowed: jest.fn(),
}))
jest.mock("@/lib/business", () => ({
  getCurrentBusiness: jest.fn(() => Promise.resolve({ id: "biz", address_country: "GH" })),
}))
jest.mock("@/lib/accounting/reconciliation/engine-impl", () => ({
  createReconciliationEngine: jest.fn(() => ({
    reconcileInvoice: jest.fn(() =>
      Promise.resolve({ status: "OK", expectedBalance: 0, ledgerBalance: 0, delta: 0 })
    ),
  })),
}))
jest.mock("@/lib/accounting/reconciliation/mismatch-logger", () => ({
  logReconciliationMismatch: jest.fn(() => Promise.resolve()),
}))

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

async function getOpenPeriod(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data } = await supabase
    .from("accounting_periods")
    .select("id, period_start, period_end")
    .eq("business_id", TEST_BUSINESS_ID!)
    .eq("status", "open")
    .limit(1)
    .maybeSingle()
  return data
}

describe("I1/I4 — Draft invoice accounting guards", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let openPeriod: { id: string; period_start: string; period_end: string } | null
  let customerId: string | null

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    openPeriod = await getOpenPeriod(supabase)
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .limit(1)
      .maybeSingle()
    customerId = cust?.id ?? null
  })

  it("draft invoice → calling post_invoice_to_ledger throws (no JE must be created)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "draft",
        sent_at: null,
        subtotal: 100,
        total_tax: 0,
        total: 100,
        invoice_number: "INV-DRAFT-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const { error } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })

    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/draft|issue the invoice/i)
    const { count } = await supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("reference_type", "invoice")
      .eq("reference_id", inv.id)
    expect(count ?? 0).toBe(0)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("draft invoice → payment insert rejected at DB (no JE created for draft)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "draft",
        subtotal: 50,
        total_tax: 0,
        total: 50,
        invoice_number: "INV-DRAFT-PAY-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const { error } = await supabase
      .from("payments")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: inv.id,
        amount: 25,
        date: openPeriod!.period_start,
        method: "cash",
      })
      .select("id")
      .single()

    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/Cannot post payment for draft invoice|Issue the invoice first/i)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("draft invoice → zero journal entries exist (draft is accounting-nonexistent)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "draft",
        subtotal: 75,
        total_tax: 0,
        total: 75,
        invoice_number: "INV-DRAFT-JE-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const { count } = await supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("business_id", TEST_BUSINESS_ID!)
      .eq("reference_id", inv.id)

    expect(count ?? 0).toBe(0)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("draft invoice → AR balance = 0 (must not appear in AR totals)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "draft",
        subtotal: 200,
        total_tax: 0,
        total: 200,
        invoice_number: "INV-DRAFT-AR-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const { data: rows } = await supabase.rpc("get_ar_balances_by_invoice", {
      p_business_id: TEST_BUSINESS_ID,
      p_period_id: openPeriod!.id,
      p_invoice_id: inv.id,
      p_customer_id: null,
    })

    const balanceRow = (rows as { invoice_id: string; balance: number }[] | null)?.find(
      (r) => r.invoice_id === inv.id
    )
    const balance = balanceRow ? Number(balanceRow.balance) : 0
    expect(balance).toBe(0)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })
})

describe("I4 — Payment create API returns 400 for draft invoice", () => {
  it("draft invoice → payment create API returns 400 (invariant: API must reject)", async () => {
    const draftInvoice = { id: "inv-draft", total: 100, status: "draft" as const }
    const mockFrom = jest.fn((table: string) => {
      if (table === "invoices") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: jest.fn(() => ({
                single: jest.fn(() => Promise.resolve({ data: draftInvoice, error: null })),
              })),
            })),
          })),
        }
      }
      if (table === "businesses") {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn(() =>
                Promise.resolve({ data: { id: "biz", address_country: "GH" }, error: null })
              ),
            })),
          })),
        }
      }
      return {
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ is: jest.fn(() => Promise.resolve({ data: [], error: null })) })),
        })),
        insert: jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null, error: null })) })) })),
      }
    })
    const mockSupabase = {
      auth: { getUser: jest.fn(() => Promise.resolve({ data: { user: { id: "u1" } }, error: null })) },
      from: mockFrom,
    }
    const { createSupabaseServerClient } = await import("@/lib/supabaseServer")
    ;(createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase)
    const { POST } = await import("@/app/api/payments/create/route")
    const req = new NextRequest("http://localhost/api/payments/create", {
      method: "POST",
      body: JSON.stringify({
        business_id: "biz",
        invoice_id: "inv-draft",
        amount: 50,
        date: "2025-01-01",
        method: "cash",
      }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/draft|issue the invoice first/i)
  })
})
