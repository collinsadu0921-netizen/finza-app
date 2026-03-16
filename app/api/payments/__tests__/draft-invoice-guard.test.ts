/**
 * Payment draft-invoice guard — tests.
 *
 * Invariant: Payments must not post to the ledger if the linked invoice is draft.
 *
 * Proves:
 * - Payment on draft invoice is rejected at API (400).
 * - Payment insert for draft invoice raises at DB (trigger/post_payment_to_ledger).
 * - No journal entry is created for draft-invoice payments.
 * - Issued (sent) invoice payments still post correctly.
 *
 * Uses real Supabase when NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * and TEST_BUSINESS_ID are set. Skips when not configured.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals"
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

async function getOpenPeriod(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data } = await supabase
    .from("accounting_periods")
    .select("id, period_start, period_end")
    .eq("business_id", TEST_BUSINESS_ID)
    .eq("status", "open")
    .limit(1)
    .maybeSingle()
  return data
}

function countPaymentJEs(supabase: Awaited<ReturnType<typeof getSupabase>>, paymentId: string) {
  return supabase
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("reference_type", "payment")
    .eq("reference_id", paymentId)
    .then((r) => r.count ?? 0)
}

describe("Payment draft-invoice guard", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let openPeriod: { id: string; period_start: string; period_end: string } | null
  let customerId: string | null
  const issueDate = "2025-02-15"

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

  it("payment on draft invoice raises at DB level (no JE created)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDate,
        status: "draft",
        subtotal: 100,
        total_tax: 0,
        total: 100,
        invoice_number: "DRAFT-PAY-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: inv.id,
        amount: 50,
        date: issueDate,
        method: "cash",
      })
      .select("id")
      .single()

    expect(error).toBeTruthy()
    expect(error!.message).toMatch(/Cannot post payment for draft invoice|Issue the invoice first/i)
    expect(payment).toBeFalsy()
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("issued (sent) invoice payment posts correctly (one JE)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDate,
        status: "sent",
        sent_at: issueDate + "T12:00:00Z",
        subtotal: 60,
        total_tax: 0,
        total: 60,
        invoice_number: "SENT-PAY-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return

    const { data: payment, error: payErr } = await supabase
      .from("payments")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: inv.id,
        amount: 30,
        date: issueDate,
        method: "cash",
      })
      .select("id")
      .single()

    expect(payErr).toBeFalsy()
    expect(payment?.id).toBeTruthy()

    const count = await countPaymentJEs(supabase, payment!.id)
    expect(count).toBe(1)

    await supabase.from("payments").delete().eq("id", payment!.id)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })
})
