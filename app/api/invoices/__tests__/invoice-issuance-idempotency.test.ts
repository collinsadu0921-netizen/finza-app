/**
 * I3 — AR issuance idempotency invariants.
 *
 * When an invoice transitions to issued (sent | paid | partially_paid):
 * - Exactly one issuance JE exists: Dr AR (gross), Cr Revenue (+ tax lines)
 * - Re-sending or concurrent sends must not double-post
 * - Payment and credit note JEs do not satisfy issuance definition
 *
 * Issuance JE = reference_type=invoice, reference_id=invoice.id, and JE has at least one AR line.
 * Tests fail loudly if double-posting or misclassification regresses. Uses real DB when env set.
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

/** Count issuance JEs: reference_type=invoice, reference_id=invoiceId, JE has at least one AR line. */
async function countIssuanceJEs(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  invoiceId: string
): Promise<number> {
  const arAccountId = await getArAccountId(supabase)
  if (!arAccountId) return 0
  const { data: jes } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("business_id", TEST_BUSINESS_ID!)
    .eq("reference_type", "invoice")
    .eq("reference_id", invoiceId)
  if (!jes?.length) return 0
  const jeIds = jes.map((j) => j.id)
  const { data: lines } = await supabase
    .from("journal_entry_lines")
    .select("journal_entry_id")
    .in("journal_entry_id", jeIds)
    .eq("account_id", arAccountId)
  return [...new Set((lines ?? []).map((l) => l.journal_entry_id))].length
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

describe("I3 — Invoice issuance idempotency", () => {
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

  it("first issuance → exactly one AR issuance JE", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "sent",
        sent_at: openPeriod!.period_start + "T12:00:00Z",
        subtotal: 100,
        total_tax: 0,
        total: 100,
        invoice_number: "ISS-1-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(0)
    const { data: jeId, error } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(error).toBeFalsy()
    expect(jeId).toBeTruthy()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("re-issuing same invoice → same JE id returned (no duplicate)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "sent",
        sent_at: openPeriod!.period_start + "T12:00:00Z",
        subtotal: 50,
        total_tax: 0,
        total: 50,
        invoice_number: "ISS-2-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { data: id1 } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    const { data: id2 } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(id1).toBe(id2)
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("concurrent issuance → one JE only", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "sent",
        sent_at: openPeriod!.period_start + "T12:00:00Z",
        subtotal: 60,
        total_tax: 0,
        total: 60,
        invoice_number: "ISS-3-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const [r1, r2] = await Promise.all([
      supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id }),
      supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id }),
    ])
    expect(r1.error).toBeFalsy()
    expect(r2.error).toBeFalsy()
    expect(r1.data).toBe(r2.data)
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("payment JE does not satisfy issuance definition (issuance count unchanged)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: openPeriod!.period_start,
        status: "sent",
        sent_at: openPeriod!.period_start + "T12:00:00Z",
        subtotal: 70,
        total_tax: 0,
        total: 70,
        invoice_number: "ISS-4-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { data: pay } = await supabase
      .from("payments")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: inv.id,
        amount: 20,
        date: openPeriod!.period_start,
        method: "cash",
      })
      .select("id")
      .single()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(0)
    const { data: jeId } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(jeId).toBeTruthy()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    const { data: jes } = await supabase
      .from("journal_entries")
      .select("id, reference_type")
      .eq("reference_id", inv.id)
    const paymentJe = jes?.find((j) => j.reference_type === "payment")
    expect(paymentJe).toBeDefined()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    if (pay?.id) await supabase.from("payments").delete().eq("id", pay.id)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })
})
