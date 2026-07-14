/**
 * Staging-only Phase 1A depreciation validation (project adonhhtooawkeemdqqeo).
 *
 *   node scripts/staging-validate-phase1a-depreciation.mjs
 *   node scripts/staging-validate-phase1a-depreciation.mjs --apply-527 --database-url=postgresql://...
 *
 * Requires migration 526 on staging. Optionally applies 527 when STAGING_DATABASE_URL
 * or --database-url is provided (must contain staging ref adonhhtooawkeemdqqeo).
 */
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")

const STAGING_REF = "adonhhtooawkeemdqqeo"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const LOAD_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE2MTY4MCwiZXhwIjoyMDk3NzM3NjgwfQ.kX4ycRl6QBs77Nro5e_uXVj9es75VgYS59XTFvPWFnY"

const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjE2ODAsImV4cCI6MjA5NzczNzY4MH0.gteoKZMizYHZgxbsiFsNfrb-1CI8Mh8Yps5nuX4xjkc"

const LOAD_EMAIL = "staging@test.com"

const results = {
  migration526Present: false,
  migration527Applied: false,
  tests: [],
  diagnostics: null,
  assetId: null,
  entryId: null,
  journalEntryId: null,
}

function argValue(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.split("=").slice(1).join("=").trim() : fallback
}

function fail(msg) {
  console.error(`\n[phase1a-validate] FATAL: ${msg}\n`)
  process.exit(1)
}

function assertStagingOnly(urlOrConn) {
  const s = String(urlOrConn || STAGING_URL)
  if (!s.includes(STAGING_REF)) fail(`Refusing: must target staging ref ${STAGING_REF}`)
  if (s.includes(PRODUCTION_REF)) fail("Refusing production Supabase ref")
}

function record(name, pass, detail = "") {
  results.tests.push({ name, pass, detail })
  const icon = pass ? "PASS" : "FAIL"
  console.log(`  [${icon}] ${name}${detail ? `: ${detail}` : ""}`)
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

async function mintUserSession() {
  const genRes = await fetch(`${STAGING_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: LOAD_EMAIL }),
  })
  if (!genRes.ok) fail(`generate_link failed: ${genRes.status}`)
  const link = await genRes.json()
  if (!link.email_otp) fail("generate_link missing email_otp")

  const verifyRes = await fetch(`${STAGING_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", email: LOAD_EMAIL, token: link.email_otp }),
  })
  if (!verifyRes.ok) fail(`verify failed: ${verifyRes.status}`)
  const session = await verifyRes.json()
  if (!session.access_token) fail("verify missing access_token")
  return session
}

async function applyMigration527(databaseUrl) {
  assertStagingOnly(databaseUrl)
  const sqlPath = resolve(REPO_ROOT, "supabase/migrations/527_asset_depreciation_phase1a_safety_corrections.sql")
  const sql = readFileSync(sqlPath, "utf8")
  let pg
  try {
    pg = (await import("pg")).default
  } catch {
    fail("pg module not installed; run npm install pg for --apply-527")
  }
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    results.migration527Applied = true
    console.log("[phase1a-validate] Applied migration 527 to staging")
  } finally {
    await client.end()
  }
}

async function probeRpcs(sb) {
  const { error } = await sb.rpc("post_asset_depreciation", {
    p_asset_id: "00000000-0000-0000-0000-000000000001",
    p_posting_date: "2024-01-01",
  })
  results.migration526Present = !error?.message?.includes("Could not find the function")
  record("migration 526 RPC present", results.migration526Present, error?.message || "ok")
}

