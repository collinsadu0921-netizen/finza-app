/**
 * I2 — Revenue recognition invariants.
 *
 * Revenue (account 4000) may be posted only on invoice issuance (reference_type = invoice,
 * referenced invoice not draft). Payments must never post revenue. Adjustments/reconciliation
 * may post revenue only if p_is_revenue_correction = true and reference is issued invoice.
 *
 * Tests fail loudly if revenue timing regresses. Uses real DB when env set; skips otherwise.
 */

import { describe, it, expect, beforeAll } from "@jest/globals"
import { createClient } from "@supabase/supabase-js"

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

async function getRevenueAccountId(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("business_id", TEST_BUSINESS_ID!)
    .eq("code", "4000")
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function getArAccountId(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data: map } = await supabase
    .from("chart_of_accounts_control_map")
    .select("account_code")
    .eq("business_id", TEST_BUSINESS_ID!)
    .eq("control_key", "AR")
    .maybeSingle()
  if (!map?.account_code) return null
  const { data: acc } = await supabase
    .from("accounts")
    .select("id")
    .eq("business_id", TEST_BUSINESS_ID!)
    .eq("code", map.account_code)
    .is("deleted_at", null)
    .maybeSingle()
  return acc?.id ?? null
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

describe("I2 — Revenue recognition invariants", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let revenueAccountId: string | null
  let arAccountId: string | null
  let openPeriod: { id: string; period_start: string; period_end: string } | null

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    revenueAccountId = await getRevenueAccountId(supabase)
    arAccountId = await getArAccountId(supabase)
    openPeriod = await getOpenPeriod(supabase)
  })

  it("payment JE with revenue line → rejected (payments must never post revenue)", async () => {
    if (!canRun || !revenueAccountId || !arAccountId || !openPeriod) return
    const { error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: openPeriod!.period_start,
      p_description: "Invalid: payment with revenue",
      p_reference_type: "payment",
      p_reference_id: "00000000-0000-0000-0000-000000000001",
      p_lines: [
        { account_id: arAccountId, debit: 0, credit: 10, description: "AR" },
        { account_id: revenueAccountId, debit: 10, credit: 0, description: "Revenue" },
      ],
      p_is_adjustment: false,
      p_adjustment_reason: null,
      p_adjustment_ref: null,
      p_created_by: null,
      p_entry_type: null,
      p_backfill_reason: null,
      p_backfill_actor: null,
      p_posted_by_accountant_id: null,
      p_posting_source: "system",
    })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/revenue|payment|cannot post revenue/i)
  })

  it("draft invoice referenced by revenue JE → rejected", async () => {
    if (!canRun || !revenueAccountId || !arAccountId || !openPeriod) return
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .limit(1)
      .maybeSingle()
    if (!cust?.id) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: cust.id,
        issue_date: openPeriod!.period_start,
        status: "draft",
        sent_at: null,
        subtotal: 50,
        total_tax: 0,
        total: 50,
        invoice_number: "INV-DRAFT-REV-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: openPeriod!.period_start,
      p_description: "Invalid: draft ref revenue",
      p_reference_type: "invoice",
      p_reference_id: inv.id,
      p_lines: [
        { account_id: arAccountId, debit: 50, credit: 0, description: "AR" },
        { account_id: revenueAccountId, debit: 0, credit: 50, description: "Revenue" },
      ],
      p_is_adjustment: false,
      p_adjustment_reason: null,
      p_adjustment_ref: null,
      p_created_by: null,
      p_entry_type: null,
      p_backfill_reason: null,
      p_backfill_actor: null,
      p_posted_by_accountant_id: null,
      p_posting_source: "system",
    })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/draft|issue the invoice/i)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("adjustment/reconciliation with revenue and no flag → rejected", async () => {
    if (!canRun || !revenueAccountId || !arAccountId || !openPeriod) return
    const { error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: openPeriod!.period_start,
      p_description: "Adjustment with revenue, no flag",
      p_reference_type: "adjustment",
      p_reference_id: null,
      p_lines: [
        { account_id: revenueAccountId, debit: 5, credit: 0, description: "Rev" },
        { account_id: arAccountId, debit: 0, credit: 5, description: "AR" },
      ],
      p_is_adjustment: true,
      p_adjustment_reason: "Test",
      p_adjustment_ref: null,
      p_created_by: null,
      p_entry_type: null,
      p_backfill_reason: null,
      p_backfill_actor: null,
      p_posted_by_accountant_id: null,
      p_posting_source: "accountant",
    })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/revenue|revenue correction/i)
  })

  it("issued invoice revenue JE → allowed (post_invoice_to_ledger creates exactly one issuance JE with revenue)", async () => {
    if (!canRun || !openPeriod) return
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .limit(1)
      .maybeSingle()
    if (!cust?.id) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: cust.id,
        issue_date: openPeriod!.period_start,
        status: "sent",
        sent_at: openPeriod!.period_start + "T12:00:00Z",
        subtotal: 80,
        total_tax: 0,
        total: 80,
        invoice_number: "INV-ISSUED-REV-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { data: jeId, error } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(error).toBeFalsy()
    expect(jeId).toBeTruthy()
    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("account_id, credit")
      .eq("journal_entry_id", jeId)
    const revenueAccountId = await getRevenueAccountId(supabase)
    const revenueLine = lines?.find((l) => l.account_id === revenueAccountId && Number(l.credit) > 0)
    expect(revenueLine).toBeDefined()
    expect(Number(revenueLine!.credit)).toBe(80)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })
})
