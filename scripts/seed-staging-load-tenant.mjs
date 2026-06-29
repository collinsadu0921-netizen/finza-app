/**
 * Staging-only load tenant seed (Phase 1).
 *
 * Creates fake customers + accounting periods for an existing staging business.
 * Does NOT send email, call payment APIs, or touch production.
 *
 * Prerequisites:
 *   - Copy .env.staging.example → .env.staging (staging Supabase keys only)
 *   - ALLOW_STAGING_LOAD_SEED=true
 *   - FINZA_PRODUCTION_SUPABASE_PROJECT_REF set to block production
 *   - STAGING_LOAD_BUSINESS_ID or onboarded business via --business-id
 *
 * Usage:
 *   node scripts/seed-staging-load-tenant.mjs --dry-run
 *   node scripts/seed-staging-load-tenant.mjs --apply --business-id=<uuid>
 *   node scripts/seed-staging-load-tenant.mjs --apply --customers=50 --periods=12
 *
 * Phase 2 (invoices/payments/journal): docs/staging/seed-load-tenant.md
 */

import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const PRODUCTION_HOST_BLOCKLIST = [
  "app.finza.africa",
  "finza.africa",
  "www.finza.africa",
]

function loadEnvFile(filename) {
  const path = resolve(root, filename)
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
    if (!process.env[key]) process.env[key] = val
  }
  return true
}

loadEnvFile(".env.staging")
loadEnvFile(".env.local")

function fail(msg) {
  console.error(`\n[seed-staging] ERROR: ${msg}\n`)
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
  if (process.env.ALLOW_STAGING_LOAD_SEED !== "true") {
    fail(
      "Set ALLOW_STAGING_LOAD_SEED=true in .env.staging (never in production Vercel env)."
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!url) fail("Missing NEXT_PUBLIC_SUPABASE_URL in .env.staging")

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!key) fail("Missing SUPABASE_SERVICE_ROLE_KEY in .env.staging")

  const prodRef = process.env.FINZA_PRODUCTION_SUPABASE_PROJECT_REF?.trim()
  const stagingRef = extractProjectRef(url)
  if (prodRef && stagingRef && prodRef === stagingRef) {
    fail(
      `Supabase URL project ref "${stagingRef}" matches FINZA_PRODUCTION_SUPABASE_PROJECT_REF. Use staging project only.`
    )
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    ""
  const extraHosts = (process.env.FINZA_PRODUCTION_APP_URLS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const blocked = [...PRODUCTION_HOST_BLOCKLIST, ...extraHosts]

  if (appUrl) {
    try {
      const host = new URL(appUrl).hostname.toLowerCase()
      if (blocked.some((b) => host === b || host.endsWith(`.${b}`))) {
        fail(`NEXT_PUBLIC_APP_URL host "${host}" is blocked (production). Use staging/preview URL.`)
      }
    } catch {
      fail(`Invalid NEXT_PUBLIC_APP_URL: ${appUrl}`)
    }
  }

  if (process.env.NODE_ENV === "production") {
    fail("Refusing to run with NODE_ENV=production.")
  }

  return { url, key, stagingRef }
}

function parseArgs(argv) {
  const apply = argv.includes("--apply")
  const dryRun = argv.includes("--dry-run") || !apply
  const businessIdArg = argv.find((a) => a.startsWith("--business-id="))?.split("=")[1]
  const customersArg = argv.find((a) => a.startsWith("--customers="))?.split("=")[1]
  const periodsArg = argv.find((a) => a.startsWith("--periods="))?.split("=")[1]
  return {
    apply,
    dryRun,
    businessId: businessIdArg || process.env.STAGING_LOAD_BUSINESS_ID?.trim() || null,
    customers: Math.min(500, Math.max(1, parseInt(customersArg || "50", 10) || 50)),
    periods: Math.min(24, Math.max(1, parseInt(periodsArg || "12", 10) || 12)),
  }
}

async function rest(url, key, path, options = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=minimal",
    },
    ...options,
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!res.ok) {
    throw new Error(typeof body === "object" ? JSON.stringify(body) : text)
  }
  return body
}

