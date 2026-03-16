/**
 * Accrual AR posting at invoice finalisation — tests.
 *
 * Idempotency guard: posting is exactly-once per invoice (ledger truth =
 * journal entries with reference_type='invoice', reference_id=invoice.id,
 * and at least one AR control account line). Resends, retries, and concurrent
 * requests must never double-post.
 *
 * Proves:
 * - First send: no prior JE → exactly one AR issuance JE created.
 * - Resend/retry: same invoice → no additional JE (idempotency).
 * - Concurrent sends: two requests → still exactly one JE.
 * - Payment exists: payment JE does NOT count as issuance → AR issuance posts once.
 * - Credit note exists: credit note JE does NOT count as issuance → AR issuance posts once.
 * - Closed/locked period: posting blocked (4xx-level error).
 *
 * Uses real Supabase when NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are set. Skips when not configured.
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

async function getLockedPeriod(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data } = await supabase
    .from("accounting_periods")
    .select("id, period_start, period_end")
    .eq("business_id", TEST_BUSINESS_ID)
    .eq("status", "locked")
    .limit(1)
    .maybeSingle()
  return data
}

async function getArAccountId(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data: map } = await supabase
    .from("chart_of_accounts_control_map")
    .select("account_code")
    .eq("business_id", TEST_BUSINESS_ID)
    .eq("control_key", "AR")
    .maybeSingle()
  if (!map?.account_code) return null
  const { data: acc } = await supabase
    .from("chart_of_accounts")
    .select("id")
    .eq("business_id", TEST_BUSINESS_ID)
    .eq("code", map.account_code)
    .maybeSingle()
  return acc?.id ?? null
}

/** Count issuance JEs for an invoice: reference_type=invoice, reference_id=invoiceId, and JE has at least one AR line. */
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
  const distinctJeIds = [...new Set((lines ?? []).map((l) => l.journal_entry_id))]
  return distinctJeIds.length
}

