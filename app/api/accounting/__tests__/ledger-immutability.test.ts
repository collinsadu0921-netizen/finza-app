/**
 * I6 — Ledger immutability smoke tests.
 *
 * journal_entries and journal_entry_lines cannot be updated or deleted.
 * All corrections must be new JEs only. Tests fail loudly if immutability is loosened.
 *
 * Uses real DB when env set; skips otherwise.
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

describe("I6 — Ledger immutability", () => {
  let supabase: Awaited<ReturnType<typeof getSupabase>>
  let existingJeId: string | null
  let existingLineId: string | null

  beforeAll(async () => {
    if (!canRun) return
    supabase = await getSupabase()
    const { data: je } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .limit(1)
      .maybeSingle()
    existingJeId = je?.id ?? null
    if (existingJeId) {
      const { data: line } = await supabase
        .from("journal_entry_lines")
        .select("id")
        .eq("journal_entry_id", existingJeId)
        .limit(1)
        .maybeSingle()
      existingLineId = line?.id ?? null
    } else {
      existingLineId = null
    }
  })

  it("UPDATE journal_entries → throws (immutability: no updates)", async () => {
    if (!canRun || !existingJeId) return
    const { error } = await supabase
      .from("journal_entries")
      .update({ description: "mutated" })
      .eq("id", existingJeId)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "").toLowerCase()).toMatch(/update|delete|denied|policy|permission|immutab/i)
  })

  it("DELETE journal_entry_lines → throws (immutability: no deletes)", async () => {
    if (!canRun || !existingLineId) return
    const { error } = await supabase
      .from("journal_entry_lines")
      .delete()
      .eq("id", existingLineId)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? "").toLowerCase()).toMatch(/delete|denied|policy|permission|immutab/i)
  })

  it("INSERT reversal JE succeeds (corrections are new JEs only)", async () => {
    if (!canRun) return
    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, period_start")
      .eq("business_id", TEST_BUSINESS_ID!)
      .eq("status", "open")
      .limit(1)
      .maybeSingle()
    if (!period) return
    const { data: arMap } = await supabase
      .from("chart_of_accounts_control_map")
      .select("account_code")
      .eq("business_id", TEST_BUSINESS_ID!)
      .eq("control_key", "AR")
      .maybeSingle()
    if (!arMap?.account_code) return
    const { data: arAcc } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .eq("code", arMap.account_code)
      .is("deleted_at", null)
      .maybeSingle()
    if (!arAcc?.id) return
    const { data: cashAcc } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", TEST_BUSINESS_ID!)
      .eq("code", "1000")
      .is("deleted_at", null)
      .maybeSingle()
    if (!cashAcc?.id) return
    const amount = 0.01
    const { data: jeId, error } = await supabase.rpc("post_journal_entry", {
      p_business_id: TEST_BUSINESS_ID,
      p_date: period.period_start,
      p_description: "I6 smoke: reversal-style JE (new JE only)",
      p_reference_type: "adjustment",
      p_reference_id: null,
      p_lines: [
        { account_id: arAcc.id, debit: amount, credit: 0, description: "AR" },
        { account_id: cashAcc.id, debit: 0, credit: amount, description: "Cash" },
      ],
      p_is_adjustment: true,
      p_adjustment_reason: "I6 invariant test: insert new JE",
      p_adjustment_ref: null,
      p_created_by: null,
      p_entry_type: null,
      p_backfill_reason: null,
      p_backfill_actor: null,
      p_posted_by_accountant_id: null,
      p_posting_source: "accountant",
    })
    expect(error).toBeFalsy()
    expect(jeId).toBeTruthy()
  })
})
