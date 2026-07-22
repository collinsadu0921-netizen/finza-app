/**
 * Apply forward-only staging migrations via direct Postgres connection.
 *   SUPABASE_DB_PASSWORD=*** node scripts/apply-staging-migrations.mjs 532 533
 *
 * If unset, loads only SUPABASE_DB_PASSWORD from .env.staging (no other keys).
 */
import { readFileSync, readdirSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"

function loadStagingDbPasswordFromEnvFile() {
  if (process.env.SUPABASE_DB_PASSWORD) return
  const path = resolve(REPO_ROOT, ".env.staging")
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    if (key !== "SUPABASE_DB_PASSWORD") continue
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (val) process.env.SUPABASE_DB_PASSWORD = val
    return
  }
}

async function main() {
  loadStagingDbPasswordFromEnvFile()

  const password = process.env.SUPABASE_DB_PASSWORD
  if (!password) {
    console.error("SUPABASE_DB_PASSWORD required (env or .env.staging)")
    process.exit(1)
  }

  const migrationNums = process.argv.slice(2)
  const allMigrations = readdirSync(resolve(REPO_ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql"))
  const toApply = migrationNums.length
    ? allMigrations.filter((f) => migrationNums.some((n) => f.startsWith(`${n}_`))).sort()
    : []

  if (!toApply.length) {
    console.error("No migrations matched:", migrationNums.join(", "))
    process.exit(1)
  }

  const conn = `postgresql://postgres.${STAGING_REF}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
  if (!conn.includes(STAGING_REF) || conn.includes(PRODUCTION_REF)) {
    console.error("Refused: connection string must target staging only")
    process.exit(1)
  }

  console.log(`Target staging ref=${STAGING_REF}`)

  const pg = (await import("pg")).default
  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    for (const file of toApply) {
      const sql = readFileSync(resolve(REPO_ROOT, "supabase/migrations", file), "utf8")
      console.log(`Applying ${file}...`)
      await client.query(sql)
      console.log("  OK")
    }
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