describe("Accrual AR posting at invoice finalisation", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let openPeriod: { id: string; period_start: string; period_end: string } | null
  let lockedPeriod: { id: string; period_start: string; period_end: string } | null
  let customerId: string | null
  let draftInvoiceId: string
  const subtotal = 100
  const totalTax = 0
  const total = 100
  const issueDateOpen = "2025-02-15"
  const issueDateLocked = "2024-12-15"

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    openPeriod = await getOpenPeriod(supabase)
    lockedPeriod = await getLockedPeriod(supabase)
    const { data: cust } = await supabase
      .from("customers")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .limit(1)
      .maybeSingle()
    customerId = cust?.id ?? null
  })

  afterAll(async () => {
    if (!canRun || !supabase) return
    if (draftInvoiceId) {
      await supabase.from("invoice_items").delete().eq("invoice_id", draftInvoiceId)
      await supabase.from("invoices").delete().eq("id", draftInvoiceId)
    }
    // Ledger is append-only; do not delete journal_entries.
  })

  it("first send: no prior JE → exactly one AR issuance JE is created", async () => {
    if (!canRun || !openPeriod || !customerId) return
    // Revenue recognition: only issued (sent) invoices may post; draft cannot post
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateOpen,
        status: "sent",
        sent_at: issueDateOpen + "T12:00:00Z",
        subtotal: 80,
        total_tax: 0,
        total: 80,
        invoice_number: "FIRST-" + Date.now(),
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

  it.skip("when invoice transitions draft->sent, exactly one JE is created with AR debit and Revenue credit", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv, error: insErr } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateOpen,
        status: "draft",
        subtotal,
        total_tax: totalTax,
        total,
        invoice_number: "TEST-AR-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    expect(insErr).toBeFalsy()
    expect(inv?.id).toBeTruthy()
    draftInvoiceId = inv!.id

    const { data: num } = await supabase.rpc("generate_invoice_number_with_settings", {
      business_uuid: TEST_BUSINESS_ID,
    })
    await supabase
      .from("invoices")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        invoice_number: num || "T-" + draftInvoiceId.slice(0, 8),
      })
      .eq("id", draftInvoiceId)

    const { data: jes } = await supabase
      .from("journal_entries")
      .select("id, reference_type, reference_id, date")
      .eq("business_id", TEST_BUSINESS_ID)
      .eq("reference_type", "invoice")
      .eq("reference_id", draftInvoiceId)
    expect(jes?.length).toBe(1)
    expect(jes![0].reference_type).toBe("invoice")
    expect(jes![0].reference_id).toBe(draftInvoiceId)

    const arAccountId = await getArAccountId(supabase)
    expect(arAccountId).toBeTruthy()
    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("account_id, debit, credit")
      .eq("journal_entry_id", jes![0].id)
    const arLine = lines?.find((l) => l.account_id === arAccountId)
    expect(arLine).toBeDefined()
    expect(Number(arLine!.debit)).toBe(total)
    const revLine = lines?.find((l) => l.credit && Number(l.credit) > 0 && l.account_id !== arAccountId)
    expect(revLine).toBeDefined()
    expect(Number(revLine!.credit)).toBe(subtotal)
  })

  it.skip("resend / repeated send does not create a second JE", async () => {
    if (!canRun || !draftInvoiceId) return
    const { count: before } = await supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("business_id", TEST_BUSINESS_ID)
      .eq("reference_type", "invoice")
      .eq("reference_id", draftInvoiceId)
    await supabase
      .from("invoices")
      .update({ sent_at: new Date().toISOString() })
      .eq("id", draftInvoiceId)
    const { count: after } = await supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("business_id", TEST_BUSINESS_ID)
      .eq("reference_type", "invoice")
      .eq("reference_id", draftInvoiceId)
    expect(after).toBe(before)
  })

  it.skip("payment posting reduces AR correctly (AR balance = total - payments - credits)", async () => {
    if (!canRun || !draftInvoiceId) return
    const { data: pay, error: payErr } = await supabase
      .from("payments")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: draftInvoiceId,
        amount: 40,
        date: issueDateOpen,
        method: "cash",
      })
      .select("id")
      .single()
    expect(payErr).toBeFalsy()
    const { data: bal } = await supabase.rpc("get_ar_balances_by_invoice", {
      p_business_id: TEST_BUSINESS_ID,
      p_period_id: openPeriod!.id,
      p_invoice_id: draftInvoiceId,
    })
    const row = (bal as { invoice_id: string; balance: number }[] | null)?.find((r) => r.invoice_id === draftInvoiceId)
    expect(row).toBeDefined()
    expect(Math.abs(Number(row!.balance) - (total - 40))).toBeLessThan(0.01)
    if (pay?.id) await supabase.from("payments").delete().eq("id", pay.id)
  })

  it("resend/retry: same invoice → no additional JE (idempotency)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateOpen,
        status: "sent",
        sent_at: issueDateOpen + "T12:00:00Z",
        subtotal: 50,
        total_tax: 0,
        total: 50,
        invoice_number: "IDEM-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const id1 = (await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })).data as string | null
    const id2 = (await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })).data as string | null
    expect(id1).toBeTruthy()
    expect(id2).toBe(id1)
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("concurrent sends: two requests → still exactly one JE", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateOpen,
        status: "sent",
        sent_at: issueDateOpen + "T12:00:00Z",
        subtotal: 60,
        total_tax: 0,
        total: 60,
        invoice_number: "CONC-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const [res1, res2] = await Promise.all([
      supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id }),
      supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id }),
    ])
    const id1 = res1.data as string | null
    const id2 = res2.data as string | null
    expect(res1.error).toBeFalsy()
    expect(res2.error).toBeFalsy()
    expect(id1).toBeTruthy()
    expect(id2).toBe(id1)
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("payment exists: payment JE does not count as issuance → AR issuance still posts once", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateOpen,
        status: "sent",
        sent_at: issueDateOpen + "T12:00:00Z",
        subtotal: 70,
        total_tax: 0,
        total: 70,
        invoice_number: "PAY-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { data: pay, error: payErr } = await supabase
      .from("payments")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: inv.id,
        amount: 20,
        date: issueDateOpen,
        method: "cash",
      })
      .select("id")
      .single()
    expect(payErr).toBeFalsy()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(0)
    const { data: jeId, error } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(error).toBeFalsy()
    expect(jeId).toBeTruthy()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    if (pay?.id) await supabase.from("payments").delete().eq("id", pay.id)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("credit note exists: credit note JE does not count as issuance → AR issuance still posts once", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateOpen,
        status: "sent",
        sent_at: issueDateOpen + "T12:00:00Z",
        subtotal: 90,
        total_tax: 0,
        total: 90,
        invoice_number: "CN-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { data: cn, error: cnErr } = await supabase
      .from("credit_notes")
      .insert({
        business_id: TEST_BUSINESS_ID,
        invoice_id: inv.id,
        credit_number: "CN-TEST-" + Date.now(),
        date: issueDateOpen,
        subtotal: 10,
        total_tax: 0,
        total: 10,
        status: "issued",
        tax_lines: { lines: [], meta: {} },
      })
      .select("id")
      .single()
    expect(cnErr).toBeFalsy()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(0)
    const { data: jeId, error } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(error).toBeFalsy()
    expect(jeId).toBeTruthy()
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(1)
    if (cn?.id) await supabase.from("credit_notes").delete().eq("id", cn.id)
    await supabase.from("invoice_items").delete().eq("invoice_id", inv.id)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("post_invoice_to_ledger blocks when invoice date falls in locked period", async () => {
    if (!canRun || !lockedPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateLocked,
        status: "sent",
        sent_at: issueDateLocked + "T12:00:00Z",
        subtotal: 10,
        total_tax: 0,
        total: 10,
        invoice_number: "LOCK-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { error } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/locked|blocked|soft.closed/i)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })

  it("draft invoice: post_invoice_to_ledger raises (revenue recognition — draft cannot post)", async () => {
    if (!canRun || !openPeriod || !customerId) return
    const { data: inv } = await supabase
      .from("invoices")
      .insert({
        business_id: TEST_BUSINESS_ID,
        customer_id: customerId,
        issue_date: issueDateOpen,
        status: "draft",
        sent_at: issueDateOpen + "T12:00:00Z",
        subtotal: 50,
        total_tax: 0,
        total: 50,
        invoice_number: "DRAFT-NOPOST-" + Date.now(),
        tax_lines: { lines: [], meta: {}, pricing_mode: "inclusive" },
      })
      .select("id")
      .single()
    if (!inv?.id) return
    const { error } = await supabase.rpc("post_invoice_to_ledger", { p_invoice_id: inv.id })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(/draft|issue the invoice/i)
    expect(await countIssuanceJEs(supabase, inv.id)).toBe(0)
    await supabase.from("invoices").delete().eq("id", inv.id)
  })
})
