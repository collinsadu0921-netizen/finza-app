/**
 * Staging-only load tenant seed (Phase 1).
 *
 * Creates fake customers + accounting periods for an existing staging business.
 * Does NOT send email, call payment APIs, or touch production.
 *
 * Prerequisites:
 *   - Copy .env.staging.example → .env.staging (staging Supabase keys only)
 *   - ALLOW_STAGING_LOAD_SEED=true
 *   - NEXT_PUBLIC_SUPABASE_URL must be staging ref adonhhtooawkeemdqqeo
 *   - STAGING_LOAD_BUSINESS_ID or onboarded business via --business-id
 *
 * Usage:
 *   node scripts/seed-staging-load-tenant.mjs --dry-run
 *   node scripts/seed-staging-load-tenant.mjs --apply --business-id=<uuid>
 *   node scripts/seed-staging-load-tenant.mjs --apply --customers=50 --periods=12
 *   node scripts/seed-staging-load-tenant.mjs --apply --clean-seed --business-id=<uuid>
 *
 * Phase 2 (invoices/payments/journal): docs/staging/seed-load-tenant.md
 */

import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")

const REQUIRED_STAGING_REF = "adonhhtooawkeemdqqeo"
const SEED_CUSTOMER_MARKER = "Staging Load Customer"
const SEED_EMAIL_PREFIX = "staging-load-"
const SEED_EMAIL_SUFFIX = "@example.invalid"

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

function formatUtcDate(d) {
  return d.toISOString().slice(0, 10)
}

/** First/last calendar day of a month, UTC-safe (no local timezone drift). */
function monthPeriodFromOffset(monthsBack) {
  const now = new Date()
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1))
  const year = anchor.getUTCFullYear()
  const monthIndex = anchor.getUTCMonth()
  const periodStart = new Date(Date.UTC(year, monthIndex, 1))
  const periodEnd = new Date(Date.UTC(year, monthIndex + 1, 0))
  return {
    periodStart: formatUtcDate(periodStart),
    periodEnd: formatUtcDate(periodEnd),
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

  const stagingRef = extractProjectRef(url)
  if (stagingRef !== REQUIRED_STAGING_REF) {
    fail(
      `Refusing to run: detected Supabase ref is "${stagingRef ?? "unknown"}", ` +
        `expected exactly "${REQUIRED_STAGING_REF}".`
    )
  }

  const prodRef = process.env.FINZA_PRODUCTION_SUPABASE_PROJECT_REF?.trim()
  if (prodRef && prodRef === stagingRef) {
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
  const cleanSeed = argv.includes("--clean-seed")
  const businessIdArg = argv.find((a) => a.startsWith("--business-id="))?.split("=")[1]
  const customersArg = argv.find((a) => a.startsWith("--customers="))?.split("=")[1]
  const periodsArg = argv.find((a) => a.startsWith("--periods="))?.split("=")[1]
  return {
    apply,
    dryRun,
    cleanSeed,
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

async function listExistingSeedCustomers(url, key, businessId) {
  const rows = await rest(
    url,
    key,
    `customers?business_id=eq.${businessId}&email=like.${SEED_EMAIL_PREFIX}*${SEED_EMAIL_SUFFIX}&select=id,email,name&order=email`,
    { prefer: "return=representation" }
  )
  return Array.isArray(rows) ? rows : []
}

function parseSeedCustomerIndex(email) {
  const m = email?.match(/^staging-load-(\d+)@example\.invalid$/)
  return m ? parseInt(m[1], 10) : null
}

async function cleanSeedCustomers(url, key, businessId, dryRun) {
  const existing = await listExistingSeedCustomers(url, key, businessId)
  if (existing.length === 0) {
    console.log("No seed customers to clean for this business.")
    return 0
  }

  if (dryRun) {
    console.log(
      `[dry-run] Would delete ${existing.length} seed customers for business ${businessId} only.`
    )
    return existing.length
  }

  await rest(
    url,
    key,
    `customers?business_id=eq.${businessId}&email=like.${SEED_EMAIL_PREFIX}*${SEED_EMAIL_SUFFIX}`,
    { method: "DELETE" }
  )
  console.log(`Deleted ${existing.length} seed customers for business ${businessId}.`)
  return existing.length
}

async function seedCustomers(url, key, businessId, count, dryRun, existing) {
  const existingNums = new Set()
  for (const row of existing) {
    const idx = parseSeedCustomerIndex(row.email)
    if (idx != null) existingNums.add(idx)
  }

  const toInsert = []
  for (let g = 1; g <= count; g++) {
    if (existingNums.has(g)) continue
    toInsert.push({
      business_id: businessId,
      name: `${SEED_CUSTOMER_MARKER} ${g}`,
      email: `${SEED_EMAIL_PREFIX}${g}${SEED_EMAIL_SUFFIX}`,
      created_at: new Date(Date.now() - g * 86400000).toISOString(),
    })
  }

  if (dryRun) {
    console.log(
      `[dry-run] Would insert ${toInsert.length} customers (${existing.length} seed customers already exist).`
    )
    return toInsert.length
  }

  if (toInsert.length === 0) {
    console.log(`No new customers to insert (${existing.length} seed customers already exist).`)
    return 0
  }

  await rest(url, key, "customers", {
    method: "POST",
    body: JSON.stringify(toInsert),
    prefer: "return=minimal",
  })
  console.log(
    `Inserted ${toInsert.length} fake customers (${existing.length} already existed, target ${count}).`
  )
  return toInsert.length
}

async function seedPeriods(url, key, businessId, count, dryRun) {
  if (dryRun) {
    const sample = monthPeriodFromOffset(0)
    console.log(
      `[dry-run] Would ensure ${count} monthly accounting_periods (UTC month bounds, e.g. ${sample.periodStart} → ${sample.periodEnd}).`
    )
    return count
  }

  let inserted = 0
  for (let n = 0; n < count; n++) {
    const { periodStart, periodEnd } = monthPeriodFromOffset(n)

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
        status: "open",
      }),
    })
    inserted++
  }
  console.log(`Inserted ${inserted} accounting periods (${count - inserted} already existed).`)
  return inserted
}

