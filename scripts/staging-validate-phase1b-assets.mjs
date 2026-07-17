/**
 * Staging Phase 1B validation (project adonhhtooawkeemdqqeo).
 *   node scripts/staging-validate-phase1b-assets.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "crypto"

const STAGING_REF = "adonhhtooawkeemdqqeo"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const LOAD_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const LOAD_EMAIL = "staging@test.com"

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE2MTY4MCwiZXhwIjoyMDk3NzM3NjgwfQ.kX4ycRl6QBs77Nro5e_uXVj9es75VgYS59XTFvPWFnY"
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjE2ODAsImV4cCI6MjA5NzczNzY4MH0.gteoKZMizYHZgxbsiFsNfrb-1CI8Mh8Yps5nuX4xjkc"

if (!STAGING_URL.includes(STAGING_REF)) process.exit(1)

const results = []

function record(name, pass, detail = "") {
  results.push({ name, pass, detail })
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? `: ${detail}` : ""}`)
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
    throw new Error(`verify missing valid access_token: ${JSON.stringify(session).slice(0, 200)}`)
  }
  return session
}

async function main() {
  const adminSb = createClient(STAGING_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const session = await mintUserSession()
  const userSb = createClient(STAGING_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  })

  const { error: probeErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: "00000000-0000-0000-0000-000000000001",
    p_disposal_date: "2024-01-01",
    p_proceeds: 0,
    p_disposal_type: "scrap",
  })
  record(
    "post_asset_disposal RPC present",
    !probeErr?.message?.includes("Could not find the function") && !probeErr?.message?.includes("Expected 3 parts in JWT"),
    probeErr?.message
  )

  const { data: sqlTests, error: sqlErr } = await adminSb.rpc("test_asset_phase1b")
  if (sqlErr) {
    record("SQL test_asset_phase1b", false, sqlErr.message)
  } else {
    for (const t of sqlTests || []) {
      record(`SQL ${t.test_name}`, t.passed, t.detail)
    }
  }

  const { data: diag, error: diagErr } = await userSb.rpc("finza_diagnose_asset_depreciation_reconciliation", {
    p_business_id: LOAD_BUSINESS_ID,
  })
  record("diagnostics issue_count", !diagErr, diagErr?.message || String(diag?.issue_count ?? 0))

  const { data: payAcct } = await adminSb
    .from("accounts")
    .select("id")
    .eq("business_id", LOAD_BUSINESS_ID)
    .eq("code", "1010")
    .is("deleted_at", null)
    .maybeSingle()

  const { data: asset, error: createErr } = await adminSb
    .from("assets")
    .insert({
      business_id: LOAD_BUSINESS_ID,
      name: `Phase1B Validate ${new Date().toISOString()}`,
      category: "equipment",
      purchase_date: "2026-06-01",
      purchase_amount: 6000,
      useful_life_years: 5,
      salvage_value: 0,
      current_value: 6000,
      accumulated_depreciation: 0,
      status: "active",
    })
    .select("id")
    .single()

  record("create test asset", !createErr && !!asset?.id, createErr?.message || asset?.id)
  if (!asset?.id) process.exit(1)

  await adminSb.rpc("post_asset_purchase_to_ledger", { p_asset_id: asset.id, p_payment_account_id: null })
  for (const m of ["2026-06-01", "2026-07-01"]) {
    await userSb.rpc("post_asset_depreciation", {
      p_asset_id: asset.id,
      p_posting_date: m,
      p_idempotency_key: randomUUID(),
      p_posted_by: session.user?.id,
    })
  }

  const idem = randomUUID()
  const { data: disp1, error: dispErr } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: asset.id,
    p_disposal_date: "2026-07-15",
    p_proceeds: 5900,
    p_disposal_type: "cash",
    p_payment_account_id: payAcct?.id,
    p_idempotency_key: idem,
    p_disposed_by: session.user?.id,
  })
  record("cash disposal with gain", !dispErr && !!disp1?.journal_entry_id, dispErr?.message || JSON.stringify(disp1))

  const { data: dispIdem } = await userSb.rpc("post_asset_disposal", {
    p_asset_id: asset.id,
    p_disposal_date: "2026-07-15",
    p_proceeds: 5900,
    p_disposal_type: "cash",
    p_payment_account_id: payAcct?.id,
    p_idempotency_key: idem,
    p_disposed_by: session.user?.id,
  })
  record("disposal idempotent retry", dispIdem?.idempotent === true && dispIdem?.journal_entry_id === disp1?.journal_entry_id)

  const { data: batch, error: batchErr } = await userSb.rpc("post_asset_depreciation_batch", {
    p_business_id: LOAD_BUSINESS_ID,
    p_posting_date: "2026-08-01",
    p_posted_by: session.user?.id,
    p_idempotency_prefix: `p1b-${randomUUID()}`,
    p_max_assets: 20,
  })
  record(
    "batch depreciation",
    !batchErr && typeof batch.posted_count === "number",
    batchErr?.message || `posted=${batch?.posted_count} skipped=${batch?.skipped_count} failed=${batch?.failed_count}`
  )

  const failed = results.filter((r) => !r.pass).length
  console.log(`\n[phase1b-validate] ${results.length - failed}/${results.length} passed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
