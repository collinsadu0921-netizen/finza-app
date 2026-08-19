/**
 * Apply migration 574 to staging only
 */
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"

function loadEnv() {
  return Object.fromEntries(
    readFileSync(resolve(REPO_ROOT, ".env.staging"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=")
        let v = l.slice(i + 1).trim()
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1)
        }
        return [l.slice(0, i).trim(), v]
      })
  )
}

const env = loadEnv()
const conn =
  `postgresql://postgres.${STAGING_REF}:` +
  `${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`

const pg = createRequire(import.meta.url)("pg")
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

const exists = await client.query(
  `SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '574'`
)
if (exists.rowCount > 0) {
  console.log("574 already applied — skipping")
} else {
  const sql = readFileSync(
    resolve(REPO_ROOT, "supabase/migrations/574_accounting_firm_staff_invitations.sql"),
    "utf8"
  )
  await client.query("BEGIN")
  try {
    await client.query(sql)
    await client.query(
      `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
       VALUES ('574', '574_accounting_firm_staff_invitations', ARRAY[]::text[])`
    )
    await client.query("COMMIT")
    console.log("574 applied successfully")
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  }
}

const tableCheck = await client.query(
  `SELECT 1 FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'accounting_firm_staff_invitations'`
)
console.log("table exists:", tableCheck.rowCount > 0)

await client.end()
