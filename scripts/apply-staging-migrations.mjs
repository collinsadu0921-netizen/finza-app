/**
 * Apply forward-only staging migrations via direct Postgres connection.
 *   SUPABASE_DB_PASSWORD=*** node scripts/apply-staging-migrations.mjs 532 533
 */
import { readFileSync, readdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"

async function main() {
  const password = process.env.SUPABASE_DB_PASSWORD
  if (!password) {
    console.error("SUPABASE_DB_PASSWORD required")
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
  if (!conn.includes(STAGING_REF)) process.exit(1)

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
