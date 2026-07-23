/**
 * Staging acceptance for accounting freshness (Checkpoint 2).
 * Target: Materials staging business on adonhhtooawkeemdqqeo only.
 *
 *   node scripts/staging-accounting-freshness-acceptance.mjs
 *   node scripts/staging-accounting-freshness-acceptance.mjs --recovery
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const BUSINESS_ID = "b4766e05-f5c0-4232-a97f-4dfba6e1f0c2"
const recovery = process.argv.includes("--recovery")

function loadEnv() {
  const path = resolve(REPO_ROOT, ".env.staging")
  if (!existsSync(path)) throw new Error(".env.staging missing")
  const out = {}
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const dbPass = env.SUPABASE_DB_PASSWORD
if (!url?.includes(STAGING_REF)) throw new Error("Refusing non-staging Supabase URL")

const sb = createClient(url, key, { auth: { persistSession: false } })
const timings = {}

function mark(name, ms) {
  timings[name] = ms
  console.log(`timing ${name}=${ms}ms`)
}

async function queueDiag() {
  const { data, error } = await sb.rpc("get_accounting_snapshot_queue_diagnostics", {
    p_business_id: BUSINESS_ID,
  })
  if (error) throw error
  return data
}

async function pgClient() {
  const conn =
    `postgresql://postgres.${STAGING_REF}:` +
    `${encodeURIComponent(dbPass)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
  const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await c.connect()
  return c
}

async function main() {
  console.log("business", BUSINESS_ID)
  console.log("mode", recovery ? "recovery" : "immediate")

  const before = await queueDiag()
  console.log("queue_before", before)
  if ((before.pending ?? 0) + (before.running ?? 0) > 0) {
    console.warn("WARN: queue not clean at start; continuing")
  }

  const c = await pgClient()
  try {
    const period = await c.query(
      `select period_start, period_end from accounting_periods
       where business_id = $1 and period_start = date '2026-07-01' limit 1`,
      [BUSINESS_ID]
    )
    if (!period.rows[0]) throw new Error("July 2026 period missing")
    const { period_start, period_end } = period.rows[0]
    console.log("period", period_start.toISOString?.() ?? period_start, period_end)

    // Find a material with stock and an allocated/consumed usage path, or post a small JE for COGS probe.
    // Prefer posting a controlled balanced JE Dr 5110 / Cr 1450 for isolation.
    const accounts = await c.query(
      `select code, id from accounts
       where business_id = $1 and code in ('5110','1450')`,
      [BUSINESS_ID]
    )
    const byCode = Object.fromEntries(accounts.rows.map((r) => [r.code, r.id]))
    if (!byCode["5110"] || !byCode["1450"]) {
      throw new Error("Missing 5110 or 1450 accounts on Materials staging")
    }

    const owner = await c.query(
      `select owner_id from businesses where id = $1`,
      [BUSINESS_ID]
    )
    const ownerId = owner.rows[0]?.owner_id

    const t0 = Date.now()
    const je = await c.query(
      `insert into journal_entries (business_id, date, description, created_by, posting_source)
       values ($1, date '2026-07-15', $2, $3, 'system')
       returning id`,
      [
        BUSINESS_ID,
        recovery
          ? "freshness acceptance recovery probe"
          : "freshness acceptance immediate probe",
        ownerId,
      ]
    )
    const jeId = je.rows[0].id
    await c.query(
      `insert into journal_entry_lines (journal_entry_id, account_id, debit, credit)
       values
         ($1, $2, 12.34, 0),
         ($1, $3, 0, 12.34)`,
      [jeId, byCode["5110"], byCode["1450"]]
    )
    mark("journal_mutation_ms", Date.now() - t0)
    console.log("journal_id", jeId)

    const lines = await c.query(
      `select a.code, jel.debit, jel.credit
       from journal_entry_lines jel
       join accounts a on a.id = jel.account_id
       where jel.journal_entry_id = $1
       order by a.code`,
      [jeId]
    )
    console.log("journal_lines", lines.rows)

    // Immediate P&L live/snapshot read
    const tPnl = Date.now()
    const { data: pnl, error: pnlErr } = await sb.rpc("get_profit_and_loss_movement", {
      p_business_id: BUSINESS_ID,
      p_start_date: "2026-07-01",
      p_end_date: "2026-07-31",
    })
    if (pnlErr) throw pnlErr
    mark("first_pnl_live_ms", Date.now() - tPnl)
    const cogs = (pnl ?? []).find((r) => String(r.account_code) === "5110")
    const cogsTotal = Number(cogs?.period_total ?? 0)
    console.log("pnl_5110_period_total", cogsTotal)
    if (cogsTotal < 12.34) {
      throw new Error(`P&L 5110 missing probe amount; got ${cogsTotal}`)
    }

    const afterPost = await queueDiag()
    console.log("queue_after_post", afterPost)

    if (!recovery) {
      // Targeted processor (service role)
      const tProc = Date.now()
      const { data: claimed, error: claimErr } = await sb.rpc(
        "claim_accounting_snapshot_refresh_jobs_for_period",
        {
          p_business_id: BUSINESS_ID,
          p_period_start: "2026-07-01",
          p_period_end: "2026-07-31",
          p_limit: 5,
          p_lease_seconds: 900,
        }
      )
      if (claimErr) throw claimErr
      const jobs = claimed ?? []
      console.log(
        "scoped_claim",
        jobs.map((j) => ({
          id: j.id,
          business_id: j.business_id,
          period_start: j.period_start,
          period_end: j.period_end,
          job_type: j.job_type,
        }))
      )
      for (const j of jobs) {
        if (j.business_id !== BUSINESS_ID) throw new Error("cross-tenant claim")
        const { error: refreshErr } = await sb.rpc("finza_worker_refresh_period_snapshots", {
          p_business_id: j.business_id,
          p_period_start: j.period_start,
          p_period_end: j.period_end,
          p_job_type: j.job_type,
        })
        if (refreshErr) throw refreshErr
        const { error: completeErr } = await sb.rpc("complete_accounting_snapshot_refresh_job", {
          p_job_id: j.id,
          p_claim_token: j.claim_token,
        })
        if (completeErr) throw completeErr
      }
      mark("targeted_snapshot_completion_ms", Date.now() - tProc)

      const tSnap = Date.now()
      const { data: meta, error: metaErr } = await sb.rpc(
        "get_service_pnl_movement_snapshot_metadata",
        {
          p_business_id: BUSINESS_ID,
          p_start_date: "2026-07-01",
          p_end_date: "2026-07-31",
          p_max_stale_seconds: 300,
        }
      )
      if (metaErr) throw metaErr
      mark("fresh_snapshot_read_ms", Date.now() - tSnap)
      console.log("fresh_snapshot_meta", meta)

      const { data: dash, error: dashErr } = await sb.rpc(
        "get_fresh_service_dashboard_period_pnl",
        {
          p_business_id: BUSINESS_ID,
          p_start_date: "2026-07-01",
          p_end_date: "2026-07-31",
          p_max_stale_seconds: 300,
        }
      )
      if (dashErr) throw dashErr
      console.log("dashboard_fresh_summary", dash)
    } else {
      console.log("recovery mode: leaving durable job for five-minute worker; not claiming")
      if ((afterPost.pending ?? 0) < 1) {
        console.warn("WARN: expected pending job after post")
      }
    }

    console.log("TIMINGS", timings)
    console.log("ACCEPTANCE_OK")
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