async function runReadOnlyDiagnostics(adminSb, businessId) {
  const issues = []

  const { data: incomplete } = await adminSb
    .from("depreciation_entries")
    .select("id,asset_id,business_id,date,amount,status")
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .is("journal_entry_id", null)
    .in("status", ["posted", "adjusted"])

  for (const row of incomplete || []) {
    issues.push({ issue_type: "incomplete_entry", ...row })
  }

  const { data: assets } = await adminSb
    .from("assets")
    .select("id,business_id,purchase_amount,salvage_value,accumulated_depreciation,current_value")
    .eq("business_id", businessId)
    .is("deleted_at", null)

  for (const asset of assets || []) {
    const { data: entries } = await adminSb
      .from("depreciation_entries")
      .select("amount")
      .eq("asset_id", asset.id)
      .is("deleted_at", null)
      .in("status", ["posted", "adjusted"])

    const entriesSum = round2((entries || []).reduce((s, e) => s + Number(e.amount), 0))
    const registerAccum = round2(Number(asset.accumulated_depreciation))
    if (Math.abs(registerAccum - entriesSum) > 0.01) {
      issues.push({
        issue_type: "register_accum_mismatch",
        asset_id: asset.id,
        register_accumulated_depreciation: registerAccum,
        entries_sum: entriesSum,
        difference: round2(registerAccum - entriesSum),
      })
    }

    const expectedCurrent = round2(Math.max(Number(asset.salvage_value || 0), Number(asset.purchase_amount) - entriesSum))
    const registerCurrent = round2(Number(asset.current_value))
    if (Math.abs(registerCurrent - expectedCurrent) > 0.01) {
      issues.push({
        issue_type: "carrying_value_mismatch",
        asset_id: asset.id,
        register_current_value: registerCurrent,
        expected_current_value: expectedCurrent,
        difference: round2(registerCurrent - expectedCurrent),
      })
    }
  }

  const { data: postedWithJe } = await adminSb
    .from("depreciation_entries")
    .select("id,asset_id,business_id,amount,journal_entry_id")
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .not("journal_entry_id", "is", null)
    .in("status", ["posted", "adjusted"])

  for (const entry of postedWithJe || []) {
    const { data: lines } = await adminSb
      .from("journal_entry_lines")
      .select("debit,credit")
      .eq("journal_entry_id", entry.journal_entry_id)

    const dr = round2((lines || []).reduce((s, l) => s + Number(l.debit), 0))
    const cr = round2((lines || []).reduce((s, l) => s + Number(l.credit), 0))
    const amount = round2(Number(entry.amount))
    if (Math.abs(amount - dr) > 0.01 || Math.abs(amount - cr) > 0.01) {
      issues.push({
        issue_type: "journal_amount_mismatch",
        asset_id: entry.asset_id,
        depreciation_entry_id: entry.id,
        entry_amount: amount,
        journal_debit: dr,
        journal_credit: cr,
      })
    }
  }

  results.diagnostics = { business_id: businessId, issue_count: issues.length, issues }
  record("reconciliation diagnostics (read-only)", true, `issue_count=${issues.length}`)
  return issues
}

async function fetchDepreciationExpenseTotal(adminSb, businessId, periodStart, periodEnd) {
  const { data: acct } = await adminSb
    .from("accounts")
    .select("id")
    .eq("business_id", businessId)
    .eq("code", "5700")
    .is("deleted_at", null)
    .maybeSingle()
  if (!acct?.id) return null

  const { data: lines } = await adminSb
    .from("journal_entry_lines")
    .select("debit,credit,journal_entries!inner(date,business_id)")
    .eq("account_id", acct.id)
    .eq("journal_entries.business_id", businessId)
    .gte("journal_entries.date", periodStart)
    .lte("journal_entries.date", periodEnd)

  return round2((lines || []).reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0))
}

async function softClosePeriod(adminSb, businessId, periodStart) {
  await adminSb.from("accounting_periods").upsert(
    { business_id: businessId, period_start: periodStart, status: "open" },
    { onConflict: "business_id,period_start" }
  )
  const { data, error } = await adminSb
    .from("accounting_periods")
    .update({ status: "soft_closed" })
    .eq("business_id", businessId)
    .eq("period_start", periodStart)
    .select("status")
    .single()
  if (error) throw new Error(`soft-close period failed: ${error.message}`)
  return data?.status
}

async function reopenPeriod(adminSb, businessId, periodStart) {
  await adminSb
    .from("accounting_periods")
    .update({ status: "open" })
    .eq("business_id", businessId)
    .eq("period_start", periodStart)
}

