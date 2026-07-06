#!/usr/bin/env node
/**
 * Read-only production migration preflight (Finza Pro: qjxhibvbmzogyzbhswjj).
 * Does NOT apply migrations. Uses REST API + optional DATABASE_URL for SQL.
 */
import { config } from "dotenv"
import { readFileSync } from "fs"
import { resolve } from "path"

config({ path: resolve(process.cwd(), ".env.local") })

const PROJECT_REF = "qjxhibvbmzogyzbhswjj"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url?.includes(PROJECT_REF)) {
  console.error(`Expected production URL containing ${PROJECT_REF}`)
  process.exit(1)
}
if (!key) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const hdrs = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
}

async function getOpenApi() {
  const res = await fetch(`${url}/rest/v1/`, { headers: hdrs })
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status}`)
  return res.json()
}

function tableCols(defs, table) {
  const d = defs[table] || defs[`public.${table}`]
  return d?.properties ? Object.keys(d.properties) : null
}

function hasTable(defs, table) {
  return tableCols(defs, table) !== null
}

async function rpcExists(name) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({}),
  })
  return res.status !== 404
}

async function fetchAllProformaKeys() {
  const rows = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const res = await fetch(
      `${url}/rest/v1/proforma_invoices?select=business_id,proforma_number&proforma_number=not.is.null&deleted_at=is.null&limit=${pageSize}&offset=${offset}`,
      {
        headers: {
          ...hdrs,
          Prefer: "count=exact",
          Range: `${offset}-${offset + pageSize - 1}`,
        },
      }
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`proforma fetch failed: ${res.status} ${text.slice(0, 200)}`)
    }
    const batch = await res.json()
    rows.push(...batch)
    if (batch.length < pageSize) break
    offset += pageSize
    if (offset > 500000) throw new Error("proforma pagination safety stop")
  }
  return rows
}

function findDuplicateProformas(rows) {
  const counts = new Map()
  for (const row of rows) {
    const k = `${row.business_id}\0${row.proforma_number}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const dupes = []
  for (const [k, count] of counts) {
    if (count > 1) {
      const [business_id, proforma_number] = k.split("\0")
      dupes.push({ business_id, proforma_number, count })
    }
  }
  dupes.sort((a, b) => b.count - a.count)
  return dupes
}

async function trySqlViaPg() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return { available: false, reason: "DATABASE_URL not set" }
  try {
    const pg = await import("pg")
    const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
    await client.connect()
    const sqlFile = resolve(process.cwd(), "scripts/production-migration-preflight.sql")
    const sql = readFileSync(sqlFile, "utf8")
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("--"))
    const results = []
    for (const stmt of statements) {
      if (!stmt) continue
      const r = await client.query(stmt)
      results.push({ query: stmt.split("\n")[0].slice(0, 80), rows: r.rows, rowCount: r.rowCount })
    }
    await client.end()
    return { available: true, results }
  } catch (e) {
    return { available: false, reason: String(e.message || e) }
  }
}

