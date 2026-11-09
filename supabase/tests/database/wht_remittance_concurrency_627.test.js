/* eslint-disable no-console */
/**
 * Concurrent WHT remittance posting (migration 627, F-01).
 *
 * Two service-role sessions attempt to post the same remittance. The row lock
 * in post_wht_remittance_to_ledger must serialize them; the second session
 * must reuse the first journal instead of creating a duplicate.
 */
const crypto = require("crypto")
const { Client } = require("pg")

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:55332/finza_tax_test"

async function main() {
  const setup = new Client({ connectionString: DATABASE_URL })
  await setup.connect()

  const ownerResult = await setup.query(
    "select id from auth.users order by created_at limit 1"
  )
  if (ownerResult.rowCount !== 1) {
    throw new Error("TEST_SETUP: need an auth.users row")
  }
  const owner = ownerResult.rows[0].id
  const businessId = crypto.randomUUID()

  await setup.query("begin")
  await setup.query(
    "select set_config('request.jwt.claim.sub', $1, true)",
    [owner]
  )
  await setup.query(
    "select set_config('request.jwt.claim.role', 'authenticated', true)"
  )
  await setup.query(
    `insert into public.businesses
       (id,name,address_country,default_currency,industry,owner_id,
        service_subscription_tier,service_subscription_status,billing_exempt,
        created_at,updated_at)
     values ($1,'627 WHT concurrency','Ghana','GHS','service',$2,
       'business','active',true,now(),now())`,
    [businessId, owner]
  )
  await setup.query("select public.create_system_accounts($1)", [businessId])
  await setup.query("select public.initialize_business_chart_of_accounts($1)", [
    businessId,
  ])
  await setup.query(
    `insert into public.accounting_periods
       (business_id,period_start,period_end,status)
     values ($1,date_trunc('month',current_date)::date,
       (date_trunc('month',current_date)+interval '1 month - 1 day')::date,
       'open')`,
    [businessId]
  )
  const remittance = await setup.query(
    `insert into public.wht_remittances
       (business_id,remittance_date,amount,reference,created_by)
     values ($1,current_date,5,'SEC-627-WHT-CONCURRENT',$2)
     returning id`,
    [businessId, owner]
  )
  await setup.query("commit")

  const sessionA = new Client({ connectionString: DATABASE_URL })
  const sessionB = new Client({ connectionString: DATABASE_URL })
  await sessionA.connect()
  await sessionB.connect()

  async function prepare(client) {
    await client.query("begin")
    await client.query("set role service_role")
    await client.query(
      "select set_config('request.jwt.claim.sub', '', true)"
    )
    await client.query(
      "select set_config('request.jwt.claim.role', 'service_role', true)"
    )
  }

  try {
    await prepare(sessionA)
    await prepare(sessionB)

    const first = await sessionA.query(
      "select public.post_wht_remittance_to_ledger($1,'1010') as je",
      [remittance.rows[0].id]
    )

    const second = sessionB.query(
      "select public.post_wht_remittance_to_ledger($1,'1010') as je",
      [remittance.rows[0].id]
    )

    const pending = await Promise.race([
      second.then(
        () => "resolved",
        () => "rejected"
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 400)),
    ])
    if (pending !== "pending") {
      throw new Error(
        `TEST_FAILED: concurrent WHT call did not wait for the row lock (${pending})`
      )
    }

    await sessionA.query("commit")
    const secondResult = await second
    await sessionB.query("rollback")

    if (first.rows[0].je !== secondResult.rows[0].je) {
      throw new Error(
        `TEST_FAILED: concurrent WHT calls returned different journals (${first.rows[0].je} / ${secondResult.rows[0].je})`
      )
    }

    const count = await setup.query(
      `select count(*)::int as n
       from public.journal_entries
       where business_id=$1 and reference_type='wht_remittance' and reference_id=$2`,
      [businessId, remittance.rows[0].id]
    )
    if (count.rows[0].n !== 1) {
      throw new Error(
        `TEST_FAILED: concurrent WHT posting created ${count.rows[0].n} journals`
      )
    }

    console.log(
      "PASS: concurrent WHT remittance reused the linked journal (627)"
    )
  } finally {
    await sessionA.end().catch(() => {})
    await sessionB.end().catch(() => {})
    await setup
      .query("delete from public.audit_logs where business_id=$1", [businessId])
      .catch(() => {})
    await setup
      .query("delete from public.businesses where id=$1", [businessId])
      .catch(() => {})
    await setup.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
