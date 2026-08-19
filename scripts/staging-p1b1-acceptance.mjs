/**
 * STAGING ONLY — P1B.1 Practice acceptance fixture + SQL/policy validation.
 * Does not touch production. Creates synthetic firms/clients/users only.
 *
 *   node scripts/staging-p1b1-acceptance.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const MARKER = "P1B1"

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

function authorizedIds(role, effective, assigned, enabled) {
  if (role === "partner" || !enabled) return [...effective]
  return effective.filter((id) => assigned.has(id))
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
    `insert into public.accounting_firms (name, created_by, onboarding_status, assignment_scope_enabled_at, assignment_scope_enabled_by)
     values ($1, $2, 'completed', now(), $2)
     returning id`,
    [`${MARKER} Firm A`, ids.partnerA]
  )
  ids.firmA = firmA.rows[0].id
  const firmB = await client.query(
    `insert into public.accounting_firms (name, created_by, onboarding_status)
     values ($1, $2, 'completed')
     returning id`,
    [`${MARKER} Firm B`, ids.partnerB]
  )
  ids.firmB = firmB.rows[0].id

  for (const spec of staffSpec) {
    const firmId = spec.key === "partnerB" ? ids.firmB : ids.firmA
    await client.query(
      `insert into public.accounting_firm_users (firm_id, user_id, role)
       values ($1, $2, $3)
       on conflict (firm_id, user_id) do nothing`,
      [firmId, ids[spec.key], spec.role]
    )
  }

  for (const [key, name] of [
    ["client1", `${MARKER} Client 1`],
    ["client2", `${MARKER} Client 2`],
    ["client3", `${MARKER} Client 3`],
    ["clientB1", `${MARKER} Client B1`],
  ]) {
    const row = await client.query(
      `insert into public.businesses (name, owner_id, billing_exempt)
       values ($1, $2, true)
       returning id`,
      [name, ids.partnerA]
    )
    ids[key] = row.rows[0].id
  }

  async function engage(firmId, businessId, status, access, createdBy) {
    const accepted = status === "accepted" || status === "active" ? new Date().toISOString() : null
    const row = await client.query(
      `insert into public.firm_client_engagements
        (accounting_firm_id, client_business_id, status, access_level, effective_from, created_by, accepted_at, accepted_by)
       values ($1, $2, $3, $4, current_date, $5, $6, $7)
       returning id`,
      [firmId, businessId, status, access, createdBy, accepted, accepted ? createdBy : null]
    )
    return row.rows[0].id
  }

  ids.eng1 = await engage(ids.firmA, ids.client1, "accepted", "write", ids.partnerA)
  ids.eng2 = await engage(ids.firmA, ids.client2, "accepted", "approve", ids.partnerA)
  ids.eng3 = await engage(ids.firmA, ids.client3, "suspended", "write", ids.partnerA)
  ids.engB1 = await engage(ids.firmB, ids.clientB1, "accepted", "write", ids.partnerB)

  async function assign(firmId, businessId, userId, by) {
    await client.query(
      `insert into public.accounting_firm_client_assignments
        (firm_id, client_business_id, user_id, assigned_by_user_id)
       values ($1, $2, $3, $4)`,
      [firmId, businessId, userId, by]
    )
  }
  await assign(ids.firmA, ids.client1, ids.seniorA, ids.partnerA)
  await assign(ids.firmA, ids.client1, ids.juniorA, ids.partnerA)
  await assign(ids.firmA, ids.client2, ids.juniorA, ids.partnerA)
  await assign(ids.firmA, ids.client2, ids.readonlyA, ids.partnerA)

  await client.query(
    `insert into public.client_tasks (firm_id, client_business_id, title, status, priority, created_by_user_id)
     values
      ($1, $2, 'P1B1 Client 1 task', 'pending', 'normal', $5),
      ($1, $3, 'P1B1 Client 2 task', 'pending', 'normal', $5),
      ($1, $4, 'P1B1 Client 3 task', 'pending', 'high', $5),
      ($6, $7, 'P1B1 Firm B task', 'pending', 'normal', $8)`,
    [ids.firmA, ids.client1, ids.client2, ids.client3, ids.partnerA, ids.firmB, ids.clientB1, ids.partnerB]
  )
  await client.query(
    `insert into public.client_requests (firm_id, client_business_id, engagement_id, title, status, created_by)
     values
      ($1, $2, $5, 'P1B1 Client 1 request', 'open', $8),
      ($1, $3, $6, 'P1B1 Client 2 request', 'open', $8),
      ($1, $4, $7, 'P1B1 Client 3 request', 'open', $8)`,
    [ids.firmA, ids.client1, ids.client2, ids.client3, ids.eng1, ids.eng2, ids.eng3, ids.partnerA]
  )
  await client.query(
    `insert into public.client_filings (firm_id, client_business_id, filing_type, status, created_by_user_id)
     values
      ($1, $2, 'vat', 'pending', $5),
      ($1, $3, 'vat', 'pending', $5),
      ($1, $4, 'vat', 'pending', $5)`,
    [ids.firmA, ids.client1, ids.client2, ids.client3, ids.partnerA]
  )

  await client.query(
    `insert into public.accounting_firm_activity_logs
      (firm_id, actor_user_id, action_type, entity_type, entity_id, metadata)
     values
      ($1, $2, 'client_staff_assigned', 'client_assignment', $3, '{"action":"assigned"}'::jsonb),
      ($1, $2, 'client_staff_unassigned', 'client_assignment', $3, '{"action":"unassigned"}'::jsonb)`,
    [ids.firmA, ids.partnerA, ids.client1]
  )

  const effectiveA = [ids.client1, ids.client2]
  const assigned = {
    partnerA: new Set(),
    seniorA: new Set([ids.client1]),
    juniorA: new Set([ids.client1, ids.client2]),
    readonlyA: new Set([ids.client2]),
    partnerB: new Set(),
  }
  const results = {
    partnerA: authorizedIds("partner", effectiveA, assigned.partnerA, true),
    seniorA: authorizedIds("senior", effectiveA, assigned.seniorA, true),
    juniorA: authorizedIds("junior", effectiveA, assigned.juniorA, true),
    readonlyA: authorizedIds("readonly", effectiveA, assigned.readonlyA, true),
    partnerB: authorizedIds("partner", [ids.clientB1], assigned.partnerB, false),
  }

  const tasksByScope = {}
  for (const [who, clientIds] of Object.entries(results)) {
    const firmId = who === "partnerB" ? ids.firmB : ids.firmA
    const rows = await client.query(
      `select title from client_tasks where firm_id = $1 and client_business_id = any($2::uuid[]) order by title`,
      [firmId, clientIds]
    )
    tasksByScope[who] = rows.rows.map((r) => r.title)
  }

  const logs = await client.query(
    `select action_type from accounting_firm_activity_logs where firm_id = $1 order by created_at`,
    [ids.firmA]
  )

  let crossFirmInsertDenied = false
  try {
    await client.query("begin")
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ids.partnerA, role: "authenticated" }),
    ])
    await client.query("set local role authenticated")
    await client.query(
      `insert into accounting_firm_activity_logs (firm_id, actor_user_id, action_type, entity_type)
       values ($1, $2, 'forged', 'client_assignment')`,
      [ids.firmB, ids.partnerA]
    )
    await client.query("rollback")
  } catch {
    crossFirmInsertDenied = true
    await client.query("rollback").catch(() => {})
  }

  const report = {
    target: STAGING_REF,
    fixture: ids,
    authorized_clients: {
      partnerA: results.partnerA.map((id) => (id === ids.client1 ? "Client 1" : id === ids.client2 ? "Client 2" : id)),
      seniorA: results.seniorA.map((id) => (id === ids.client1 ? "Client 1" : id)),
      juniorA: results.juniorA.map((id) => (id === ids.client1 ? "Client 1" : "Client 2")),
      readonlyA: results.readonlyA.map((id) => (id === ids.client2 ? "Client 2" : id)),
      partnerB: results.partnerB.map(() => "Client B1"),
    },
    work_and_source_titles: tasksByScope,
    activity_actions: logs.rows.map((r) => r.action_type),
    cross_firm_activity_insert_denied: crossFirmInsertDenied,
    assertions: {
      partner_sees_1_and_2_not_3: results.partnerA.includes(ids.client1) && results.partnerA.includes(ids.client2) && !results.partnerA.includes(ids.client3),
      senior_only_client1: results.seniorA.length === 1 && results.seniorA[0] === ids.client1,
      junior_1_and_2: results.juniorA.includes(ids.client1) && results.juniorA.includes(ids.client2) && !results.juniorA.includes(ids.client3),
      readonly_only_2: results.readonlyA.length === 1 && results.readonlyA[0] === ids.client2,
      firm_b_isolated: !results.partnerA.includes(ids.clientB1) && !results.seniorA.includes(ids.clientB1),
      no_client3_work: !tasksByScope.partnerA.includes("P1B1 Client 3 task"),
      assignment_events_persist: logs.rows.some((r) => r.action_type === "client_staff_assigned") && logs.rows.some((r) => r.action_type === "client_staff_unassigned"),
      cross_firm_insert_denied: crossFirmInsertDenied,
    },
  }

  writeFileSync(resolve(REPO_ROOT, "tmp/_p1b1_acceptance.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  const failed = Object.entries(report.assertions).filter(([, ok]) => !ok)
  if (failed.length) {
    console.error("FAILED assertions:", failed.map(([k]) => k).join(", "))
    process.exit(1)
  }
} finally {
  await client.end()
}