/** Ensure load-test tenant can reach Professional-tier APIs (bills, payroll) in k6 smoke. */
async function ensureLoadTestSubscription(url, key, businessId, dryRun) {
  const rows = await rest(
    url,
    key,
    `businesses?id=eq.${businessId}&archived_at=is.null&select=id,name,service_subscription_tier,service_subscription_status&limit=1`,
    { prefer: "return=representation" }
  )
  if (!Array.isArray(rows) || rows.length === 0) return

  const current = rows[0]
  const tier = String(current.service_subscription_tier || "").toLowerCase()
  const needsUpgrade = tier === "starter" || tier === "essentials" || !tier

  if (!needsUpgrade) {
    console.log(
      `  subscription:  ${current.service_subscription_tier} (${current.service_subscription_status}) — ok for k6`
    )
    return
  }

  if (dryRun) {
    console.log(
      `  subscription:  would upgrade ${current.service_subscription_tier} → business (k6 bills/payroll)`
    )
    return
  }

  const now = new Date()
  await rest(url, key, `businesses?id=eq.${businessId}&archived_at=is.null`, {
    method: "PATCH",
    body: JSON.stringify({
      service_subscription_tier: "business",
      service_subscription_status: "active",
      subscription_started_at: now.toISOString(),
      current_period_ends_at: "2099-12-31T23:59:59.000Z",
      subscription_grace_until: null,
      trial_started_at: null,
      trial_ends_at: null,
      billing_cycle: "annual",
      updated_at: now.toISOString(),
    }),
  })
  console.log(`  subscription:  upgraded ${current.service_subscription_tier} → business (k6 smoke)`)
}

async function main() {
  const detectedRef = extractProjectRef(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "")
  console.log(`\n[seed-staging] Detected Supabase ref: ${detectedRef ?? "(unknown)"}`)

  const args = parseArgs(process.argv.slice(2))
  const { url, key, stagingRef } = assertStagingSafe()

  console.log("\n[seed-staging] ── staging load tenant (Phase 1) ──")
  console.log(`  mode:          ${args.dryRun ? "dry-run" : "apply"}`)
  console.log(`  supabase ref:  ${stagingRef}`)
  console.log(`  customers:     ${args.customers}`)
  console.log(`  periods:       ${args.periods}`)
  if (args.cleanSeed) console.log(`  clean-seed:    yes (scoped to --business-id only)`)

  if (!args.businessId) {
    fail(
      "Missing business id. Onboard a service business on staging, then:\n" +
        "  STAGING_LOAD_BUSINESS_ID=<uuid> node scripts/seed-staging-load-tenant.mjs --apply\n" +
        "  or: node scripts/seed-staging-load-tenant.mjs --apply --business-id=<uuid>"
    )
  }

  const business = await verifyBusiness(url, key, args.businessId)
  console.log(`  business:      ${business.name} (${business.id}) industry=${business.industry}`)

  await ensureLoadTestSubscription(url, key, args.businessId, args.dryRun)

  let existingCustomers = await listExistingSeedCustomers(url, key, args.businessId)
  if (existingCustomers.length > 0) {
    console.log(`  existing seed: ${existingCustomers.length} fake customers for this business`)
  }

  if (args.cleanSeed) {
    if (!args.apply) {
      fail("--clean-seed requires --apply (use --dry-run without --clean-seed to preview inserts).")
    }
    await cleanSeedCustomers(url, key, args.businessId, false)
    existingCustomers = []
  }

  await seedCustomers(url, key, args.businessId, args.customers, args.dryRun, existingCustomers)
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
