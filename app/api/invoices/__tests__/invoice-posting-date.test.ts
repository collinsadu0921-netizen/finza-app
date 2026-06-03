/**
 * Invoice ledger posting date — issue_date drives journal_entries.date (migration 492).
 * Requires Supabase env + TEST_BUSINESS_ID and migration 492 applied.
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

async function getCustomerId(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("business_id", TEST_BUSINESS_ID!)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function getInvoiceJeDate(
  supabase: Awaited<ReturnType<typeof getSupabase>>,
  invoiceId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("journal_entries")
    .select("date")
    .eq("business_id", TEST_BUSINESS_ID!)
    .eq("reference_type", "invoice")
    .eq("reference_id", invoiceId)
    .maybeSingle()
  return data?.date ?? null
}

describe("post_invoice_to_ledger posting date (issue_date)", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let customerId: string | null
  const createdInvoiceIds: string[] = []

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    customerId = await getCustomerId(supabase)
  })

  afterAll(async () => {
    if (!canRun || !supabase) return
    for (const id of createdInvoiceIds) {
      await supabase.from("invoice_items").delete().eq("invoice_id", id)
      await supabase.from("invoices").delete().eq("id", id)
    }
  })

  it("uses issue_date when sent_at is in a later month (backdated invoice)", async () => {
    if (!canRun || !customerId) return

    const issueDate = "2026-04-16"
    const sentAt = "2026-06-03T14:00:00Z"

    const { data: inv, error: insErr } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDate,
        status: "sent",
        sent_at: sentAt,
        subtotal: 100,
        total_tax: 0,
        total: 100,
        invoice_number: "POSTDATE-BACK-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()

    expect(insErr).toBeFalsy()
    expect(inv?.id).toBeTruthy()
    createdInvoiceIds.push(inv!.id)

    const { data: jeId, error: postErr } = await supabase.rpc("post_invoice_to_ledger", {
      p_invoice_id: inv!.id,
    })
    expect(postErr).toBeFalsy()
    expect(jeId).toBeTruthy()

    const jeDate = await getInvoiceJeDate(supabase, inv!.id)
    expect(jeDate).toBe(issueDate)
    expect(jeDate).not.toBe(sentAt.slice(0, 10))
  })

  it("uses issue_date when issue_date and sent_at share the same month", async () => {
    if (!canRun || !customerId) return

    const issueDate = "2025-02-15"
    const sentAt = issueDate + "T12:00:00Z"

    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDate,
        status: "sent",
        sent_at: sentAt,
        subtotal: 80,
        total_tax: 0,
        total: 80,
        invoice_number: "POSTDATE-SAME-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()

    if (!inv?.id) return
    createdInvoiceIds.push(inv.id)

    const { error: postErr } = await supabase.rpc("post_invoice_to_ledger", {
      p_invoice_id: inv.id,
    })
    expect(postErr).toBeFalsy()

    const jeDate = await getInvoiceJeDate(supabase, inv.id)
    expect(jeDate).toBe(issueDate)
  })

  it("payment journal date still follows payments.date (unchanged)", async () => {
    if (!canRun || !customerId) return

    const issueDate = "2025-02-20"
    const paymentDate = "2025-02-22"

    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDate,
        status: "sent",
        sent_at: issueDate + "T10:00:00Z",
        subtotal: 50,
        total_tax: 0,
        total: 50,
        invoice_number: "POSTDATE-PAY-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()

    if (!inv?.id) return
    createdInvoiceIds.push(inv.id)

    await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })

    const { data: payment, error: payInsErr } = await supabase
      .from("payments")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: inv.id,
        amount: 50,
        date: paymentDate,
        method: "cash",
      })
      .select("id")
      .single()

    expect(payInsErr).toBeFalsy()
    expect(payment?.id).toBeTruthy()

    const { data: payJe } = await supabase
      .from("journal_entries")
      .select("date")
      .eq("business_id", TEST_BUSINESS_ID!)
      .eq("reference_type", "payment")
      .eq("reference_id", payment!.id)
      .maybeSingle()

    expect(payJe?.date).toBe(paymentDate)

    await supabase.from("payments").update({ deleted_at: new Date().toISOString() }).eq("id", payment!.id)
  })
})
