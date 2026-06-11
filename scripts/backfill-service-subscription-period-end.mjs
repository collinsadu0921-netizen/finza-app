/**
 * One-time repair: set current_period_ends_at for active paid rows missing period end.
 *
 * Usage (from repo root, requires .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL):
 *   node scripts/backfill-service-subscription-period-end.mjs list
 *   node scripts/backfill-service-subscription-period-end.mjs --apply
 *   node scripts/backfill-service-subscription-period-end.mjs --apply --id <business_uuid>
 *
 * Default is dry-run (list only). Does not run on page loads.
 */

import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

function loadEnvLocal() {
  const path = resolve(root, ".env.local")
  if (!existsSync(path)) return
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
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const BILLING_CYCLES = new Set(["monthly", "quarterly", "annual"])

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
}

function addCycle(baseIso, cycle) {
  const base = new Date(baseIso)
  if (cycle === "monthly") {
    base.setMonth(base.getMonth() + 1)
  } else if (cycle === "quarterly") {
    base.setMonth(base.getMonth() + 3)
  } else {
    base.setFullYear(base.getFullYear() + 1)
  }
  return base.toISOString()
}

async function rest(path, options = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers, ...options })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) throw new Error(typeof body === "object" ? JSON.stringify(body) : text)
  return body
}

function parseArgs(argv) {
  const apply = argv.includes("--apply")
  const idIdx = argv.indexOf("--id")
  const businessId = idIdx >= 0 && argv[idIdx + 1] ? argv[idIdx + 1].trim() : null
  const listOnly = argv.includes("list") || (!apply && !businessId)
  return { apply, businessId, listOnly }
}

async function fetchCandidates(businessId) {
  const filters = [
    "archived_at=is.null",
    "billing_exempt=eq.false",
    "service_subscription_status=eq.active",
    "subscription_started_at=not.is.null",
    "current_period_ends_at=is.null",
    "billing_cycle=in.(monthly,quarterly,annual)",
    "industry=in.(service,professional)",
  ]
  if (businessId) filters.push(`id=eq.${businessId}`)
  const q = `businesses?select=id,name,email,billing_cycle,subscription_started_at,current_period_ends_at&${filters.join("&")}`
  return rest(q)
}

async function main() {
  const { apply, businessId, listOnly } = parseArgs(process.argv.slice(2))
  const rows = await fetchCandidates(businessId)

  if (!rows.length) {
    console.log("No matching businesses.")
    return
  }

  console.log(`\nCandidates (${rows.length}):\n`)
  for (const b of rows) {
    const next = addCycle(b.subscription_started_at, b.billing_cycle)
    console.log(
      `  ${b.id}\n    name: ${b.name ?? "(none)"}  email: ${b.email ?? "(none)"}\n    cycle: ${b.billing_cycle}  started: ${b.subscription_started_at}\n    -> current_period_ends_at: ${next}\n`
    )
  }

  if (listOnly && !apply) {
    console.log("Dry run only. Pass --apply to patch rows above.")
    return
  }

  let ok = 0
  let failed = 0
  for (const b of rows) {
    const next = addCycle(b.subscription_started_at, b.billing_cycle)
    if (!BILLING_CYCLES.has(b.billing_cycle)) {
      console.error(`Skip ${b.id}: invalid billing_cycle`)
      failed++
      continue
    }
    try {
      const patched = await rest(
        `businesses?id=eq.${b.id}&archived_at=is.null&current_period_ends_at=is.null&select=id,current_period_ends_at`,
        {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify({
            current_period_ends_at: next,
            updated_at: new Date().toISOString(),
          }),
        }
      )
      if (!patched?.length) {
        console.error(`No row updated for ${b.id} (may have been fixed already)`)
        failed++
      } else {
        console.log(`OK: ${b.id} period end -> ${patched[0].current_period_ends_at}`)
        ok++
      }
    } catch (e) {
      console.error(`Failed ${b.id}:`, e.message || e)
      failed++
    }
  }

  console.log(`\nDone. updated=${ok} failed=${failed}`)
  if (failed) process.exit(1)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
