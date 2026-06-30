/**
 * Dev/ops: set service_subscription_tier for one business.
 *
 * Usage (from repo root, requires .env.local with SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL):
 *   node scripts/set-service-subscription-tier.mjs list
 *   node scripts/set-service-subscription-tier.mjs <business_id> business
 *   node scripts/set-service-subscription-tier.mjs --email owner@example.com professional
 *
 * Tiers: starter | professional | business
 */

import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

function loadEnvFile(filename) {
  const path = resolve(root, filename)
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

loadEnvFile(".env.staging")
loadEnvFile(".env.local")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const TIERS = ["starter", "professional", "business"]

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.staging or .env.local")
  process.exit(1)
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
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

async function listBusinesses() {
  const rows = await rest(
    "businesses?select=id,name,email,industry,service_subscription_tier,service_subscription_status,trial_ends_at&archived_at=is.null&order=created_at.desc&limit=20"
  )
  console.log("\nRecent businesses (service tier):\n")
  for (const b of rows) {
    console.log(
      `  ${b.id}\n    name: ${b.name ?? "(none)"}  email: ${b.email ?? "(none)"}\n    tier: ${b.service_subscription_tier}  status: ${b.service_subscription_status}${b.trial_ends_at ? `  trial_ends: ${b.trial_ends_at}` : ""}\n`
    )
  }
}

async function setTier(businessId, tier) {
  const t = tier.toLowerCase()
  if (!TIERS.includes(t)) {
    console.error(`Invalid tier "${tier}". Use: ${TIERS.join(", ")}`)
    process.exit(1)
  }

  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setFullYear(periodEnd.getFullYear() + 1)

  const patch = {
    service_subscription_tier: t,
    service_subscription_status: "active",
    trial_started_at: null,
    trial_ends_at: null,
    subscription_grace_until: null,
    current_period_ends_at: periodEnd.toISOString(),
    subscription_started_at: now.toISOString(),
    updated_at: now.toISOString(),
  }

  const rows = await rest(`businesses?id=eq.${businessId}&archived_at=is.null&select=id,name,service_subscription_tier`, {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  })

  if (!rows?.length) {
    console.error(`No business found for id ${businessId}`)
    process.exit(1)
  }

  console.log(`\nUpdated ${rows[0].name ?? businessId}:`)
  console.log(`  tier: ${rows[0].service_subscription_tier} → ${t}`)
  console.log(`  status: active, period ends ${periodEnd.toISOString().slice(0, 10)}\n`)
}

async function findByEmail(email) {
  const rows = await rest(
    `businesses?email=eq.${encodeURIComponent(email)}&archived_at=is.null&select=id,name,service_subscription_tier&limit=1`
  )
  return rows[0] ?? null
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === "list" || args[0] === "--list") {
    await listBusinesses()
    return
  }

  let businessId = args[0]
  let tier = args[1] ?? "business"

  if (businessId === "--email" && args[1]) {
    const row = await findByEmail(args[1])
    if (!row) {
      console.error(`No business with email ${args[1]}`)
      process.exit(1)
    }
    businessId = row.id
    tier = args[2] ?? "business"
    console.log(`Found ${row.name ?? row.id} (current tier: ${row.service_subscription_tier})`)
  }

  if (!TIERS.includes(tier.toLowerCase())) {
    // args might be swapped: tier first
    if (TIERS.includes(businessId.toLowerCase()) && args[1]?.match(/^[0-9a-f-]{36}$/i)) {
      await setTier(args[1], businessId)
      return
    }
  }

  await setTier(businessId, tier)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
