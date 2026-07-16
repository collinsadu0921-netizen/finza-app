/**
 * Staging-only: refresh P&L movement snapshot for the load-test business before k6 gates.
 *
 * Prerequisites:
 *   - Copy .env.staging.example → .env.staging (staging Supabase keys only)
 *   - NEXT_PUBLIC_SUPABASE_URL must be staging ref adonhhtooawkeemdqqeo
 *   - SUPABASE_SERVICE_ROLE_KEY must be set (no hardcoded fallback)
 *
 * Usage:
 *   node scripts/prime-staging-pnl-snapshot.mjs
 *   node scripts/prime-staging-pnl-snapshot.mjs --period-start=2026-07-01 --period-end=2026-07-31
 *   node scripts/prime-staging-pnl-snapshot.mjs --business-id=<uuid>
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createClient } from "@supabase/supabase-js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const REQUIRED_STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const LOAD_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const DEFAULT_PERIOD_START = "2026-07-01"
const DEFAULT_PERIOD_END = "2026-07-31"

function loadEnvStagingOnly() {
  const path = resolve(root, ".env.staging")
  if (!existsSync(path)) return false
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
    // Prefer already-set process env (CI / local overrides); never log values.
    if (!process.env[key]) process.env[key] = val
  }
  return true
}

function argValue(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.split("=").slice(1).join("=").trim() : fallback
}

function fail(msg) {
  console.error(`\n[prime-staging-pnl-snapshot] ERROR: ${msg}\n`)
  process.exit(1)
}

function extractProjectRef(supabaseUrl) {
  try {
    const host = new URL(supabaseUrl).hostname
    const m = host.match(/^([a-z0-9]+)\.supabase\.co$/i)
    return m ? m[1] : null
  } catch {
    return null
  }
}

function assertStagingSafe() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) {
    fail(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Set it in .env.staging (copy from .env.staging.example)."
    )
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) {
    fail(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Set it in .env.staging (copy from .env.staging.example)."
    )
  }

  const ref = extractProjectRef(url)
  if (ref === PRODUCTION_REF || url.includes(PRODUCTION_REF)) {
    fail("Refusing production Supabase ref")
  }
  if (ref !== REQUIRED_STAGING_REF) {
    fail(
      `Refusing to run: detected Supabase ref is "${ref ?? "unknown"}", ` +
        `expected exactly "${REQUIRED_STAGING_REF}".`
    )
  }

  const prodRef = process.env.FINZA_PRODUCTION_SUPABASE_PROJECT_REF?.trim()
  if (prodRef && prodRef === ref) {
    fail(
      `Supabase URL project ref "${ref}" matches FINZA_PRODUCTION_SUPABASE_PROJECT_REF. Use staging project only.`
    )
  }

  return { url, key, ref }
}

async function main() {
  const loaded = loadEnvStagingOnly()
  if (!loaded) {
    console.log(
      "[prime-staging-pnl-snapshot] .env.staging not found — using process environment only"
    )
  }

  const { url, key, ref } = assertStagingSafe()

  const businessId = argValue("--business-id", LOAD_BUSINESS_ID)
  const periodStart = argValue("--period-start", DEFAULT_PERIOD_START)
  const periodEnd = argValue("--period-end", DEFAULT_PERIOD_END)

  if (!businessId || !periodStart || !periodEnd) {
    fail("business-id, period-start, and period-end are required")
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log("[prime-staging-pnl-snapshot] Refreshing P&L snapshot")
  console.log(`  supabase_ref:  ${ref}`)
  console.log(`  business_id:   ${businessId}`)
  console.log(`  period:        ${periodStart} → ${periodEnd}`)

  const { data: beforeMeta } = await supabase.rpc("get_service_pnl_movement_snapshot_metadata", {
    p_business_id: businessId,
    p_start_date: periodStart,
    p_end_date: periodEnd,
    p_max_stale_seconds: 300,
  })
  const beforeRow = Array.isArray(beforeMeta) ? beforeMeta[0] : beforeMeta
  console.log(
    `  before (fresh): ${beforeRow?.refreshed_at ?? "none"} line_count=${beforeRow?.line_count ?? 0}`
  )

  const { data, error } = await supabase.rpc("finza_worker_refresh_pnl_snapshot", {
    p_business_id: businessId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })

  if (error) {
    fail(`finza_worker_refresh_pnl_snapshot failed: ${error.message}`)
  }

  console.log(`  worker result: ${data}`)

  const { data: afterMeta, error: metaError } = await supabase.rpc(
    "get_service_pnl_movement_snapshot_metadata",
    {
      p_business_id: businessId,
      p_start_date: periodStart,
      p_end_date: periodEnd,
      p_max_stale_seconds: 300,
    }
  )
  if (metaError) {
    fail(`get_service_pnl_movement_snapshot_metadata failed: ${metaError.message}`)
  }

  const afterRow = Array.isArray(afterMeta) ? afterMeta[0] : afterMeta
  if (!afterRow?.refreshed_at) {
    fail("Snapshot still missing after refresh — check accounting_periods for this range")
  }

  console.log(
    `  after (fresh):  ${afterRow.refreshed_at} line_count=${afterRow.line_count ?? 0}`
  )
  console.log("[prime-staging-pnl-snapshot] Done — snapshot is within 300s freshness window")
}

main().catch((err) => {
  console.error(`[prime-staging-pnl-snapshot] ERROR: ${err?.message || err}`)
  process.exit(1)
})
