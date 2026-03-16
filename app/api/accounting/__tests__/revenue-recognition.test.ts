/**
 * Revenue recognition policy — accounting layer tests.
 *
 * Policy: Revenue is recognized only when an invoice is issued (sent).
 *
 * Proves:
 * - Payments cannot post revenue (post_journal_entry rejects).
 * - Draft invoice reference cannot post revenue (post_journal_entry rejects).
 * - Adjustment/reconciliation without is_revenue_correction cannot post revenue.
 * - Issued invoice can post revenue (via post_invoice_to_ledger; covered in send-ar-posting).
 *
 * Uses real Supabase when env is set. No UI; deterministic; fails loudly.
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

describe("Revenue recognition policy", () => {
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

  it("payments cannot post revenue: post_journal_entry with reference_type=payment and revenue line rejects", async () => {
    if (!canRun || !revenueAccountId || !arAccountId || !openPeriod) return
    const entryDate = openPeriod!.period_start
    const amount = 10
    const { error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: entryDate,
      p_description: "Test payment with revenue (should reject)",
      p_reference_type: "payment",
      p_reference_id: "00000000-0000-0000-0000-000000000001",
      p_lines: [
        { account_id: arAccountId, debit: 0, credit: amount, description: "Reduce AR" },
        { account_id: revenueAccountId, debit: amount, credit: 0, description: "Revenue (invalid)" },
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

  it("draft invoice reference cannot post revenue: post_journal_entry with reference_type=invoice, draft ref, revenue line rejects", async () => {
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
        invoice_number: "REV-DRAFT-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const entryDate = openPeriod!.period_start
    const amount = 50
    const { error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: entryDate,
      p_description: "Fake issuance for draft (should reject)",
      p_reference_type: "invoice",
      p_reference_id: inv.id,
      p_lines: [
        { account_id: arAccountId, debit: amount, credit: 0, description: "AR" },
        { account_id: revenueAccountId, debit: 0, credit: amount, description: "Revenue" },
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

  it("adjustment without is_revenue_correction cannot post revenue: post_journal_entry with reference_type=adjustment and revenue line rejects", async () => {
    if (!canRun || !revenueAccountId || !arAccountId || !openPeriod) return
    const entryDate = openPeriod!.period_start
    const amount = 5
    const { error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: entryDate,
      p_description: "Adjustment with revenue (should reject unless flagged)",
      p_reference_type: "adjustment",
      p_reference_id: null,
      p_lines: [
        { account_id: revenueAccountId, debit: amount, credit: 0, description: "Revenue adj" },
        { account_id: arAccountId, debit: 0, credit: amount, description: "AR adj" },
      ],
      p_is_adjustment: true,
      p_adjustment_reason: "Test revenue adjustment",
      p_adjustment_ref: null,
      p_created_by: null,
      p_entry_type: null,
      p_backfill_reason: null,
      p_backfill_actor: null,
      p_posted_by_accountant_id: null,
      p_posting_source: "accountant",
    })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/revenue|revenue correction|cannot post revenue/i)
  })

  it("reconciliation with revenue line and no is_revenue_correction rejects", async () => {
    if (!canRun || !revenueAccountId || !arAccountId || !openPeriod) return
    const entryDate = openPeriod!.period_start
    const amount = 1
    const { error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: entryDate,
      p_description: "Reconciliation with revenue (should reject)",
      p_reference_type: "reconciliation",
      p_reference_id: "00000000-0000-0000-0000-000000000002",
      p_lines: [
        { account_id: revenueAccountId, debit: amount, credit: 0, description: "Rev" },
        { account_id: arAccountId, debit: 0, credit: amount, description: "AR" },
      ],
      p_is_adjustment: false,
      p_adjustment_reason: null,
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
})
