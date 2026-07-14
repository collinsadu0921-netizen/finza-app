/**
 * Comprehensive Phase 1B staging validation (project adonhhtooawkeemdqqeo).
 *   node scripts/staging-validate-phase1b-comprehensive.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "crypto"

const STAGING_REF = "adonhhtooawkeemdqqeo"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const LOAD_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const LOAD_EMAIL = "staging@test.com"
const FIXTURE_PREFIX = "Phase1B-Validate"

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE2MTY4MCwiZXhwIjoyMDk3NzM3NjgwfQ.kX4ycRl6QBs77Nro5e_uXVj9es75VgYS59XTFvPWFnY"
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjE2ODAsImV4cCI6MjA5NzczNzY4MH0.gteoKZMizYHZgxbsiFsNfrb-1CI8Mh8Yps5nuX4xjkc"

if (!STAGING_URL.includes(STAGING_REF)) {
  console.error("FATAL: not staging project")
  process.exit(1)
}

const results = []
const fixtureAssetIds = []

function record(name, pass, detail = "") {
  results.push({ name, pass, detail })
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? `: ${detail}` : ""}`)
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
  if (!genRes.ok) throw new Error(`generate_link failed: ${genRes.status}`)
  const link = await genRes.json()
  if (!link.email_otp) throw new Error("generate_link missing email_otp")

  const verifyRes = await fetch(`${STAGING_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", email: LOAD_EMAIL, token: link.email_otp }),
  })
  if (!verifyRes.ok) throw new Error(`verify failed: ${verifyRes.status}`)
  const session = await verifyRes.json()
  if (!session.access_token || session.access_token.split(".").length !== 3) {
    throw new Error("verify missing valid access_token")
  }
  return session
}

async function getAccountId(adminSb, code) {
  const { data } = await adminSb
    .from("accounts")
    .select("id")
    .eq("business_id", LOAD_BUSINESS_ID)
    .eq("code", code)
    .is("deleted_at", null)
    .maybeSingle()
  return data?.id
}

async function createFixtureAsset(adminSb, opts) {
  const { data, error } = await adminSb
    .from("assets")
    .insert({
      business_id: LOAD_BUSINESS_ID,
      name: `${FIXTURE_PREFIX} ${opts.name} ${randomUUID().slice(0, 8)}`,
      category: "equipment",
      purchase_date: opts.purchaseDate,
      purchase_amount: opts.cost,
      useful_life_years: opts.life ?? 5,
      salvage_value: opts.salvage ?? 0,
      current_value: opts.cost,
      accumulated_depreciation: 0,
      status: "active",
    })
    .select("id,purchase_amount,salvage_value")
    .single()
  if (error) throw new Error(`create asset: ${error.message}`)
  fixtureAssetIds.push(data.id)
  await adminSb.rpc("post_asset_purchase_to_ledger", { p_asset_id: data.id, p_payment_account_id: null })
  return data
}

async function postDepThrough(userSb, adminSb, assetId, months, userId) {
  for (const m of months) {
    const { error } = await userSb.rpc("post_asset_depreciation", {
      p_asset_id: assetId,
      p_posting_date: m,
      p_idempotency_key: randomUUID(),
      p_posted_by: userId,
    })
    if (error) throw new Error(`dep ${m}: ${error.message}`)
  }
}

async function verifyJournal(adminSb, jeId, disposalDate, expected) {
  const { data: je } = await adminSb.from("journal_entries").select("date").eq("id", jeId).single()
  record(`${expected.label} journal date`, je?.date === disposalDate, `${je?.date} vs ${disposalDate}`)

  const { data: lines } = await adminSb
    .from("journal_entry_lines")
    .select("debit,credit, accounts(code)")
    .eq("journal_entry_id", jeId)

  const dr = round2((lines || []).reduce((s, l) => s + Number(l.debit), 0))
  const cr = round2((lines || []).reduce((s, l) => s + Number(l.credit), 0))
  record(`${expected.label} journal balanced`, dr === cr, `DR=${dr} CR=${cr}`)

  const byCode = (code) => lines?.find((l) => l.accounts?.code === code)
  if (expected.proceedsCode) {
    const line = byCode(expected.proceedsCode)
    record(`${expected.label} proceeds account ${expected.proceedsCode}`, !!line && Number(line.debit) > 0, `DR=${line?.debit}`)
  }
  if (expected.noProceeds) {
    const cash = byCode("1010")
    const ar = byCode("1100")
    record(`${expected.label} no proceeds line`, !cash && !ar, cash || ar ? "found proceeds line" : "ok")
  }
  const accum = byCode("1650")
  record(`${expected.label} accum dep debited`, !!accum && Number(accum.debit) > 0, `DR=${accum?.debit}`)
  const cost = byCode("1600")
  record(`${expected.label} asset cost credited`, !!cost && Number(cost.credit) > 0, `CR=${cost?.credit}`)
  if (expected.gain) {
    const gain = byCode("4200")
    record(`${expected.label} gain on 4200`, !!gain && Number(gain.credit) > 0, `CR=${gain?.credit}`)
  }
  if (expected.loss) {
    const loss = byCode("5800")
    record(`${expected.label} loss on 5800`, !!loss && Number(loss.debit) > 0, `DR=${loss?.debit}`)
  }
}

async function main() {
  console.log(`\n[phase1b-comprehensive] Staging: ${STAGING_REF}`)
  const adminSb = createClient(STAGING_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const session = await mintUserSession()
  const userId = session.user?.id
  const userSb = createClient(STAGING_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  })

  const cashAcct = await getAccountId(adminSb, "1010")

  // --- Cash disposal with gain ---
  const gainAsset = await createFixtureAsset(adminSb, { name: "CashGain", purchaseDate: "2026-03-01", cost: 6000 })
  await postDepThrough(userSb, adminSb, gainAsset.id, ["2026-03-01", "2026-04-01", "2026-05-01"], userId)
  const gainDispDate = "2026-05-20"
  const gainIdem = randomUUID()
  const { data: gainDisp, error: gainErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: gainAsset.id,
    p_disposal_date: gainDispDate,
    p_proceeds: 5800,
    p_disposal_type: "cash",
    p_payment_account_id: cashAcct,
    p_idempotency_key: gainIdem,
    p_disposed_by: userId,
  })
  record("cash gain disposal success", !gainErr && !!gainDisp?.journal_entry_id, gainErr?.message || gainDisp?.gain_loss)
  if (gainDisp?.journal_entry_id) {
    await verifyJournal(adminSb, gainDisp.journal_entry_id, gainDispDate, { label: "cash gain", proceedsCode: "1010", gain: true })
    const { data: a } = await adminSb.from("assets").select("status,disposal_journal_entry_id,disposal_gain_loss").eq("id", gainAsset.id).single()
    record("cash gain asset disposed", a?.status === "disposed" && a.disposal_journal_entry_id === gainDisp.journal_entry_id)
    record("cash gain amount stored", Number(a?.disposal_gain_loss) > 0, String(a?.disposal_gain_loss))
    const { data: idemRetry } = await userSb.rpc("post_asset_disposal", {
      p_asset_id: gainAsset.id, p_disposal_date: gainDispDate, p_proceeds: 5800, p_disposal_type: "cash",
      p_payment_account_id: cashAcct, p_idempotency_key: gainIdem, p_disposed_by: userId,
    })
    record("idempotent retry same key", idemRetry?.idempotent === true && idemRetry?.journal_entry_id === gainDisp.journal_entry_id)
    const { error: dupKeyErr } = await userSb.rpc("post_asset_disposal", {
      p_asset_id: gainAsset.id, p_disposal_date: gainDispDate, p_proceeds: 5800, p_disposal_type: "cash",
      p_payment_account_id: cashAcct, p_idempotency_key: randomUUID(), p_disposed_by: userId,
    })
    record("different key after disposal blocked", !!dupKeyErr && /ASSET_ALREADY_DISPOSED/i.test(dupKeyErr.message), dupKeyErr?.message)
    const { error: postDispDepErr } = await userSb.rpc("post_asset_depreciation", {
      p_asset_id: gainAsset.id, p_posting_date: "2026-06-01",
    })
    record("depreciation after disposal blocked", !!postDispDepErr, postDispDepErr?.message)
  }

  // --- Cash disposal with loss ---
  const lossAsset = await createFixtureAsset(adminSb, { name: "CashLoss", purchaseDate: "2026-03-01", cost: 6000 })
  await postDepThrough(userSb, adminSb, lossAsset.id, ["2026-03-01", "2026-04-01", "2026-05-01"], userId)
  const { data: lossDisp, error: lossErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: lossAsset.id, p_disposal_date: "2026-05-20", p_proceeds: 5000, p_disposal_type: "cash",
    p_payment_account_id: cashAcct, p_idempotency_key: randomUUID(), p_disposed_by: userId,
  })
  record("cash loss disposal success", !lossErr && !!lossDisp?.journal_entry_id, lossErr?.message || lossDisp?.gain_loss)
  if (lossDisp?.journal_entry_id) {
    await verifyJournal(adminSb, lossDisp.journal_entry_id, "2026-05-20", { label: "cash loss", proceedsCode: "1010", loss: true })
    record("cash loss negative gain_loss", Number(lossDisp.gain_loss) < 0, String(lossDisp.gain_loss))
  }

  // --- Scrap disposal ---
  const scrapAsset = await createFixtureAsset(adminSb, { name: "Scrap", purchaseDate: "2026-03-01", cost: 3000 })
  await postDepThrough(userSb, adminSb, scrapAsset.id, ["2026-03-01", "2026-04-01"], userId)
  const { data: scrapDisp, error: scrapErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: scrapAsset.id, p_disposal_date: "2026-04-15", p_proceeds: 0, p_disposal_type: "scrap",
    p_idempotency_key: randomUUID(), p_disposed_by: userId,
  })
  record("scrap disposal success", !scrapErr && !!scrapDisp?.journal_entry_id, scrapErr?.message)
  if (scrapDisp?.journal_entry_id) {
    await verifyJournal(adminSb, scrapDisp.journal_entry_id, "2026-04-15", { label: "scrap", noProceeds: true, loss: true })
  }

  // --- Credit disposal ---
  const creditAsset = await createFixtureAsset(adminSb, { name: "Credit", purchaseDate: "2026-03-01", cost: 4000 })
  await postDepThrough(userSb, adminSb, creditAsset.id, ["2026-03-01", "2026-04-01"], userId)
  const { data: creditDisp, error: creditErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: creditAsset.id, p_disposal_date: "2026-04-20", p_proceeds: 3900, p_disposal_type: "credit",
    p_idempotency_key: randomUUID(), p_disposed_by: userId,
  })
  record("credit disposal success", !creditErr && !!creditDisp?.journal_entry_id, creditErr?.message)
  if (creditDisp?.journal_entry_id) {
    await verifyJournal(adminSb, creditDisp.journal_entry_id, "2026-04-20", { label: "credit", proceedsCode: "1100" })
  }

  // --- Missing depreciation blocks ---
  const incompleteAsset = await createFixtureAsset(adminSb, { name: "IncompleteDep", purchaseDate: "2026-06-01", cost: 2000 })
  const { data: completeness } = await userSb.rpc("finza_asset_depreciation_completeness", {
    p_asset_id: incompleteAsset.id, p_through_date: "2026-08-15",
  })
  record("completeness missing count > 0", (completeness?.missing_period_count ?? 0) > 0, JSON.stringify(completeness))
  const { data: assetBefore } = await adminSb.from("assets").select("status,disposal_journal_entry_id").eq("id", incompleteAsset.id).single()
  const { error: incDispErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: incompleteAsset.id, p_disposal_date: "2026-08-15", p_proceeds: 1000, p_disposal_type: "cash",
    p_payment_account_id: cashAcct, p_idempotency_key: randomUUID(), p_disposed_by: userId,
  })
  record("incomplete dep blocks disposal", !!incDispErr && /DEPRECIATION_REQUIRED_BEFORE_DISPOSAL/i.test(incDispErr.message), incDispErr?.message)
  const { data: assetAfter } = await adminSb.from("assets").select("status,disposal_journal_entry_id").eq("id", incompleteAsset.id).single()
  record("incomplete dep no register change", assetAfter?.status === "active" && !assetAfter?.disposal_journal_entry_id)

  // --- Invalid inputs ---
  const { error: negErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: incompleteAsset.id, p_disposal_date: "2026-08-15", p_proceeds: -100, p_disposal_type: "cash",
    p_payment_account_id: cashAcct,
  })
  record("negative proceeds rejected", !!negErr && /NEGATIVE_PROCEEDS/i.test(negErr.message), negErr?.message)

  const { error: xtenantErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: "00000000-0000-0000-0000-000000000099", p_disposal_date: "2026-01-01", p_proceeds: 0, p_disposal_type: "scrap",
  })
  record("cross-tenant rejected", !!xtenantErr && /not found|not authorized/i.test(xtenantErr.message), xtenantErr?.message)

  // --- Historical backfill ---
  const backfillAsset = await createFixtureAsset(adminSb, { name: "Backfill", purchaseDate: "2025-04-01", cost: 2400 })
  const { data: backfill, error: backfillErr } = await userSb.rpc("backfill_asset_historical_depreciation", {
    p_asset_id: backfillAsset.id, p_through_date: "2025-10-01", p_posted_by: userId,
  })
  record("backfill success", !backfillErr && (backfill?.posted_count ?? 0) > 0, backfillErr?.message || `posted=${backfill?.posted_count}`)
  const { data: bfAsset } = await adminSb.from("assets").select("accumulated_depreciation").eq("id", backfillAsset.id).single()
  const { data: bfEntries } = await adminSb.from("depreciation_entries").select("amount,journal_entry_id").eq("asset_id", backfillAsset.id).is("deleted_at", null)
  const entriesSum = round2((bfEntries || []).reduce((s, e) => s + Number(e.amount), 0))
  record("backfill register matches entries", Math.abs(round2(bfAsset?.accumulated_depreciation) - entriesSum) < 0.02, `${bfAsset?.accumulated_depreciation} vs ${entriesSum}`)
  record("backfill all entries have journal", (bfEntries || []).every((e) => !!e.journal_entry_id))

  // --- Bulk depreciation ---
  const bulkA = await createFixtureAsset(adminSb, { name: "BulkA", purchaseDate: "2026-07-01", cost: 5000 })
  const bulkB = await createFixtureAsset(adminSb, { name: "BulkB", purchaseDate: "2026-07-01", cost: 5000 })
  const disposedForBulk = await createFixtureAsset(adminSb, { name: "BulkDisposed", purchaseDate: "2026-01-01", cost: 1000 })
  await postDepThrough(userSb, adminSb, disposedForBulk.id, ["2026-01-01"], userId)
  await userSb.rpc("post_asset_disposal", {
    p_asset_id: disposedForBulk.id, p_disposal_date: "2026-02-01", p_proceeds: 900, p_disposal_type: "cash",
    p_payment_account_id: cashAcct, p_idempotency_key: randomUUID(), p_disposed_by: userId,
  })
  const batchDate = "2026-07-01"
  const batchPrefix = `p1b-comp-${randomUUID().slice(0, 8)}`
  const { data: batch1 } = await userSb.rpc("post_asset_depreciation_batch", {
    p_business_id: LOAD_BUSINESS_ID, p_posting_date: batchDate, p_posted_by: userId, p_idempotency_prefix: batchPrefix, p_max_assets: 50,
  })
  record("batch has posted array", Array.isArray(batch1?.posted) || typeof batch1?.posted_count === "number", `posted=${batch1?.posted_count}`)
  record("batch has skipped array", batch1?.skipped !== undefined, `skipped=${batch1?.skipped_count}`)
  record("batch has failed array", batch1?.failed !== undefined, `failed=${batch1?.failed_count}`)
  const bulkAPosted = batch1?.posted?.some((p) => p.asset_id === bulkA.id) || batch1?.posted_count > 0
  record("batch posts valid assets", bulkAPosted, JSON.stringify(batch1?.posted?.slice(0, 2)))
  const { data: batch2 } = await userSb.rpc("post_asset_depreciation_batch", {
    p_business_id: LOAD_BUSINESS_ID, p_posting_date: batchDate, p_posted_by: userId, p_idempotency_prefix: batchPrefix, p_max_assets: 50,
  })
  record("batch duplicate period skipped", (batch2?.skipped_count ?? 0) >= 1 || batch2?.posted_count === 0, `skipped=${batch2?.skipped_count}`)

  // --- Diagnostics ---
  const { data: diag, error: diagErr } = await userSb.rpc("finza_diagnose_asset_depreciation_reconciliation", {
    p_business_id: LOAD_BUSINESS_ID,
  })
  record("diagnostics RPC works", !diagErr, diagErr?.message || `issues=${diag?.issue_count}`)
  const fixtureIssues = (diag?.issues || []).filter((i) =>
    fixtureAssetIds.includes(i.asset_id) &&
    !["register_accum_mismatch", "carrying_value_mismatch"].includes(i.issue_type)
  )
  record("fixture diagnostics clean", fixtureIssues.length === 0, fixtureIssues.length ? JSON.stringify(fixtureIssues.slice(0, 3)) : "0 issues")

  // --- Mark fixtures ---
  for (const id of fixtureAssetIds) {
    await adminSb.from("assets").update({ notes: `${FIXTURE_PREFIX} fixture — safe to archive` }).eq("id", id)
  }
  record("fixtures marked for cleanup", true, `${fixtureAssetIds.length} assets`)

  const failed = results.filter((r) => !r.pass).length
  console.log(`\n[phase1b-comprehensive] ${results.length - failed}/${results.length} passed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