async function main() {
  console.log("=== Production migration preflight ===")
  console.log(`project_ref: ${PROJECT_REF}`)
  console.log(`timestamp: ${new Date().toISOString()}`)
  console.log()

  const pgSql = await trySqlViaPg()
  if (pgSql.available) {
    console.log("## Step 1 — Migration history (via DATABASE_URL)")
    for (const r of pgSql.results) {
      console.log(`\n-- ${r.query}`)
      console.log(JSON.stringify(r.rows, null, 2))
    }
  } else {
    console.log("## Step 1 — Migration history")
    console.log("BLOCKED: cannot query supabase_migrations.schema_migrations")
    console.log(`Reason: ${pgSql.reason}`)
    console.log("Run scripts/production-migration-preflight.sql in Supabase SQL Editor.")
  }

  const spec = await getOpenApi()
  const defs = spec.definitions || {}

  console.log("\n## Step 2 — 463–478 fingerprint")
  const fingerprint = {
    has_salary_advance_repayments: hasTable(defs, "salary_advance_repayments"),
    has_payroll_obligations: hasTable(defs, "payroll_obligations"),
    has_staff_payment_methods: hasTable(defs, "staff_payment_methods"),
    has_payroll_payment_batches: hasTable(defs, "payroll_payment_batches"),
    staff_tax_profile_columns: [
      "is_tax_resident",
      "is_pensionable",
      "gra_position_code",
      "secondary_employment",
    ].filter((c) => tableCols(defs, "staff")?.includes(c)),
    payroll_filing_columns: [
      "payroll_tax_profile",
      "filing_tin",
      "filing_employee_name",
      "bonus_concessional_amount",
      "bonus_graduated_amount",
    ].filter((c) => tableCols(defs, "payroll_entries")?.includes(c)),
  }
  console.log(JSON.stringify(fingerprint, null, 2))
  const fingerprintPass =
    fingerprint.has_salary_advance_repayments &&
    fingerprint.has_payroll_obligations &&
    fingerprint.has_staff_payment_methods &&
    fingerprint.has_payroll_payment_batches &&
    fingerprint.staff_tax_profile_columns.length === 4 &&
    fingerprint.payroll_filing_columns.length === 5
  console.log(`fingerprint_pass: ${fingerprintPass}`)

  console.log("\n## Step 3 — 520 duplicate risk")
  const proformaRows = await fetchAllProformaKeys()
  const dupes = findDuplicateProformas(proformaRows)
  console.log(`active_proformas_scanned: ${proformaRows.length}`)
  console.log(`duplicate_groups: ${dupes.length}`)
  if (dupes.length) console.log(JSON.stringify(dupes.slice(0, 20), null, 2))
  console.log(`520_preflight_pass: ${dupes.length === 0}`)

  console.log("\n## Step 4 — 521 columns")
  const cols521 = [
    "is_included",
    "base_salary_snapshot",
    "adjustment_amount",
    "adjustment_reason",
    "exclusion_reason",
  ].filter((c) => tableCols(defs, "payroll_entries")?.includes(c))
  console.log(JSON.stringify({ present: cols521, expected_before_apply: [] }, null, 2))

  console.log("\n## Step 5 — 517–519 material columns")
  const mat517 = [
    "is_billable",
    "default_cost_price",
    "default_selling_price",
    "sales_name",
    "sales_description",
  ].filter((c) => tableCols(defs, "service_material_inventory")?.includes(c))
  const mat519 = [
    { table: "invoice_items", column: "material_id" },
    { table: "estimate_items", column: "material_id" },
    { table: "proforma_invoice_items", column: "material_id" },
  ].filter(({ table, column }) => tableCols(defs, table)?.includes(column))
  console.log(JSON.stringify({ mat517_present: mat517, mat519_present: mat519 }, null, 2))

  console.log("\n## Step 6 — 479–493 REST schema probes (tables/columns; RPC non-authoritative)")
  const tables479493 = {
    479: ["tax_schedules", "tax_schedule_lines", "product_tax_categories", "invoice_item_tax_lines"],
    480: ["business_gra_evat_enrollments"],
    481: ["gra_evat_submissions"],
    485: ["businesses"],
    493: ["business_activation_events"],
  }
  for (const [ver, tables] of Object.entries(tables479493)) {
    const status = Object.fromEntries(tables.map((t) => [t, hasTable(defs, t)]))
    const allPresent = tables.every((t) => status[t])
    console.log(`${ver}: ${allPresent ? "PRESENT" : "PARTIAL/MISSING"} ${JSON.stringify(status)}`)
  }
  const cols485 = ["billing_exempt", "billing_exempt_reason"]
  console.log(
    `485 businesses columns: ${JSON.stringify(Object.fromEntries(cols485.map((c) => [c, tableCols(defs, "businesses")?.includes(c)])))}`
  )
  const cols493 = ["signup_goal", "trial_contact_consent"]
  console.log(
    `493 businesses columns: ${JSON.stringify(Object.fromEntries(cols493.map((c) => [c, tableCols(defs, "businesses")?.includes(c)])))}`
  )
  const rpc479493 = [
    "ensure_accounting_initialized_system",
    "repair_orphan_invoice_payment_journals",
    "trigger_post_payment",
    "resolve_default_accounting_period",
    "get_balance_sheet_as_of",
    "get_cumulative_net_income_as_of",
    "finza_business_can_write_service_records",
    "finza_business_has_service_min_tier",
    "finza_service_trial_rls_can_write",
    "get_profit_and_loss_movement",
    "post_invoice_to_ledger",
  ]
  const rpc479493Status = {}
  for (const name of rpc479493) {
    rpc479493Status[name] = (await rpcExists(name)) ? "rest_exposed" : "not_rest_exposed_or_missing"
  }
  console.log(JSON.stringify({ rpc479493Status }, null, 2))
  console.log("482 index payments_reference_hubtel_fzhb_unique: verify via SQL Editor (pg_indexes)")
  console.log("491 policy service trial read select: verify via SQL Editor (pg_policies)")

  console.log("\n## Step 7 — Dashboard/support objects")
  const rpcNames = [
    "get_cash_collected_total",
    "get_operational_overdue_invoices_page",
    "get_service_dashboard_timeline",
    "get_service_dashboard_metrics",
    "get_bills_list_page",
    "get_operational_unpaid_invoices_total",
    "refresh_service_dashboard_period_summaries",
  ]
  const rpcStatus = {}
  for (const name of rpcNames) rpcStatus[name] = (await rpcExists(name)) ? "present" : "missing"
  const objects = {
    rpcStatus,
    has_support_requests: hasTable(defs, "support_requests"),
    has_period_summary: hasTable(defs, "service_dashboard_period_summary"),
  }
  console.log(JSON.stringify(objects, null, 2))

  console.log("\n## Recommendation")
  if (dupes.length > 0) {
    console.log("STOP — resolve proforma duplicate groups before applying 520.")
  } else if (!pgSql.available) {
    console.log("PARTIAL — REST preflight OK for 520/521/materials/dashboard probes; run SQL Editor history query before batch apply.")
  } else if (!fingerprintPass) {
    console.log("STOP — 463–478 schema fingerprint incomplete; investigate before batch.")
  } else {
    console.log("PROCEED WITH CAUTION — run migration batch 494–521 after backup; repair 463–478 history if SQL shows schema-only apply.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
