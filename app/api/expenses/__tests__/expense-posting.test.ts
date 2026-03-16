/**
 * Expense posting accounting invariants.
 *
 * 1. Expense insert posts exactly one JE; lines balance.
 * 2. post_expense_to_ledger is idempotent (two calls → one JE).
 * 3. Period guard: posting into locked/soft-closed period fails (INSERT rolls back).
 * 4. COVID deprecated: covid 0 → no COVID tax line; covid > 0 (legacy) → COVID line.
 * 5. Immutability: no UPDATE/DELETE on JE (enforced by DB triggers; we do not bypass).
 *
 * Uses real DB when env is set; skips cleanly otherwise.
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

async function getLockedPeriod(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data } = await supabase
    .from("accounting_periods")
    .select("id, period_start, period_end")
    .eq("business_id", TEST_BUSINESS_ID!)
    .eq("status", "locked")
    .limit(1)
    .maybeSingle()
  return data
}

describe("Expense posting invariants", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let openPeriod: { id: string; period_start: string; period_end: string } | null

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    openPeriod = await getOpenPeriod(supabase)
  })

  it("expense insert posts exactly one JE with balanced lines", async () => {
    if (!canRun || !openPeriod) return
    const { data: expense, error: insertErr } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "Test Supplier " + Date.now(),
        amount: 100,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        total: 100,
        date: openPeriod!.period_start,
      })
      .select("id")
      .single()
    if (insertErr || !expense?.id) {
      expect(insertErr).toBeFalsy()
      return
    }
    const { count } = await supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("reference_type", "expense")
      .eq("reference_id", expense.id)
    expect(count ?? 0).toBe(1)
    const { data: je } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("reference_type", "expense")
      .eq("reference_id", expense.id)
      .single()
    if (!je?.id) return
    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("debit, credit")
      .eq("journal_entry_id", je.id)
    const sumDebit = (lines ?? []).reduce((s, l) => s + Number(l.debit ?? 0), 0)
    const sumCredit = (lines ?? []).reduce((s, l) => s + Number(l.credit ?? 0), 0)
    expect(Math.abs(sumDebit - sumCredit)).toBeLessThan(0.02)
    // Do not delete: expense is posted, so DELETE is now blocked by governance trigger
  })

  it("post_expense_to_ledger is idempotent (two calls → one JE)", async () => {
    if (!canRun || !openPeriod) return
    const { data: expense, error: insertErr } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "Idempotent Supplier " + Date.now(),
        amount: 50,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        total: 50,
        date: openPeriod!.period_start,
      })
      .select("id")
      .single()
    if (insertErr || !expense?.id) {
      expect(insertErr).toBeFalsy()
      return
    }
    const { error: rpc1 } = await supabase.rpc("post_expense_to_ledger", {
      p_expense_id: expense.id,
    })
    const { error: rpc2 } = await supabase.rpc("post_expense_to_ledger", {
      p_expense_id: expense.id,
    })
    expect(rpc1).toBeFalsy()
    expect(rpc2).toBeFalsy()
    const { count } = await supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("reference_type", "expense")
      .eq("reference_id", expense.id)
    expect(count ?? 0).toBe(1)
    // Do not delete: expense is posted, so DELETE is now blocked by governance trigger
  })

  it("expense date in locked period → INSERT fails (no expense row)", async () => {
    if (!canRun) return
    const locked = await getLockedPeriod(supabase)
    if (!locked) return
    const { data: _expense, error } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "Locked Period Test " + Date.now(),
        amount: 10,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        total: 10,
        date: locked.period_start,
      })
      .select("id")
      .single()
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(
      /Cannot modify expenses in a closed or locked|period|locked|soft-closed/i
    )
  })

  it("expense with covid 0 → no COVID tax line in JE", async () => {
    if (!canRun || !openPeriod) return
    const { data: expense, error: insertErr } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "No COVID " + Date.now(),
        amount: 100,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        total: 100,
        date: openPeriod!.period_start,
      })
      .select("id")
      .single()
    if (insertErr || !expense?.id) {
      expect(insertErr).toBeFalsy()
      return
    }
    const { data: je } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("reference_type", "expense")
      .eq("reference_id", expense.id)
      .single()
    if (!je?.id) return
    const { data: linesWithDesc } = await supabase
      .from("journal_entry_lines")
      .select("id, description")
      .eq("journal_entry_id", je.id)
    const covidCount = (linesWithDesc ?? []).filter(
      (l) => l.description && /COVID|covid/i.test(l.description)
    ).length
    expect(covidCount).toBe(0)
    // Do not delete: expense is posted
  })

  it("legacy expense with covid > 0 → COVID tax line exists", async () => {
    if (!canRun || !openPeriod) return
    const { data: expense, error: insertErr } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "Legacy COVID " + Date.now(),
        amount: 100,
        nhil: 0,
        getfund: 0,
        covid: 1,
        vat: 0,
        total: 101,
        date: openPeriod!.period_start,
      })
      .select("id")
      .single()
    if (insertErr || !expense?.id) {
      expect(insertErr).toBeFalsy()
      return
    }
    const { data: je } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("reference_type", "expense")
      .eq("reference_id", expense.id)
      .single()
    if (!je?.id) return
    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("id, description")
      .eq("journal_entry_id", je.id)
    const covidCount = (lines?.filter((l) => l.description && /COVID|covid/i.test(l.description)) ?? []).length
    expect(covidCount).toBeGreaterThanOrEqual(1)
    // Do not delete: expense is posted
  })
})

describe("Expense governance (freeze after posting, closed period)", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let openPeriod: { id: string; period_start: string; period_end: string } | null

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    openPeriod = await getOpenPeriod(supabase)
  })

  it("posted expense → UPDATE blocked with immutable error", async () => {
    if (!canRun || !openPeriod) return
    const { data: expense, error: insertErr } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "Governance Update Test " + Date.now(),
        amount: 25,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        total: 25,
        date: openPeriod!.period_start,
      })
      .select("id")
      .single()
    if (insertErr || !expense?.id) {
      expect(insertErr).toBeFalsy()
      return
    }
    const { count } = await supabase
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("reference_type", "expense")
      .eq("reference_id", expense.id)
    expect(count ?? 0).toBe(1)
    const { error: updateErr } = await supabase
      .from("expenses")
      .update({ supplier: "Updated", amount: 30, total: 30 })
      .eq("id", expense.id)
    expect(updateErr).toBeTruthy()
    expect(String(updateErr?.message ?? "")).toMatch(/Posted expenses are immutable|immutable/i)
  })

  it("posted expense → DELETE blocked with immutable error", async () => {
    if (!canRun || !openPeriod) return
    const { data: expense, error: insertErr } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "Governance Delete Test " + Date.now(),
        amount: 15,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        total: 15,
        date: openPeriod!.period_start,
      })
      .select("id")
      .single()
    if (insertErr || !expense?.id) {
      expect(insertErr).toBeFalsy()
      return
    }
    const { error: deleteErr } = await supabase.from("expenses").delete().eq("id", expense.id)
    expect(deleteErr).toBeTruthy()
    expect(String(deleteErr?.message ?? "")).toMatch(/Posted expenses are immutable|immutable/i)
  })

  it("expense in closed/locked period → INSERT fails with period error", async () => {
    if (!canRun) return
    const locked = await getLockedPeriod(supabase)
    if (!locked) return
    const { error } = await supabase
      .from("expenses")
      .insert({
        business_id: TEST_BUSINESS_ID,
        supplier: "Closed Period " + Date.now(),
        amount: 10,
        nhil: 0,
        getfund: 0,
        covid: 0,
        vat: 0,
        total: 10,
        date: locked.period_start,
      })
      .select("id")
      .single()
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "")).toMatch(
      /Cannot modify expenses in a closed or locked|period|locked|soft-closed/i
    )
  })
})