async function createTestAsset(sb, businessId) {
  const purchaseAmount = 12000
  const salvage = 0
  const usefulLife = 5
  const purchaseDate = "2026-06-01"
  const monthlyDep = round2((purchaseAmount - salvage) / (usefulLife * 12))

  const { data: asset, error } = await sb
    .from("assets")
    .insert({
      business_id: businessId,
      name: `Phase1A Validate ${new Date().toISOString()}`,
      category: "equipment",
      purchase_date: purchaseDate,
      purchase_amount: purchaseAmount,
      useful_life_years: usefulLife,
      salvage_value: salvage,
      current_value: purchaseAmount,
      accumulated_depreciation: 0,
      status: "active",
    })
    .select("id")
    .single()

  if (error) fail(`Create asset failed: ${error.message}`)
  results.assetId = asset.id

  const { data: jeId, error: acqErr } = await sb.rpc("post_asset_purchase_to_ledger", {
    p_asset_id: asset.id,
    p_payment_account_id: null,
  })
  if (acqErr) fail(`Acquisition post failed: ${acqErr.message}`)
  record("asset created + acquisition JE", true, `asset=${asset.id} je=${jeId}`)

  return { assetId: asset.id, purchaseAmount, salvage, monthlyDep, purchaseDate }
}

async function main() {
  assertStagingOnly(process.env.NEXT_PUBLIC_SUPABASE_URL || STAGING_URL)

  const databaseUrl =
    argValue("--database-url") ||
    process.env.STAGING_DATABASE_URL ||
    process.env.DATABASE_URL

  if (process.argv.includes("--apply-527")) {
    if (!databaseUrl) fail("--apply-527 requires --database-url or STAGING_DATABASE_URL")
    await applyMigration527(databaseUrl)
  }

  const adminSb = createClient(STAGING_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const userSession = await mintUserSession()
  const userSb = createClient(STAGING_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userSession.access_token}` } },
  })

  console.log("\n[phase1a-validate] Staging project:", STAGING_REF)
  console.log("[phase1a-validate] Business:", LOAD_BUSINESS_ID)
  console.log("[phase1a-validate] User:", LOAD_EMAIL)

  await probeRpcs(userSb)

  const { assetId, purchaseAmount, salvage, monthlyDep } = await createTestAsset(adminSb, LOAD_BUSINESS_ID)

  const { data: beforeAsset } = await adminSb
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .single()

  const periodStart = "2026-07-01"
  const periodEnd = "2026-07-31"
  const pnlBefore = await fetchDepreciationExpenseTotal(adminSb, LOAD_BUSINESS_ID, periodStart, periodEnd)
  record("baseline P&L 5700 expense readable", pnlBefore != null, `5700_total=${pnlBefore}`)

  const postingDate = "2026-07-01"
  const idempotencyKey = randomUUID()

  const { data: postResult, error: postErr } = await userSb.rpc("post_asset_depreciation", {
    p_asset_id: assetId,
    p_posting_date: postingDate,
    p_amount: null,
    p_adjustment_reason: null,
    p_idempotency_key: idempotencyKey,
    p_posted_by: userSession.user?.id ?? null,
  })

  record("post_asset_depreciation success", !postErr && !!postResult?.journal_entry_id, postErr?.message || JSON.stringify(postResult))
  if (postErr) {
    console.log(JSON.stringify(results, null, 2))
    process.exit(1)
  }

  results.entryId = postResult.depreciation_entry_id
  results.journalEntryId = postResult.journal_entry_id

  const { data: entry } = await adminSb
    .from("depreciation_entries")
    .select("*")
    .eq("id", postResult.depreciation_entry_id)
    .single()

  record("entry uses amount column", Number(entry.amount) === Number(postResult.amount))
  record("entry status posted/adjusted", ["posted", "adjusted"].includes(entry.status))
  record("entry journal linked", entry.journal_entry_id === postResult.journal_entry_id)

  const { data: je } = await adminSb.from("journal_entries").select("*").eq("id", postResult.journal_entry_id).single()
  record("journal date matches posting", je.date === postingDate, `${je.date} vs ${postingDate}`)

  const { data: lines } = await adminSb
    .from("journal_entry_lines")
    .select("debit,credit, account_id, accounts(code,type)")
    .eq("journal_entry_id", postResult.journal_entry_id)

  const dr = round2(lines?.reduce((s, l) => s + Number(l.debit), 0) ?? 0)
  const cr = round2(lines?.reduce((s, l) => s + Number(l.credit), 0) ?? 0)
  record("journal balanced", dr === cr && dr === Number(postResult.amount), `DR=${dr} CR=${cr}`)

  const { data: afterAsset } = await adminSb.from("assets").select("*").eq("id", assetId).single()
  const expectedAccum = round2(Number(beforeAsset.accumulated_depreciation) + Number(postResult.amount))
  const expectedCurrent = round2(Math.max(salvage, purchaseAmount - expectedAccum))
  record(
    "register accumulated updated",
    round2(afterAsset.accumulated_depreciation) === expectedAccum,
    `${afterAsset.accumulated_depreciation} vs ${expectedAccum}`
  )
  record(
    "register current value updated",
    round2(afterAsset.current_value) === expectedCurrent,
    `${afterAsset.current_value} vs ${expectedCurrent}`
  )
  record("current value >= salvage", Number(afterAsset.current_value) >= salvage)

  const pnlAfterPost = await fetchDepreciationExpenseTotal(adminSb, LOAD_BUSINESS_ID, periodStart, periodEnd)
  record(
    "P&L 5700 increased by posted amount",
    pnlAfterPost != null && round2(pnlAfterPost - (pnlBefore ?? 0)) === round2(Number(postResult.amount)),
    `before=${pnlBefore} after=${pnlAfterPost} delta=${round2((pnlAfterPost ?? 0) - (pnlBefore ?? 0))}`
  )

  const { data: accumLines } = await adminSb
    .from("journal_entry_lines")
    .select("credit,journal_entries!inner(date,business_id)")
    .eq("account_id", postResult.accumulated_depreciation_account_id)
    .eq("journal_entries.business_id", LOAD_BUSINESS_ID)
    .gte("journal_entries.date", periodStart)
    .lte("journal_entries.date", periodEnd)
  const accumCredit = round2((accumLines || []).reduce((s, l) => s + Number(l.credit), 0))
  record(
    "balance sheet 1650 credit increased",
    accumCredit >= round2(Number(postResult.amount)),
    `1650_credit=${accumCredit}`
  )

  // Idempotent retry
  const { data: idemResult, error: idemErr } = await userSb.rpc("post_asset_depreciation", {
    p_asset_id: assetId,
    p_posting_date: postingDate,
    p_idempotency_key: idempotencyKey,
  })
  record(
    "idempotency retry same key",
    !idemErr && idemResult?.idempotent === true,
    idemErr?.message || String(idemResult?.idempotent)
  )

  const { count: entryCountAfterIdem } = await adminSb
    .from("depreciation_entries")
    .select("id", { count: "exact", head: true })
    .eq("asset_id", assetId)
    .eq("date", postingDate)
    .is("deleted_at", null)
  record("no duplicate entry on idempotent retry", entryCountAfterIdem === 1)

  // Duplicate date different key
  const { error: dupErr } = await userSb.rpc("post_asset_depreciation", {
    p_asset_id: assetId,
    p_posting_date: postingDate,
    p_idempotency_key: randomUUID(),
  })
  record("duplicate date blocked", !!dupErr && /already posted|duplicate/i.test(dupErr.message), dupErr?.message)

  // Excess amount
  const { error: excessErr } = await userSb.rpc("post_asset_depreciation", {
    p_asset_id: assetId,
    p_posting_date: "2026-08-01",
    p_amount: purchaseAmount,
  })
  record("excess amount rejected", !!excessErr && /exceeds|fully depreciated/i.test(excessErr.message), excessErr?.message)

  // Reversal (before delete-protection probes)
  const { data: revResult, error: revErr } = await userSb.rpc("reverse_asset_depreciation", {
    p_depreciation_entry_id: postResult.depreciation_entry_id,
    p_reversal_date: "2026-07-15",
    p_reason: "Phase1A staging validation reversal",
    p_reversed_by: userSession.user?.id ?? null,
  })
  record("reversal success", !revErr && !!revResult?.journal_entry_id, revErr?.message || JSON.stringify(revResult))

  const { data: origAfterRev } = await adminSb.from("depreciation_entries").select("status,reversed_by_entry_id").eq("id", postResult.depreciation_entry_id).single()
  record("original marked reversed", origAfterRev?.status === "reversed" && !!origAfterRev.reversed_by_entry_id)

  const { data: assetAfterRev } = await adminSb.from("assets").select("accumulated_depreciation,current_value").eq("id", assetId).single()
  record(
    "register restored after reversal",
    round2(assetAfterRev.accumulated_depreciation) === round2(beforeAsset.accumulated_depreciation),
    `${assetAfterRev.accumulated_depreciation} vs ${beforeAsset.accumulated_depreciation}`
  )

  const pnlAfterRev = await fetchDepreciationExpenseTotal(adminSb, LOAD_BUSINESS_ID, periodStart, periodEnd)
  record(
    "P&L 5700 net unchanged after reversal",
    pnlAfterRev != null && round2(pnlAfterRev) === round2(pnlBefore ?? 0),
    `before=${pnlBefore} after_rev=${pnlAfterRev}`
  )

  // Soft-closed period rejection (September)
  const closedPeriodStart = "2026-09-01"
  try {
    const closedStatus = await softClosePeriod(adminSb, LOAD_BUSINESS_ID, closedPeriodStart)
    const { error: closedErr } = await userSb.rpc("post_asset_depreciation", {
      p_asset_id: assetId,
      p_posting_date: closedPeriodStart,
    })
    record(
      "soft-closed period rejected",
      closedStatus === "soft_closed" && !!closedErr && /soft-closed|locked|blocked/i.test(closedErr.message),
      `period_status=${closedStatus} err=${closedErr?.message || "unexpected success"}`
    )
  } finally {
    await reopenPeriod(adminSb, LOAD_BUSINESS_ID, closedPeriodStart)
  }

  // Delete protection: post a disposable August entry, then attempt delete/soft-delete
  const deleteProbeDate = "2026-08-01"
  const { data: deleteProbePost, error: deleteProbePostErr } = await userSb.rpc("post_asset_depreciation", {
    p_asset_id: assetId,
    p_posting_date: deleteProbeDate,
    p_idempotency_key: randomUUID(),
    p_posted_by: userSession.user?.id ?? null,
  })
  record(
    "delete-probe post for immutability test",
    !deleteProbePostErr && !!deleteProbePost?.depreciation_entry_id,
    deleteProbePostErr?.message || deleteProbePost?.depreciation_entry_id
  )

  if (deleteProbePost?.depreciation_entry_id) {
    const probeEntryId = deleteProbePost.depreciation_entry_id
    const { error: delErr } = await userSb.from("depreciation_entries").delete().eq("id", probeEntryId)
    const deleteBlocked =
      !!delErr && /ACCOUNTING_RECORD_IMMUTABLE|cannot be deleted|permission denied|violates row-level security/i.test(delErr.message)
    record("direct DELETE blocked on posted entry", deleteBlocked, delErr?.message || "delete succeeded (527 trigger missing?)")

    const { error: softDelErr } = await userSb
      .from("depreciation_entries")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", probeEntryId)
    const softDeleteBlocked =
      !!softDelErr && /ACCOUNTING_RECORD_IMMUTABLE|cannot be deleted|permission denied|violates row-level security/i.test(softDelErr.message)
    record("soft delete blocked on posted entry", softDeleteBlocked, softDelErr?.message || "soft delete succeeded (527 trigger missing?)")

    // Clean up probe entry via reversal if delete protection missing
    if (!deleteBlocked || !softDeleteBlocked) {
      await userSb.rpc("reverse_asset_depreciation", {
        p_depreciation_entry_id: probeEntryId,
        p_reversal_date: "2026-08-15",
        p_reason: "Cleanup delete-probe entry after immutability test",
        p_reversed_by: userSession.user?.id ?? null,
      })
    }
  }

  // Cross-tenant fake asset
  const { error: xtenantErr } = await userSb.rpc("post_asset_depreciation", {
    p_asset_id: "00000000-0000-0000-0000-000000000099",
    p_posting_date: postingDate,
  })
  record("cross-tenant asset rejected", !!xtenantErr && /not found|not authorized/i.test(xtenantErr.message), xtenantErr?.message)

  await runReadOnlyDiagnostics(adminSb, LOAD_BUSINESS_ID)

  // RPC diagnostic if migration 527 applied
  const { data: rpcDiag, error: rpcDiagErr } = await userSb.rpc("finza_diagnose_asset_depreciation_reconciliation", {
    p_business_id: LOAD_BUSINESS_ID,
  })
  if (rpcDiagErr) {
    record("reconciliation diagnostic RPC (527)", false, rpcDiagErr.message)
  } else {
    record("reconciliation diagnostic RPC (527)", true, `issue_count=${rpcDiag?.issue_count ?? "?"}`)
  }

  const failed = results.tests.filter((t) => !t.pass).length
  console.log(`\n[phase1a-validate] Summary: ${results.tests.length - failed}/${results.tests.length} passed`)
  console.log(JSON.stringify(results, null, 2))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => fail(e.message))
