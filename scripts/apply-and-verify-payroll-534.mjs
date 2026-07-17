/**
 * Apply migration 534 to staging only, then verify via PostgREST / SQL.
 *
 *   SUPABASE_DB_PASSWORD=*** node scripts/apply-and-verify-payroll-534.mjs
 *
 * Safety:
 * - Hard-coded staging project ref adonhhtooawkeemdqqeo
 * - Refuses production ref
 * - Loads .env.staging for REST verification
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const MIGRATION_FILE = "534_payroll_salary_basis_and_period_items.sql"

function loadEnvFile(path) {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=")
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      })
  )
}

function fail(msg) {
  console.error("FATAL:", msg)
  process.exit(1)
}

async function main() {
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!password) fail("SUPABASE_DB_PASSWORD required")

  const stagingEnv = loadEnvFile(resolve(REPO_ROOT, ".env.staging"))
  const url = stagingEnv.NEXT_PUBLIC_SUPABASE_URL || ""
  const serviceKey = stagingEnv.SUPABASE_SERVICE_ROLE_KEY || ""
  if (!url || !serviceKey) fail(".env.staging must define NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")

  const ref = new URL(url).hostname.split(".")[0]
  if (ref !== STAGING_REF) fail(`Expected staging ref ${STAGING_REF}, got ${ref}`)
  if (ref === PRODUCTION_REF) fail("Production project refused")

  const conn = `postgresql://postgres.${STAGING_REF}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
  if (!conn.includes(STAGING_REF) || conn.includes(PRODUCTION_REF)) fail("Connection string safety check failed")

  const require = createRequire(import.meta.url)
  let pg
  try {
    pg = require("pg")
  } catch {
    fail("Missing dependency pg. Install with: npm install pg --no-save")
  }

  const sqlPath = resolve(REPO_ROOT, "supabase", "migrations", MIGRATION_FILE)
  if (!existsSync(sqlPath)) fail(`Missing ${MIGRATION_FILE}`)
  const sql = readFileSync(sqlPath, "utf8")

  const client = new pg.Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  try {
    const pre = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'staff' AND column_name = 'salary_basis')
          OR (table_name = 'payroll_entries' AND column_name IN ('salary_basis', 'period_basic_pay', 'one_off_items_snapshot'))
          OR (table_name = 'allowances' AND column_name = 'payroll_run_id')
          OR (table_name = 'deductions' AND column_name = 'payroll_run_id')
        )
      ORDER BY table_name, column_name
    `)
    console.log("Pre-apply columns:", pre.rows.map((r) => r.column_name).join(", ") || "(none)")

    console.log(`Applying ${MIGRATION_FILE}...`)
    await client.query(sql)
    console.log("Migration applied.")

    const post = await client.query(`
      SELECT
        (SELECT salary_basis FROM public.staff WHERE salary_basis IS NULL LIMIT 1) AS null_basis,
        (SELECT COUNT(*)::int FROM public.staff WHERE salary_basis = 'monthly') AS monthly_staff,
        (SELECT COUNT(*)::int FROM public.staff) AS total_staff,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE indexname = 'ux_allowances_one_off_run_assignment') AS allowance_ux,
        (SELECT COUNT(*)::int FROM pg_indexes WHERE indexname = 'ux_deductions_one_off_run_assignment') AS deduction_ux
    `)
    const row = post.rows[0]
    if (row.null_basis != null) fail("staff.salary_basis still has NULL values")
    if (row.allowance_ux !== 1 || row.deduction_ux !== 1) fail("One-off unique indexes missing")
    console.log("SQL verify OK:", row)

    const rest = await fetch(`${url}/rest/v1/staff?select=id,salary_basis,basic_salary&limit=1`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    })
    if (!rest.ok) fail(`REST verify failed: ${rest.status} ${await rest.text()}`)
    const sample = await rest.json()
    console.log("REST sample staff:", sample[0] || "(empty)")
    console.log("Phase 1B migration 534 verified on staging.")
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
