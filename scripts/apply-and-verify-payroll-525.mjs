/**
 * Apply migration 525 to staging only, then verify via PostgREST.
 *
 *   SUPABASE_DB_PASSWORD=*** node scripts/apply-and-verify-payroll-525.mjs
 *
 * Safety:
 * - Hard-coded staging project ref adonhhtooawkeemdqqeo
 * - Refuses production ref
 * - Loads .env.staging for REST verification only
 * - Does not touch payroll corrections product logic
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const MIGRATION_FILE = "525_payroll_period_duplicate_guard.sql"

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
        AND table_name = 'payroll_runs'
        AND column_name IN (
          'pay_period_start',
          'pay_period_end',
          'payroll_frequency',
          'run_type',
          'staff_scope_fingerprint',
          'corrects_payroll_run_id'
        )
      ORDER BY column_name
    `)
    const existing = new Set(pre.rows.map((r) => r.column_name))
    console.log("Pre-apply period columns:", [...existing].join(", ") || "(none)")

    if (
      existing.has("pay_period_start") &&
      existing.has("pay_period_end") &&
      existing.has("payroll_frequency") &&
      existing.has("run_type") &&
      existing.has("staff_scope_fingerprint")
    ) {
      console.log("Migration 525 objects already present — skipping apply.")
    } else {
      const collision = await client.query(`
        WITH active AS (
          SELECT
            id,
            business_id,
            status,
            payroll_month,
            date_trunc('month', payroll_month)::date AS month_start
          FROM public.payroll_runs
          WHERE deleted_at IS NULL
        )
        SELECT business_id, month_start, count(*)::int AS n, array_agg(id::text ORDER BY payroll_month, id) AS ids
        FROM active
        GROUP BY business_id, month_start
        HAVING count(*) > 1
      `)
      console.log("Preflight same-calendar-month groups:", collision.rowCount)
      for (const row of collision.rows) {
        console.log(" ", row.business_id, row.month_start.toISOString?.().slice(0, 10) || row.month_start, "n=" + row.n)
      }

      const sql = readFileSync(resolve(REPO_ROOT, "supabase/migrations", MIGRATION_FILE), "utf8")
      console.log(`Applying ${MIGRATION_FILE}...`)
      await client.query("BEGIN")
      try {
        await client.query(sql)
        // Best-effort history insert; column shapes vary across CLI versions.
        await client.query(`
          DO $$
          BEGIN
            IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
              RETURN;
            END IF;
            BEGIN
              INSERT INTO supabase_migrations.schema_migrations (version)
              VALUES ('525')
              ON CONFLICT DO NOTHING;
            EXCEPTION WHEN OTHERS THEN
              RAISE NOTICE 'schema_migrations insert skipped: %', SQLERRM;
            END;
          END $$;
        `)
        await client.query("COMMIT")
        console.log("  OK (committed)")
      } catch (err) {
        await client.query("ROLLBACK")
        throw err
      }
    }

    const post = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payroll_runs'
        AND column_name IN (
          'pay_period_start',
          'pay_period_end',
          'payroll_frequency',
          'run_type',
          'staff_scope_fingerprint',
          'corrects_payroll_run_id'
        )
      ORDER BY column_name
    `)
    console.log(
      "Post-apply period columns:",
      post.rows.map((r) => r.column_name).join(", ")
    )

    const idx = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'payroll_runs'
        AND indexname IN ('ux_payroll_runs_period_scope_active', 'idx_payroll_runs_pay_period')
      ORDER BY indexname
    `)
    console.log("Period indexes:", idx.rows.map((r) => r.indexname).join(", ") || "(none)")

    const sample = await client.query(`
      SELECT
        count(*)::int AS runs,
        count(*) FILTER (WHERE pay_period_start IS NULL)::int AS null_start,
        count(*) FILTER (WHERE pay_period_end < pay_period_start)::int AS invalid_range,
        count(*) FILTER (WHERE status IN ('approved','locked') AND journal_entry_id IS NULL)::int AS approved_without_journal
      FROM public.payroll_runs
      WHERE deleted_at IS NULL
    `)
    console.log("Data checks:", sample.rows[0])
  } finally {
    await client.end()
  }

  // REST confirmation using staging service role (no secrets printed).
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  }
  const rest = await fetch(
    `${url}/rest/v1/payroll_runs?select=id,pay_period_start,pay_period_end,payroll_frequency,run_type,staff_scope_fingerprint&limit=1`,
    { headers }
  )
  const body = await rest.text()
  if (!rest.ok) fail(`REST verification failed: ${rest.status} ${body.slice(0, 300)}`)
  console.log("REST verification: OK (period columns selectable)")
  console.log("Phase 1A migration apply: COMPLETE")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
