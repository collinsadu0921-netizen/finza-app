/**
 * Staging-only: set Professional+ subscription on the load-test business for k6.
 *
 * Requires .env.staging with staging ref adonhhtooawkeemdqqeo and ALLOW_STAGING_LOAD_SEED=true.
 *
 *   node scripts/set-staging-load-test-subscription.mjs
 *   node scripts/set-staging-load-test-subscription.mjs --tier=professional
 *
 * Or run scripts/set-staging-load-test-subscription.sql in Supabase SQL editor (staging).
 */

import {
  loadSeedEnv,
  assertStagingSafe,
  printDetectedRef,
  rest,
} from "./lib/staging-seed-safety.mjs"

const LOAD_TEST_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const TIERS = ["starter", "professional", "business"]

const tierArg = process.argv.find((a) => a.startsWith("--tier="))?.split("=")[1]?.trim()
const tier = TIERS.includes(tierArg?.toLowerCase() ?? "") ? tierArg.toLowerCase() : "business"

loadSeedEnv()
printDetectedRef()
const { url, key } = assertStagingSafe()

const before = await rest(
  url,
  key,
  `businesses?id=eq.${LOAD_TEST_BUSINESS_ID}&archived_at=is.null&select=id,name,service_subscription_tier,service_subscription_status,billing_exempt&limit=1`,
  { prefer: "return=representation" }
)

if (!Array.isArray(before) || before.length === 0) {
  console.error(`\n[staging-tier] Business ${LOAD_TEST_BUSINESS_ID} not found on staging.\n`)
  process.exit(1)
}

const row = before[0]
console.log(`\n[staging-tier] Before: ${row.name}`)
console.log(
  `  tier=${row.service_subscription_tier} status=${row.service_subscription_status} billing_exempt=${row.billing_exempt}`
)

const now = new Date()
const patch = {
  service_subscription_tier: tier,
  service_subscription_status: "active",
  subscription_started_at: now.toISOString(),
  current_period_ends_at: "2099-12-31T23:59:59.000Z",
  subscription_grace_until: null,
  trial_started_at: null,
  trial_ends_at: null,
  billing_cycle: "annual",
  updated_at: now.toISOString(),
}

const after = await rest(
  url,
  key,
  `businesses?id=eq.${LOAD_TEST_BUSINESS_ID}&archived_at=is.null`,
  {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify(patch),
  }
)

const updated = Array.isArray(after) ? after[0] : null
if (!updated) {
  console.error("\n[staging-tier] PATCH returned no rows.\n")
  process.exit(1)
}

console.log(`\n[staging-tier] After: ${updated.name}`)
console.log(
  `  tier=${updated.service_subscription_tier} status=${updated.service_subscription_status} billing_exempt=${updated.billing_exempt}`
)
console.log(`  effectiveTier will resolve to "${tier}" (via resolveServiceEntitlement)\n`)
