/**
 * Staging-only dashboard timeline audit (507/508/509).
 * Reads .env.staging ONLY — never .env.local (production ref guard).
 *
 * Usage:
 *   node scripts/audit-staging-dashboard-timeline.mjs
 *   node scripts/audit-staging-dashboard-timeline.mjs --api-only
 */

import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const REQUIRED_STAGING_REF = "adonhhtooawkeemdqqeo"
const LOAD_TEST_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const STAGING_APP_URL =
  process.env.STAGING_APP_URL?.trim() ||
  "https://finza-app-git-staging-collins-projects-f49524b8.vercel.app"

function loadEnvStagingOnly() {
  const path = resolve(root, ".env.staging")
  if (!existsSync(path)) {
    console.error("Missing .env.staging — copy from .env.staging.example (staging keys only).")
    console.error("Will run API-only audit if sessions.staging.json exists.")
    return false
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    process.env[key] = val
  }
  return true
}

function assertStagingRef(url) {
  const ref = url?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
  if (ref !== REQUIRED_STAGING_REF) {
    throw new Error(
      `Refusing audit: Supabase ref is "${ref ?? "unknown"}", expected "${REQUIRED_STAGING_REF}"`
    )
  }
  return ref
}

async function restGet(url, key, path) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  return { status: r.status, body: await r.text() }
}

async function rpc(url, key, name, args) {
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  })
  return { status: r.status, body: await r.text() }
}

async function auditDb(bid) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    console.log("DB audit skipped: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.staging")
    return
  }
  const ref = assertStagingRef(url)
  console.log("\n=== Staging DB audit ===")
  console.log("supabase_ref", ref)
  console.log("business_id", bid)

  const tableCheck = await restGet(
    url,
    key,
    `service_dashboard_period_summary?business_id=eq.${bid}&select=period_id,period_start,period_end,revenue,expenses,net_profit,refreshed_at&order=period_start.desc`
  )
  console.log("\n--- service_dashboard_period_summary ---")
  console.log("status", tableCheck.status)
  console.log(tableCheck.body.slice(0, 1500))

  const periods = await restGet(
    url,
    key,
    `accounting_periods?business_id=eq.${bid}&select=id,period_start,period_end&order=period_start.desc&limit=15`
  )
  console.log("\n--- accounting_periods (top 15) ---")
  console.log("status", periods.status)
  console.log(periods.body.slice(0, 800))

  const journalHead = await restGet(
    url,
    key,
    `journal_entries?business_id=eq.${bid}&select=id&limit=1`
  )
  console.log("\n--- journal_entries (exists?) ---")
  console.log("status", journalHead.status)
  console.log(journalHead.body.slice(0, 200))

  for (const [name, args] of [
    [
      "get_service_dashboard_timeline_from_summary",
      { p_business_id: bid, p_periods_limit: 12, p_max_stale_seconds: 300 },
    ],
    ["get_service_dashboard_timeline_stale_summary", { p_business_id: bid, p_periods_limit: 12 }],
    ["try_refresh_service_dashboard_period_summaries", { p_business_id: bid, p_periods_limit: 12 }],
    ["refresh_service_dashboard_period_summaries", { p_business_id: bid, p_periods_limit: 12 }],
    [
      "get_service_dashboard_timeline",
      {
        p_business_id: bid,
        p_start_date: null,
        p_end_date: null,
        p_granularity: "accounting_period",
        p_periods_limit: 12,
      },
    ],
  ]) {
    const r = await rpc(url, key, name, args)
    console.log(`\n--- rpc ${name} ---`)
    console.log("status", r.status)
    console.log(r.body.slice(0, 600))
  }
}

async function auditApi(bid) {
  const sessionPath = resolve(root, "load-tests/sessions.staging.json")
  if (!existsSync(sessionPath)) {
    console.log("\nAPI audit skipped: load-tests/sessions.staging.json not found")
    return
  }
  const sessions = JSON.parse(readFileSync(sessionPath, "utf8"))
  const s = sessions[0]
  const cookie = s.cookie || s.cookies?.map((c) => `${c.name}=${c.value}`).join("; ")
  if (!cookie) {
    console.log("\nAPI audit skipped: session cookie missing")
    return
  }

  console.log("\n=== Staging API audit ===")
  console.log("app_url", STAGING_APP_URL)

  async function get(path) {
    const r = await fetch(`${STAGING_APP_URL}${path}`, {
      headers: { cookie, accept: "application/json" },
    })
    const text = await r.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = { _parseError: text.slice(0, 80) }
    }
    return { status: r.status, body }
  }

  const cluster = await get(
    `/api/dashboard/service-cluster?business_id=${bid}&periods=12&activity_limit=10`
  )
  console.log("\n--- GET service-cluster ---")
  console.log("status", cluster.status)
  if (cluster.status === 200) {
    console.log("timeline.length", cluster.body.timeline?.length ?? "n/a")
    console.log("metrics.revenue", cluster.body.metrics?.revenue)
    console.log("activity.items", cluster.body.activity?.items?.length)
  } else {
    console.log(cluster.body)
  }

  const timeline = await get(`/api/dashboard/service-timeline?business_id=${bid}&periods=12`)
  console.log("\n--- GET service-timeline ---")
  console.log("status", timeline.status, "timeline.length", timeline.body.timeline?.length ?? "n/a")
}

const apiOnly = process.argv.includes("--api-only")
const hasStagingEnv = loadEnvStagingOnly()
const bid = process.env.STAGING_LOAD_BUSINESS_ID?.trim() || LOAD_TEST_BUSINESS_ID

await auditApi(bid)
if (hasStagingEnv && !apiOnly) {
  await auditDb(bid)
} else if (!hasStagingEnv) {
  console.log("\nDB audit not run (.env.staging missing). API audit above uses git-staging preview.")
}
