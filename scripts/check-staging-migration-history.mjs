/**
 * Read-only: list recent supabase_migrations.schema_migrations on staging.
 *   node scripts/check-staging-migration-history.mjs
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"

function loadPassword() {
  if (process.env.SUPABASE_DB_PASSWORD) return process.env.SUPABASE_DB_PASSWORD
  const path = resolve(REPO_ROOT, ".env.staging")
  if (!existsSync(path)) return null
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    if (t.slice(0, i).trim() !== "SUPABASE_DB_PASSWORD") continue
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    return val || null
  }
  return null
}

const password = loadPassword()
if (!password) {
  console.error("SUPABASE_DB_PASSWORD required")
  process.exit(1)
}

const conn =
  `postgresql://postgres.${STAGING_REF}:` +
  `${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`

if (!conn.includes(STAGING_REF) || conn.includes(PRODUCTION_REF)) {
  console.error("Refused: must target staging only")
  process.exit(1)
}

const pg = (await import("pg")).default
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  const cols = await client.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'supabase_migrations'
       and table_name = 'schema_migrations'
     order by 1`
  )
  console.log("schema_migrations columns:", cols.rows.map((r) => r.column_name))

  const rows = await client.query(
    `select *
     from supabase_migrations.schema_migrations
     order by version desc
     limit 40`
  )
  console.log(JSON.stringify(rows.rows, null, 2))

  const funcs = await client.query(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (
         p.proname like 'claim_accounting_snapshot%'
         or p.proname like 'test_accounting_snapshot%'
       )
     order by 1, 2`
  )
  console.log("claim/test funcs:", JSON.stringify(funcs.rows, null, 2))
} finally {
  await client.end()
}
