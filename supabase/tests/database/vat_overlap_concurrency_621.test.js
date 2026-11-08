/* eslint-disable no-console */
/**
 * Concurrent VAT return overlap test (migration 621, F-06).
 *
 * Two independent database sessions attempt to insert the same VAT period.
 * Session A holds the per-business advisory lock until commit; session B must
 * block, then fail with VAT_RETURN_PERIOD_OVERLAP after A commits. The test
 * proves the race is closed at the database transaction boundary.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node supabase/tests/database/vat_overlap_concurrency_621.test.js
 */
const crypto = require("crypto")
const { Client } = require("pg")

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:55332/finza_tax_test"

async function setClaims(client, userId) {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId,
  ])
  await client.query(
    "select set_config('request.jwt.claim.role', 'authenticated', true)"
  )
}

async function main() {
  const setup = new Client({ connectionString: DATABASE_URL })
  await setup.connect()

  const ownerResult = await setup.query(
    "select id from auth.users order by created_at limit 1"
  )
  if (ownerResult.rowCount !== 1) {
    throw new Error("TEST_SETUP: need an auth.users row")
  }
  const ownerId = ownerResult.rows[0].id
  const businessId = crypto.randomUUID()

  await setup.query("begin")
  await setClaims(setup, ownerId)
  await setup.query(
    `insert into public.businesses (
       id, name, address_country, default_currency, industry, owner_id,
       service_subscription_tier, service_subscription_status, billing_exempt,
       created_at, updated_at
     ) values ($1, '621 Concurrency Test', 'Ghana', 'GHS', 'service', $2,
       'business', 'active', true, now(), now())`,
    [businessId, ownerId]
  )
  await setup.query("select public.create_system_accounts($1)", [businessId])
  await setup.query("select public.initialize_business_chart_of_accounts($1)", [
    businessId,
  ])
  await setup.query(
    `insert into public.accounting_periods (business_id, period_start, period_end, status)
     values ($1, date_trunc('month', current_date)::date,
       (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
       'open')`,
    [businessId]
  )
  await setup.query("commit")

  const sessionA = new Client({ connectionString: DATABASE_URL })
  const sessionB = new Client({ connectionString: DATABASE_URL })
  await sessionA.connect()
  await sessionB.connect()

  try {
    await sessionA.query("begin")
    await setClaims(sessionA, ownerId)
    await sessionA.query(
      `insert into public.vat_returns (
         business_id, period_start_date, period_end_date, status
       ) values ($1, date_trunc('month', current_date)::date,
         (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
         'draft')`,
      [businessId]
    )

    await sessionB.query("begin")
    await setClaims(sessionB, ownerId)
    const insertB = sessionB.query(
      `insert into public.vat_returns (
         business_id, period_start_date, period_end_date, status
       ) values ($1, date_trunc('month', current_date)::date,
         (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
         'draft')`,
      [businessId]
    )

    // B must still be waiting on A's advisory lock.
    const pending = await Promise.race([
      insertB.then(
        () => "resolved",
        () => "rejected"
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 400)),
    ])
    if (pending !== "pending") {
      throw new Error(
        `TEST_FAILED: concurrent insert did not wait for the advisory lock (${pending})`
      )
    }

    await sessionA.query("commit")

    let error = null
    try {
      await insertB
    } catch (err) {
      error = err
    }

    if (!error || !/VAT_RETURN_PERIOD_OVERLAP/.test(error.message)) {
      throw new Error(
        `TEST_FAILED: second insert did not fail with overlap: ${
          error ? error.message : "insert succeeded"
        }`
      )
    }

    await sessionB.query("rollback")

    const count = await setup.query(
      "select count(*)::int as n from public.vat_returns where business_id = $1",
      [businessId]
    )
    if (count.rows[0].n !== 1) {
      throw new Error(
        `TEST_FAILED: expected 1 VAT return after the race, found ${count.rows[0].n}`
      )
    }

    console.log(
      "PASS: concurrent VAT return insert blocked by advisory lock and rejected (621)"
    )
  } finally {
    await sessionA.end().catch(() => {})
    await sessionB.end().catch(() => {})
    await setup
      .query("delete from public.audit_logs where business_id = $1", [businessId])
      .catch(() => {})
    await setup
      .query("delete from public.businesses where id = $1", [businessId])
      .catch(() => {})
    await setup.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
