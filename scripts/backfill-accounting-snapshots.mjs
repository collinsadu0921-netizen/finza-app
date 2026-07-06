#!/usr/bin/env node
/**
 * One-time / periodic backfill for accounting snapshot read models (522).
 *
 * Dry-run by default:
 *   node scripts/backfill-accounting-snapshots.mjs
 *
 * Write mode (production guard):
 *   ALLOW_PRODUCTION_SNAPSHOT_BACKFILL=1 node scripts/backfill-accounting-snapshots.mjs --write
 *
 * Requires .env.local with production NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const PROD_REF = "qjxhibvbmzogyzbhswjj"

config({ path: resolve(ROOT, ".env.local") })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const writeMode = process.argv.includes("--write")
const allowProd = process.env.ALLOW_PRODUCTION_SNAPSHOT_BACKFILL === "1"

if (!url?.includes(PROD_REF) || !key) {
  console.error(`Need production .env.local with ${PROD_REF} and SUPABASE_SERVICE_ROLE_KEY`)
  process.exit(1)
}

if (writeMode && !allowProd) {
  console.error("Write mode requires ALLOW_PRODUCTION_SNAPSHOT_BACKFILL=1")
  process.exit(1)
}

const hdrs = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
}

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...hdrs, ...(init.headers || {}) } })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function rpc(name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function fetchAll(table, select, filter = "") {
  const rows = []
  let offset = 0
  const pageSize = 1000
  while (true) {
    const q = `${table}?select=${encodeURIComponent(select)}${filter}&limit=${pageSize}&offset=${offset}`
    const { ok, json } = await rest(q)
    if (!ok) throw new Error(`fetch ${table} failed`)
    rows.push(...json)
    if (json.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function main() {
  console.log("=== Accounting snapshot backfill ===")
  console.log({ mode: writeMode ? "write" : "dry-run", project: PROD_REF })

  const periods = await fetchAll(
    "accounting_periods",
    "business_id,period_start,period_end"
  )
  const businessIds = [...new Set(periods.map((p) => p.business_id).filter(Boolean))]

  const stats = {
    businesses_scanned: businessIds.length,
    periods_scanned: periods.length,
    dashboard_summaries_refreshed: 0,
    pnl_snapshots_refreshed: 0,
    zero_movement_metadata_created: 0,
    errors: [],
  }

  for (const period of periods) {
    const { business_id: businessId, period_start: ps, period_end: pe } = period

    const live = await rpc("period_has_live_pnl_movement", {
      p_business_id: businessId,
      p_start_date: ps,
      p_end_date: pe,
    })

    if (!live.ok) {
      stats.errors.push({ businessId, ps, pe, step: "live_probe", error: live.text?.slice(0, 200) })
      continue
    }

    const hasLive = Boolean(live.json)

    if (writeMode) {
      const dash = await rpc("finza_worker_refresh_dashboard_period_summary", {
        p_business_id: businessId,
        p_period_start: ps,
        p_period_end: pe,
      })
      if (!dash.ok) {
        stats.errors.push({ businessId, ps, pe, step: "dashboard", error: dash.text?.slice(0, 200) })
        continue
      }
      stats.dashboard_summaries_refreshed++

      if (hasLive) {
        const pnl = await rpc("finza_worker_refresh_pnl_snapshot", {
          p_business_id: businessId,
          p_period_start: ps,
          p_period_end: pe,
        })
        if (!pnl.ok) {
          stats.errors.push({ businessId, ps, pe, step: "pnl", error: pnl.text?.slice(0, 200) })
          continue
        }
        stats.pnl_snapshots_refreshed++
      } else {
        const zero = await rpc("finza_worker_write_zero_period_snapshots", {
          p_business_id: businessId,
          p_period_start: ps,
          p_period_end: pe,
        })
        if (!zero.ok) {
          stats.errors.push({ businessId, ps, pe, step: "zero", error: zero.text?.slice(0, 200) })
          continue
        }
        stats.zero_movement_metadata_created++
      }
    } else {
      if (hasLive) stats.pnl_snapshots_refreshed++
      else stats.zero_movement_metadata_created++
      stats.dashboard_summaries_refreshed++
    }
  }

  console.log(JSON.stringify(stats, null, 2))
  if (stats.errors.length) {
    console.warn("First errors:", stats.errors.slice(0, 5))
  }
  if (!writeMode) {
    console.log("\nDry-run complete. Re-run with --write and ALLOW_PRODUCTION_SNAPSHOT_BACKFILL=1 to apply.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
