/**
 * Load Vault secrets used by invoke_accounting_snapshot_recovery_worker (546).
 * Staging only (adonhhtooawkeemdqqeo). Does not print secret values.
 *
 * Required env (or .env.staging):
 *   SUPABASE_DB_PASSWORD
 *   ACCOUNTING_SNAPSHOT_CRON_URL  (full process URL)
 *   CRON_SECRET or ACCOUNTING_SNAPSHOT_CRON_SECRET
 *   VERCEL_AUTOMATION_BYPASS_SECRET
 *
 * Usage:
 *   node scripts/staging-setup-snapshot-recovery-secrets.mjs
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"

const SECRET_NAMES = {
  url: "accounting_snapshot_cron_url",
  secret: "accounting_snapshot_cron_secret",
  bypass: "accounting_snapshot_vercel_bypass",
}

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#") || !t.includes("=")) continue
    const i = t.indexOf("=")
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = val
    }
  }
}

function requireEnv(name) {
  const v = (process.env[name] || "").trim()
  if (!v) {
    console.error(`Missing required env: ${name}`)
    process.exit(1)
  }
  return v
}

async function upsertVaultSecret(client, name, value, description) {
  const existing = await client.query(
    `select id from vault.secrets where name = $1 limit 1`,
    [name]
  )
  if (existing.rowCount > 0) {
    await client.query(`select vault.update_secret($1::uuid, $2::text, $3::text, $4::text)`, [
      existing.rows[0].id,
      value,
      name,
      description,
    ])
    console.log(`updated_vault_secret name=${name} len=${value.length}`)
    return
  }
  await client.query(`select vault.create_secret($1::text, $2::text, $3::text)`, [
    value,
    name,
    description,
  ])
  console.log(`created_vault_secret name=${name} len=${value.length}`)
}

async function main() {
  loadEnvFile(resolve(REPO_ROOT, ".env.staging"))

  const password = requireEnv("SUPABASE_DB_PASSWORD")
  const url = requireEnv("ACCOUNTING_SNAPSHOT_CRON_URL")
  const secret = (
    process.env.ACCOUNTING_SNAPSHOT_CRON_SECRET ||
    process.env.CRON_SECRET ||
    ""
  ).trim()
  const bypass = requireEnv("VERCEL_AUTOMATION_BYPASS_SECRET")

  if (!secret) {
    console.error("Missing CRON_SECRET or ACCOUNTING_SNAPSHOT_CRON_SECRET")
    process.exit(1)
  }

  if (url.includes(PRODUCTION_REF) || /app\.finza\.africa/i.test(url)) {
    console.error("Refused: ACCOUNTING_SNAPSHOT_CRON_URL looks like production")
    process.exit(1)
  }

  const conn = `postgresql://postgres.${STAGING_REF}:${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
  if (!conn.includes(STAGING_REF) || conn.includes(PRODUCTION_REF)) {
    console.error("Refused: connection must target staging only")
    process.exit(1)
  }

  const pg = (await import("pg")).default
  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await upsertVaultSecret(
      client,
      SECRET_NAMES.url,
      url,
      "Staging accounting snapshot process URL"
    )
    await upsertVaultSecret(
      client,
      SECRET_NAMES.secret,
      secret,
      "Staging CRON_SECRET for accounting snapshot worker"
    )
    await upsertVaultSecret(
      client,
      SECRET_NAMES.bypass,
      bypass,
      "Vercel protection bypass for staging Preview worker"
    )

    const probe = await client.query(
      `select public.invoke_accounting_snapshot_recovery_worker() as result`
    )
    const result = probe.rows[0]?.result
    console.log(
      "invoke_probe",
      JSON.stringify({
        ok: result?.ok ?? null,
        has_request_id: result?.request_id != null,
        error: result?.error ?? null,
      })
    )

    const job = await client.query(
      `select jobid, jobname, schedule, active from cron.job where jobname = 'accounting-snapshot-recovery'`
    )
    console.log("cron_job", JSON.stringify(job.rows[0] || null))
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
