/**
 * STAGING ONLY — P1C Practice dashboard fixture extension + SQL validation.
 * Reuses P1B1 synthetic users/firms. Does not touch production.
 *
 *   node scripts/staging-p1c-acceptance.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const MARKER = "P1B1"
const WORK_MARKER = "P1C"

function loadEnv() {
  const env = {}
  const path = resolve(REPO_ROOT, ".env.staging")
  if (!existsSync(path)) throw new Error(".env.staging required")
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    let val = t.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[t.slice(0, i).trim()] = val
  }
  return env
}

const env = loadEnv()
const url = env.NEXT_PUBLIC_SUPABASE_URL || ""
if (!url.includes(STAGING_REF) || url.includes(PRODUCTION_REF)) {
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

const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const staffSpec = [
  { key: "partnerA", email: "p1b1.partner.a@example.invalid", name: "P1B1 Partner A", role: "partner" },
  { key: "seniorA", email: "p1b1.senior.a@example.invalid", name: "P1B1 Senior A", role: "senior" },
  { key: "juniorA", email: "p1b1.junior.a@example.invalid", name: "P1B1 Junior A", role: "junior" },
  { key: "readonlyA", email: "p1b1.readonly.a@example.invalid", name: "P1B1 Readonly A", role: "readonly" },
  { key: "partnerB", email: "p1b1.partner.b@example.invalid", name: "P1B1 Partner B", role: "partner" },
]

async function ensureUser(spec) {
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const existing = listed?.users?.find((u) => u.email === spec.email)
  if (existing) return existing.id
  const { data, error } = await admin.auth.admin.createUser({
    email: spec.email,
    email_confirm: true,
    user_metadata: { full_name: spec.name, p1b1_fixture: true },
  })
  if (error) throw new Error(`createUser ${spec.email}: ${error.message}`)
  return data.user.id
}

const pg = (await import("pg")).default
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

const ids = {}
try {
  for (const spec of staffSpec) {
    ids[spec.key] = await ensureUser(spec)
    await client.query(
      `insert into public.users (id, email, full_name)
       values ($1, $2, $3)
       on conflict (id) do update set email = excluded.email, full_name = excluded.full_name`,
      [ids[spec.key], spec.email, spec.name]
    )
  }

  const firmA = await client.query(
    `select f.id
       from public.accounting_firms f
       join public.accounting_firm_users u on u.firm_id = f.id
      where f.name = $1 and u.user_id = $2
      order by f.created_at desc
      limit 1`,
    [`${MARKER} Firm A`, ids.partnerA]
  )
  const firmB = await client.query(
    `select f.id
       from public.accounting_firms f
       join public.accounting_firm_users u on u.firm_id = f.id
      where f.name = $1 and u.user_id = $2
      order by f.created_at desc
      limit 1`,
    [`${MARKER} Firm B`, ids.partnerB]
  )
  if (!firmA.rows[0] || !firmB.rows[0]) {
    throw new Error("P1B1 firms not found. Run scripts/staging-p1b1-acceptance.mjs first.")
  }
  ids.firmA = firmA.rows[0].id
  ids.firmB = firmB.rows[0].id

  const clients = await client.query(
    `select b.id, b.name
       from public.businesses b
       join public.firm_client_engagements e on e.client_business_id = b.id
      where e.accounting_firm_id = any($1::uuid[])
        and b.name like $2
      order by b.name, b.created_at desc`,
    [[ids.firmA, ids.firmB], `${MARKER} Client%`]
  )
  for (const row of clients.rows) {
    if (row.name === `${MARKER} Client 1` && !ids.client1) ids.client1 = row.id
    if (row.name === `${MARKER} Client 2` && !ids.client2) ids.client2 = row.id
    if (row.name === `${MARKER} Client 3` && !ids.client3) ids.client3 = row.id
    if (row.name === `${MARKER} Client B1` && !ids.clientB1) ids.clientB1 = row.id
  }
  if (!ids.client1 || !ids.client2 || !ids.client3 || !ids.clientB1) {
    throw new Error("P1B1 clients not found. Run scripts/staging-p1b1-acceptance.mjs first.")
  }

  const eng1 = await client.query(
    `select id from public.firm_client_engagements
      where accounting_firm_id = $1 and client_business_id = $2
      order by created_at desc limit 1`,
    [ids.firmA, ids.client1]
  )
  ids.eng1 = eng1.rows[0]?.id

  async function upsertTask(title, businessId, firmId, assignedTo, dueAt, status = "pending") {
    const existing = await client.query(
      `select id from public.client_tasks where firm_id = $1 and title = $2 limit 1`,
      [firmId, title]
    )
    if (existing.rows[0]) {
      await client.query(
        `update public.client_tasks
            set assigned_to_user_id = $2, due_at = $3, status = $4, client_business_id = $5
          where id = $1`,
        [existing.rows[0].id, assignedTo, dueAt, status, businessId]
      )
      return existing.rows[0].id
    }
    const row = await client.query(
      `insert into public.client_tasks
        (firm_id, client_business_id, title, status, priority, assigned_to_user_id, due_at, created_by_user_id)
       values ($1, $2, $3, $4, 'high', $5, $6, $7)
       returning id`,
      [firmId, businessId, title, status, assignedTo, dueAt, ids.partnerA]
    )
    return row.rows[0].id
  }

  async function upsertRequest(title, businessId, firmId, status, dueAt) {
    const existing = await client.query(
      `select id from public.client_requests where firm_id = $1 and title = $2 limit 1`,
      [firmId, title]
    )
    if (existing.rows[0]) {
      await client.query(
        `update public.client_requests set status = $2, due_at = $3, client_business_id = $4 where id = $1`,
        [existing.rows[0].id, status, dueAt, businessId]
      )
      return existing.rows[0].id
    }
    const row = await client.query(
      `insert into public.client_requests
        (firm_id, client_business_id, engagement_id, title, status, due_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [firmId, businessId, ids.eng1, title, status, dueAt, ids.partnerA]
    )
    return row.rows[0].id
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const today = new Date().toISOString()

  await upsertTask(`${WORK_MARKER} Client 1 overdue`, ids.client1, ids.firmA, ids.seniorA, yesterday)
  await upsertTask(`${WORK_MARKER} Client 2 assigned`, ids.client2, ids.firmA, ids.juniorA, null)
  await upsertTask(`${WORK_MARKER} Client 2 unassigned`, ids.client2, ids.firmA, null, yesterday)
  await upsertTask(`${WORK_MARKER} Client 3 hidden`, ids.client3, ids.firmA, ids.seniorA, yesterday)
  await upsertTask(`${WORK_MARKER} Firm B isolated`, ids.clientB1, ids.firmB, ids.partnerB, yesterday)
  await upsertRequest(`${WORK_MARKER} Client 2 waiting`, ids.client2, ids.firmA, "waiting_on_client", today)
  await upsertRequest(`${WORK_MARKER} Client 1 done`, ids.client1, ids.firmA, "completed", null)

  const effective = [ids.client1, ids.client2]
  const tasks = await client.query(
    `select title, client_business_id, assigned_to_user_id, status, due_at
       from public.client_tasks
      where firm_id = $1
        and title like $2
        and status not in ('completed', 'cancelled')
        and client_business_id = any($3::uuid[])`,
    [ids.firmA, `${WORK_MARKER}%`, effective]
  )
  const requests = await client.query(
    `select title, client_business_id, status
       from public.client_requests
      where firm_id = $1
        and title like $2
        and status not in ('completed', 'cancelled')
        and client_business_id = any($3::uuid[])`,
    [ids.firmA, `${WORK_MARKER}%`, effective]
  )
  const firmBLeak = await client.query(
    `select title from public.client_tasks
      where firm_id = $1 and title = $2`,
    [ids.firmA, `${WORK_MARKER} Firm B isolated`]
  )
  const client3VisibleToPartner = tasks.rows.some((r) => r.client_business_id === ids.client3)

  const open = tasks.rows.length + requests.rows.length
  const overdue = tasks.rows.filter((r) => r.due_at && new Date(r.due_at) < new Date(new Date().toISOString().slice(0, 10))).length
  const waiting = requests.rows.filter((r) => r.status === "waiting_on_client").length
  const seniorWork = tasks.rows.filter((r) => r.assigned_to_user_id === ids.seniorA).length
  const juniorWork = tasks.rows.filter((r) => r.assigned_to_user_id === ids.juniorA).length
  const unassigned = tasks.rows.filter((r) => !r.assigned_to_user_id).length + requests.rows.filter((r) => r.status !== "completed").length

  const report = {
    target: STAGING_REF,
    fixture: {
      firmA: ids.firmA,
      firmB: ids.firmB,
      client1: ids.client1,
      client2: ids.client2,
      client3: ids.client3,
      clientB1: ids.clientB1,
    },
    expected: {
      partner_clients: 2,
      partner_open_p1c: open,
      partner_waiting_p1c: waiting,
      senior_clients: 1,
      junior_clients: 2,
      readonly_clients: 1,
      senior_assigned_work: seniorWork,
      junior_assigned_work: juniorWork,
      unassigned_p1c: unassigned,
      overdue_p1c: overdue,
    },
    assertions: {
      partner_clients_1_and_2: Boolean(ids.client1 && ids.client2),
      client_3_excluded_from_effective_work: !client3VisibleToPartner,
      firm_b_task_not_on_firm_a: firmBLeak.rows.length === 0,
      waiting_on_client_present: waiting === 1,
      completed_request_excluded: !requests.rows.some((r) => r.title.includes("done")),
      senior_work_not_unassigned: seniorWork >= 1,
      unassigned_not_forced_onto_staff: unassigned >= 1,
    },
  }

  writeFileSync(resolve(REPO_ROOT, "tmp/_p1c_acceptance.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  const failed = Object.entries(report.assertions).filter(([, ok]) => !ok)
  if (failed.length) {
    console.error("FAILED assertions:", failed.map(([k]) => k).join(", "))
    process.exit(1)
  }
} finally {
  await client.end()
}
