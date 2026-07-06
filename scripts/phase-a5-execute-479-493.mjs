#!/usr/bin/env node
/**
 * Phase A.5 execution: verify + repair/apply migrations 479-493 on Finza Pro.
 * Requires DATABASE_URL (postgres connection to qjxhibvbmzogyzbhswjj) OR working `supabase db query --linked`.
 *
 *   $env:DATABASE_URL = "postgresql://postgres.qjxhibvbmzogyzbhswjj:***@aws-1-eu-north-1.pooler.supabase.com:5432/postgres"
 *   node scripts/phase-a5-execute-479-493.mjs
 */
import { readFileSync, readdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { spawnSync } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const PROJECT_REF = "qjxhibvbmzogyzbhswjj"
const MIG_DIR = resolve(ROOT, "supabase/migrations")

const REPAIR_BATCH = [479, 480, 481, 485, 493]
const ALREADY_RECORDED = new Set([489, 490, 491])
const APPLY_ORDER = [482, 483, 484, 486, 487, 488, 492]

const FN_PROBE = [
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

const VERSION_FN = {
  483: ["ensure_accounting_initialized_system"],
  484: ["repair_orphan_invoice_payment_journals", "trigger_post_payment"],
  486: ["resolve_default_accounting_period", "get_balance_sheet_as_of", "get_cumulative_net_income_as_of"],
  487: ["finza_business_can_write_service_records", "finza_business_has_service_min_tier"],
  488: ["finza_service_trial_rls_can_write"],
  492: ["post_invoice_to_ledger"],
}

const VERSION_TABLE = {
  479: ["tax_schedules", "tax_schedule_lines", "product_tax_categories", "invoice_item_tax_lines"],
  480: ["business_gra_evat_enrollments"],
  481: ["gra_evat_submissions"],
  485: ["businesses"],
  493: ["business_activation_events"],
}

function migrationFile(ver) {
  return readdirSync(MIG_DIR).find((f) => f.startsWith(`${ver}_`))
}

async function queryViaPg(sql) {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl?.includes(PROJECT_REF)) throw new Error(`DATABASE_URL must target ${PROJECT_REF}`)
  const pg = await import("pg")
  const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const res = await client.query(sql)
    return res.rows
  } finally {
    await client.end()
  }
}

function queryViaCli(sql) {
  const res = spawnSync("npx", ["supabase", "db", "query", "--linked", sql], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
  })
  if (res.status !== 0) throw new Error(res.stderr || res.stdout)
  const m = res.stdout.match(/"rows"\s*:\s*(\[[\s\S]*?\])\s*,\s*"warning"/)
  if (!m) throw new Error(`Could not parse CLI output: ${res.stdout.slice(0, 300)}`)
  return JSON.parse(m[1])
}

async function query(sql) {
  if (process.env.DATABASE_URL) return queryViaPg(sql)
  return queryViaCli(sql)
}

function repair(version) {
  const res = spawnSync("npx", ["supabase", "migration", "repair", "--status", "applied", String(version), "--linked"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
  })
  return { version, ok: res.status === 0, out: (res.stdout || res.stderr || "").trim() }
}

function applyMigration(version) {
  const file = migrationFile(version)
  if (!file) throw new Error(`Missing migration file for ${version}`)
  const path = resolve(MIG_DIR, file)
  if (process.env.DATABASE_URL) {
    const sql = readFileSync(path, "utf8")
    return queryViaPg(sql).then(() => ({ version, file, ok: true }))
  }
  const res = spawnSync("npx", ["supabase", "db", "query", "--linked", "-f", path], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
  })
  return { version, file, ok: res.status === 0, out: (res.stdout || res.stderr || "").trim() }
}

async function main() {
  console.log("=== Phase A.5 execute 479-493 ===")
  console.log(`project_ref: ${PROJECT_REF}`)

  const fns = await query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${FN_PROBE.map((f) => `'${f}'`).join(",")}) order by 1`
  )
  const fnSet = new Set(fns.map((r) => r.proname))
  console.log("\nFunctions present:", [...fnSet].sort().join(", ") || "(none)")

  const idx = await query(
    `select indexname from pg_indexes where schemaname = 'public' and indexname = 'payments_reference_hubtel_fzhb_unique'`
  )
  const has482Index = idx.length > 0
  console.log("482 index payments_reference_hubtel_fzhb_unique:", has482Index)

  const pol = await query(
    `select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('invoices','invoice_items') and policyname = 'service trial read select'`
  )
  console.log("491 policies:", pol)

  const hist = await query(
    `select version::bigint as version from supabase_migrations.schema_migrations where version ~ '^[0-9]+$' and version::bigint between 479 and 493 order by 1`
  )
  const histSet = new Set(hist.map((r) => Number(r.version)))
  console.log("History 479-493:", [...histSet].sort((a, b) => a - b).join(", "))

  const repaired = []
  const appliedThenRepaired = []
  const errors = []

  for (const v of REPAIR_BATCH) {
    if (histSet.has(v)) {
      console.log(`skip repair ${v} (already recorded)`)
      continue
    }
    const r = repair(v)
    if (r.ok) repaired.push(v)
    else errors.push(`repair ${v}: ${r.out}`)
  }

  const maybeRepair = (v, present) => {
    if (ALREADY_RECORDED.has(v)) return
    if (histSet.has(v)) return
    if (present) {
      const r = repair(v)
      if (r.ok) repaired.push(v)
      else errors.push(`repair ${v}: ${r.out}`)
    }
  }

  maybeRepair(482, has482Index)
  maybeRepair(483, VERSION_FN[483].every((f) => fnSet.has(f)))
  maybeRepair(484, VERSION_FN[484].every((f) => fnSet.has(f)))
  maybeRepair(486, VERSION_FN[486].every((f) => fnSet.has(f)))
  maybeRepair(487, VERSION_FN[487].every((f) => fnSet.has(f)))
  maybeRepair(488, VERSION_FN[488].every((f) => fnSet.has(f)) && pol.length >= 2)

  for (const v of APPLY_ORDER) {
    if (ALREADY_RECORDED.has(v)) continue
    if (histSet.has(v)) continue
    let needsApply = false
    if (v === 482) needsApply = !has482Index
    else if (v === 488) needsApply = !VERSION_FN[488].every((f) => fnSet.has(f)) || pol.length < 2
    else needsApply = !VERSION_FN[v].every((f) => fnSet.has(f))

    if (!needsApply) continue
    console.log(`Applying migration ${v}...`)
    const a = await applyMigration(v)
    if (!a.ok) {
      errors.push(`apply ${v}: ${a.out || "failed"}`)
      continue
    }
    const r = repair(v)
    if (r.ok) appliedThenRepaired.push(v)
    else errors.push(`repair after apply ${v}: ${r.out}`)
  }

  // 489-491 drift
  const drift = []
  if (histSet.has(489) || histSet.has(490)) {
    if (!fnSet.has("get_profit_and_loss_movement")) drift.push("489/490: history recorded but get_profit_and_loss_movement missing")
  }
  if (histSet.has(491) && pol.length < 2) drift.push("491: history recorded but invoice SELECT policies missing")

  console.log("\n=== Summary ===")
  console.log(JSON.stringify({ repaired, appliedThenRepaired, drift, errors }, null, 2))

  const list = spawnSync("npx", ["supabase", "migration", "list", "--linked"], { cwd: ROOT, encoding: "utf8", shell: true })
  console.log("\n=== migration list (tail) ===")
  console.log(list.stdout?.slice(-2500) || list.stderr)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
