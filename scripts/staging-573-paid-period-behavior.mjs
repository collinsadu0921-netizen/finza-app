/**
 * STAGING/LOCAL ONLY — transactional behavioral proof of migration 573 helpers.
 * Inserts controlled businesses, asserts function results, rolls back.
 * Does not touch production. Leaves no persistent test data.
 *
 *   node scripts/staging-573-paid-period-behavior.mjs
 */
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"

function loadEnv() {
  const env = { ...process.env }
  const path = resolve(REPO_ROOT, ".env.staging")
  if (!existsSync(path)) return env
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    let val = t.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    const key = t.slice(0, i).trim()
    if (!env[key]) env[key] = val
  }
  return env
}

const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL || ""
if (url.includes(PRODUCTION_REF)) {
  throw new Error("Refused: production URL")
}
if (url && !url.includes(STAGING_REF)) {
  throw new Error("Refused: NEXT_PUBLIC_SUPABASE_URL must be staging")
}
const password = env.SUPABASE_DB_PASSWORD
if (!password) throw new Error("SUPABASE_DB_PASSWORD required")
const conn =
  `postgresql://postgres.${STAGING_REF}:` +
  `${encodeURIComponent(password)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
if (!conn.includes(STAGING_REF) || conn.includes(PRODUCTION_REF)) {
  throw new Error("Refused: must target staging only")
}

const pg = (await import("pg")).default
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

const cases = []

function record(name, expectedWrite, expectedTier, actualWrite, actualTier) {
  const ok = actualWrite === expectedWrite && actualTier === expectedTier
  cases.push({
    name,
    expected: { can_write: expectedWrite, professional_tier: expectedTier },
    actual: { can_write: actualWrite, professional_tier: actualTier },
    ok,
  })
  if (!ok) {
    console.error("FAIL", name, { expectedWrite, expectedTier, actualWrite, actualTier })
  }
}

try {
  await client.query("begin")

  const owner = await client.query(`select id from auth.users order by created_at limit 1`)
  if (!owner.rows[0]) throw new Error("No auth.users row available for fixture owner")
  const ownerId = owner.rows[0].id
  const marker = `P573-behavior-${Date.now()}`

  async function insertBiz(suffix, fields) {
    const row = await client.query(
      `insert into public.businesses (
         name, industry, owner_id, billing_exempt,
         service_subscription_tier, service_subscription_status,
         subscription_started_at, current_period_ends_at, subscription_grace_until,
         trial_ends_at
       ) values (
         $1, 'service', $2, $3,
         $4, $5,
         $6, $7, $8,
         $9
       ) returning id`,
      [
        `${marker}-${suffix}`,
        ownerId,
        fields.billing_exempt ?? false,
        fields.tier ?? "professional",
        fields.status ?? "active",
        fields.started ?? null,
        fields.period_ends ?? null,
        fields.grace ?? null,
        fields.trial_ends ?? null,
      ]
    )
    return row.rows[0].id
  }

  async function evalBiz(id) {
    const r = await client.query(
      `select
         public.finza_business_can_write_service_records($1) as can_write,
         public.finza_business_has_service_min_tier($1, 'professional') as has_tier`,
      [id]
    )
    return {
      can_write: r.rows[0].can_write === true,
      has_tier: r.rows[0].has_tier === true,
    }
  }

  const started = await client.query(`select now() - interval '40 days' as t`)
  const startedAt = started.rows[0].t

  const id1 = await insertBiz("paid-current", {
    started: startedAt,
    period_ends: (await client.query(`select now() + interval '20 days' as t`)).rows[0].t,
  })
  const e1 = await evalBiz(id1)
  record("1. Paid/current period in the future", true, true, e1.can_write, e1.has_tier)

  const id2 = await insertBiz("paid-grace-1d", {
    started: startedAt,
    period_ends: (await client.query(`select now() - interval '1 day' as t`)).rows[0].t,
    grace: null,
  })
  const e2 = await evalBiz(id2)
  record("2. Paid expired by 1 day (inside +3d grace)", true, true, e2.can_write, e2.has_tier)

  const id3 = await insertBiz("paid-boundary", {
    started: startedAt,
    period_ends: (await client.query(`select now() - interval '3 days' as t`)).rows[0].t,
    grace: null,
  })
  const e3 = await evalBiz(id3)
  record("3. Exact deterministic boundary now = period_end + 3 days", false, false, e3.can_write, e3.has_tier)

  const id4 = await insertBiz("paid-expired-null-grace", {
    started: startedAt,
    period_ends: (await client.query(`select now() - interval '5 days' as t`)).rows[0].t,
    grace: null,
  })
  const e4 = await evalBiz(id4)
  record("4. Paid expired >3d with NULL stored grace", false, false, e4.can_write, e4.has_tier)

  const id5 = await insertBiz("paid-expired-future-grace", {
    started: startedAt,
    period_ends: (await client.query(`select now() - interval '5 days' as t`)).rows[0].t,
    grace: (await client.query(`select now() + interval '30 days' as t`)).rows[0].t,
  })
  const e5 = await evalBiz(id5)
  record("5. Paid expired >3d with future stored grace cannot extend access", false, false, e5.can_write, e5.has_tier)

  const id6 = await insertBiz("exempt-old-period", {
    billing_exempt: true,
    started: startedAt,
    period_ends: (await client.query(`select now() - interval '40 days' as t`)).rows[0].t,
    status: "locked",
  })
  const e6 = await evalBiz(id6)
  record("6. billing_exempt with old expired paid period", true, true, e6.can_write, e6.has_tier)

  const id7a = await insertBiz("unpaid-trial-active", {
    status: "trialing",
    started: null,
    period_ends: null,
    trial_ends: (await client.query(`select now() + interval '5 days' as t`)).rows[0].t,
  })
  const e7a = await evalBiz(id7a)
  record("7a. Active unpaid trial", true, true, e7a.can_write, e7a.has_tier)

  const id7b = await insertBiz("unpaid-trial-expired-stale", {
    status: "trialing",
    started: null,
    period_ends: null,
    trial_ends: (await client.query(`select now() - interval '1 day' as t`)).rows[0].t,
    grace: null,
  })
  const e7b = await evalBiz(id7b)
  record("7b. Expired unpaid trial awaiting cron (no grace)", false, false, e7b.can_write, e7b.has_tier)

  const id8 = await insertBiz("locked", {
    status: "locked",
    started: startedAt,
    period_ends: (await client.query(`select now() + interval '20 days' as t`)).rows[0].t,
  })
  const e8 = await evalBiz(id8)
  record("8. Locked subscription", false, false, e8.can_write, e8.has_tier)

  const id9 = await insertBiz("past-due-inside-grace", {
    status: "past_due",
    started: startedAt,
    period_ends: (await client.query(`select now() - interval '1 day' as t`)).rows[0].t,
    grace: (await client.query(`select now() + interval '20 days' as t`)).rows[0].t,
  })
  const e9 = await evalBiz(id9)
  record("9. past_due paid still inside deterministic grace", true, true, e9.can_write, e9.has_tier)

  const id10 = await insertBiz("past-due-after-grace-late-store", {
    status: "past_due",
    started: startedAt,
    period_ends: (await client.query(`select now() - interval '5 days' as t`)).rows[0].t,
    grace: (await client.query(`select now() + interval '20 days' as t`)).rows[0].t,
  })
  const e10 = await evalBiz(id10)
  record("10. past_due paid after deterministic grace even if stored grace is later", false, false, e10.can_write, e10.has_tier)

  const leftover = await client.query(
    `select count(*)::int as n from public.businesses where name like $1`,
    [`${marker}%`]
  )
  await client.query("rollback")
  const leftoverAfter = await client.query(
    `select count(*)::int as n from public.businesses where name like $1`,
    [`${marker}%`]
  )

  const report = {
    target: STAGING_REF,
    rolled_back: leftoverAfter.rows[0].n === 0,
    rows_inside_txn: leftover.rows[0].n,
    cases,
    passed: cases.filter((c) => c.ok).length,
    failed: cases.filter((c) => !c.ok).length,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.rolled_back || report.failed > 0) {
    process.exit(1)
  }
} catch (e) {
  await client.query("rollback").catch(() => {})
  console.error(e)
  process.exit(1)
} finally {
  await client.end()
}