async function verifyBusiness(url, key, businessId) {
  const rows = await rest(
    url,
    key,
    `businesses?id=eq.${businessId}&archived_at=is.null&select=id,name,industry,email&limit=1`,
    { prefer: "return=representation" }
  )
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(
      `Business ${businessId} not found on staging. Onboard via staging UI first, then pass --business-id=`
    )
  }
  return rows[0]
}

async function seedCustomers(url, key, businessId, count, dryRun) {
  const marker = "Staging Load Customer"
  if (dryRun) {
    console.log(`[dry-run] Would insert up to ${count} customers (${marker} …)`)
    return count
  }

  const batch = []
  for (let g = 1; g <= count; g++) {
    batch.push({
      business_id: businessId,
      name: `${marker} ${g}`,
      email: `staging-load-${g}@example.invalid`,
      created_at: new Date(Date.now() - g * 86400000).toISOString(),
    })
  }

  await rest(url, key, "customers", {
    method: "POST",
    body: JSON.stringify(batch),
    prefer: "return=minimal",
  })
  console.log(`Inserted ${count} fake customers.`)
  return count
}

async function seedPeriods(url, key, businessId, count, dryRun) {
  if (dryRun) {
    console.log(`[dry-run] Would ensure ${count} monthly accounting_periods`)
    return count
  }

  const now = new Date()
  let inserted = 0
  for (let n = 0; n < count; n++) {
    const start = new Date(now.getFullYear(), now.getMonth() - n, 1)
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
    const periodStart = start.toISOString().slice(0, 10)
    const periodEnd = end.toISOString().slice(0, 10)

    const existing = await rest(
      url,
      key,
      `accounting_periods?business_id=eq.${businessId}&period_start=eq.${periodStart}&select=id&limit=1`
    )
    if (Array.isArray(existing) && existing.length > 0) continue

    await rest(url, key, "accounting_periods", {
      method: "POST",
      body: JSON.stringify({
        business_id: businessId,
        period_start: periodStart,
        period_end: periodEnd,
        status: n === 0 ? "open" : "closed",
      }),
    })
    inserted++
  }
  console.log(`Inserted ${inserted} accounting periods (${count - inserted} already existed).`)
  return inserted
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { url, key, stagingRef } = assertStagingSafe()

  console.log("\n[seed-staging] ── staging load tenant (Phase 1) ──")
  console.log(`  mode:          ${args.dryRun ? "dry-run" : "apply"}`)
  console.log(`  supabase ref:  ${stagingRef ?? "(unknown)"}`)
  console.log(`  customers:     ${args.customers}`)
  console.log(`  periods:       ${args.periods}`)

  if (!args.businessId) {
    fail(
      "Missing business id. Onboard a service business on staging, then:\n" +
        "  STAGING_LOAD_BUSINESS_ID=<uuid> node scripts/seed-staging-load-tenant.mjs --apply\n" +
        "  or: node scripts/seed-staging-load-tenant.mjs --apply --business-id=<uuid>"
    )
  }

  const business = await verifyBusiness(url, key, args.businessId)
  console.log(`  business:      ${business.name} (${business.id}) industry=${business.industry}`)

  await seedCustomers(url, key, args.businessId, args.customers, args.dryRun)
  await seedPeriods(url, key, args.businessId, args.periods, args.dryRun)

  console.log("\n[seed-staging] Phase 1 complete.")
  console.log(`  businessId: ${args.businessId}`)
  console.log("  Phase 2 (invoices/payments/journal): docs/staging/seed-load-tenant.md")
  console.log("  k6 sessions: load-tests/sessions.staging.json\n")

  if (args.dryRun) {
    console.log("Re-run with --apply to write data.\n")
  }
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
