/**
 * Set billing_exempt on a business (founder/internal).
 * Usage: node scripts/mark-billing-exempt.mjs <business_uuid>
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

/** Finza internal workspace ids (founder / demo / support). */
const FINZA_INTERNAL_IDS = [
  "2abf2da3-12dc-4ec6-b547-89900d67e5e9", // Finza — Admin@finza.africa
  "d5391d1c-ace5-4f42-a49a-2d1897f0ef1e", // Support — Support@finza.africa
]

const rawArgs = process.argv.slice(2).map((a) => a.trim()).filter(Boolean)
if (rawArgs.length === 0) {
  console.error("Usage: node scripts/mark-billing-exempt.mjs <business_uuid> [more...]")
  console.error("       node scripts/mark-billing-exempt.mjs --finza-internal")
  console.error("  UUIDs must not include < or > brackets.")
  process.exit(1)
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let businessIds
if (rawArgs.length === 1 && rawArgs[0] === "--finza-internal") {
  businessIds = [...FINZA_INTERNAL_IDS]
} else {
  businessIds = rawArgs.map((raw) => raw.replace(/^<|>$/g, ""))
  for (const id of businessIds) {
    if (!uuidRe.test(id)) {
      console.error(`Invalid UUID: "${id}" (remove angle brackets if present)`)
      process.exit(1)
    }
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
}

const patch = {
  billing_exempt: true,
  billing_exempt_reason: "founder_internal_account",
  service_subscription_tier: "business",
  service_subscription_status: "active",
  billing_cycle: "annual",
  current_period_ends_at: "2099-12-31T23:59:59.000Z",
  subscription_grace_until: null,
  trial_started_at: null,
  trial_ends_at: null,
  updated_at: new Date().toISOString(),
}

let failed = false
for (const businessId of businessIds) {
  const res = await fetch(
    `${url}/rest/v1/businesses?id=eq.${businessId}&archived_at=is.null`,
    { method: "PATCH", headers, body: JSON.stringify(patch) }
  )
  const text = await res.text()
  if (!res.ok) {
    console.error(`PATCH failed for ${businessId}:`, res.status, text)
    failed = true
    continue
  }

  const rows = JSON.parse(text)
  if (!rows.length) {
    console.error(`No business updated for ${businessId} — check id / migration 485.`)
    failed = true
    continue
  }

  const b = rows[0]
  console.log(`OK: ${b.name ?? businessId} (${b.email ?? "no email"})`)
  console.log(
    `  billing_exempt=${b.billing_exempt}  tier=${b.service_subscription_tier}  status=${b.service_subscription_status}`
  )
}

if (failed) process.exit(1)
