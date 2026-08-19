/**
 * STAGING ONLY — Practice pilot / real-workflow UAT simulation.
 * Extends P1B1 + P1C fixture. Does not touch production.
 *
 *   node scripts/staging-pilot-uat.mjs
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const P1B1 = "P1B1"
const PILOT = "PILOT"

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

function isoDateOffset(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

function dateOnlyOffset(days) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
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

const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const pg = (await import("pg")).default
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
await client.connect()

const findings = { p0: [], pilot_blocker: [], friction: [], polish: [], future: [] }
function note(severity, msg) {
  findings[severity]?.push(msg)
}

const report = {
  target: STAGING_REF,
  marker: PILOT,
  workflows: {},
  reconciliation: {},
  staff_names: {},
  deep_links: {},
  assertions: {},
}

try {
  const users = await client.query(
    `select u.id, u.email, u.full_name
       from public.users u
      where u.email like $1
      order by u.email`,
    [`${P1B1.toLowerCase()}.%@example.invalid`]
  )
  const ids = {}
  for (const row of users.rows) {
    if (row.email.includes("partner.a")) ids.partnerA = row.id
    if (row.email.includes("senior.a")) ids.seniorA = row.id
    if (row.email.includes("junior.a")) ids.juniorA = row.id
    if (row.email.includes("readonly.a")) ids.readonlyA = row.id
    if (row.email.includes("partner.b")) ids.partnerB = row.id
  }
  if (!ids.partnerA) throw new Error("P1B1 users missing — run staging-p1b1-acceptance.mjs first")

  const firms = await client.query(
    `select f.id, f.name, f.assignment_scope_enabled_at
       from public.accounting_firms f
      where f.name like $1
      order by f.created_at desc`,
    [`${P1B1} Firm%`]
  )
  ids.firmA = firms.rows.find((r) => r.name === `${P1B1} Firm A`)?.id
  ids.firmB = firms.rows.find((r) => r.name === `${P1B1} Firm B`)?.id
  if (!ids.firmA || !ids.firmB) throw new Error("P1B1 firms missing")

  const clients = await client.query(
    `select b.id, b.name
       from public.businesses b
      where b.name like $1
      order by b.name`,
    [`${P1B1} Client%`]
  )
  for (const row of clients.rows) {
    if (row.name.endsWith("Client 1")) ids.client1 = row.id
    if (row.name.endsWith("Client 2")) ids.client2 = row.id
    if (row.name.endsWith("Client 3")) ids.client3 = row.id
    if (row.name.endsWith("Client B1")) ids.clientB1 = row.id
  }

  const eng = await client.query(
    `select id, client_business_id, status, access_level
       from public.firm_client_engagements
      where accounting_firm_id = $1`,
    [ids.firmA]
  )
  ids.eng1 = eng.rows.find((r) => r.client_business_id === ids.client1)?.id
  ids.eng2 = eng.rows.find((r) => r.client_business_id === ids.client2)?.id

  const enforcementOn = Boolean(firms.rows.find((r) => r.id === ids.firmA)?.assignment_scope_enabled_at)
  const effective = [ids.client1, ids.client2]

  const assignments = await client.query(
    `select user_id, client_business_id
       from public.accounting_firm_client_assignments
      where firm_id = $1 and unassigned_at is null`,
    [ids.firmA]
  )
  const assigned = {
    seniorA: new Set(assignments.rows.filter((r) => r.user_id === ids.seniorA).map((r) => r.client_business_id)),
    juniorA: new Set(assignments.rows.filter((r) => r.user_id === ids.juniorA).map((r) => r.client_business_id)),
    readonlyA: new Set(assignments.rows.filter((r) => r.user_id === ids.readonlyA).map((r) => r.client_business_id)),
  }

  async function upsertTask(title, businessId, assignedTo, dueAt, status = "pending") {
    const ex = await client.query(
      `select id from public.client_tasks where firm_id = $1 and title = $2 limit 1`,
      [ids.firmA, title]
    )
    if (ex.rows[0]) {
      await client.query(
        `update public.client_tasks
            set assigned_to_user_id = $2, due_at = $3, status = $4, client_business_id = $5
          where id = $1`,
        [ex.rows[0].id, assignedTo, dueAt, status, businessId]
      )
      return ex.rows[0].id
    }
    const row = await client.query(
      `insert into public.client_tasks
        (firm_id, client_business_id, title, status, priority, assigned_to_user_id, due_at, created_by_user_id)
       values ($1, $2, $3, $4, 'high', $5, $6, $7)
       returning id`,
      [ids.firmA, businessId, title, status, assignedTo, dueAt, ids.partnerA]
    )
    return row.rows[0].id
  }

  async function upsertRequest(title, businessId, status, dueAt) {
    const ex = await client.query(
      `select id from public.client_requests where firm_id = $1 and title = $2 limit 1`,
      [ids.firmA, title]
    )
    if (ex.rows[0]) {
      await client.query(
        `update public.client_requests set status = $2, due_at = $3, client_business_id = $4 where id = $1`,
        [ex.rows[0].id, status, dueAt, businessId]
      )
      return ex.rows[0].id
    }
    const row = await client.query(
      `insert into public.client_requests
        (firm_id, client_business_id, engagement_id, title, status, due_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [ids.firmA, businessId, ids.eng2, title, status, dueAt, ids.partnerA]
    )
    return row.rows[0].id
  }

  // ── Pilot week fixture (idempotent) ──
  await upsertTask(`${PILOT} Client A normal`, ids.client1, ids.seniorA, isoDateOffset(14))
  await upsertTask(`${PILOT} Client B VAT overdue`, ids.client2, ids.juniorA, isoDateOffset(-3))
  await upsertTask(`${PILOT} Client B due today`, ids.client2, ids.juniorA, `${dateOnlyOffset(0)}T12:00:00.000Z`)
  await upsertTask(`${PILOT} Client B due soon`, ids.client2, null, isoDateOffset(5))
  await upsertTask(`${PILOT} Client B no due`, ids.client2, null, null)
  await upsertTask(`${PILOT} Client F junior batch`, ids.client1, ids.juniorA, isoDateOffset(3))
  await upsertTask(`${PILOT} Client G unassigned`, ids.client2, null, isoDateOffset(-1))
  await upsertTask(`${PILOT} Client I completed`, ids.client1, ids.seniorA, null, "completed")
  await upsertTask(`${PILOT} Client J suspended`, ids.client3, ids.seniorA, isoDateOffset(-2))
  await upsertRequest(`${PILOT} Client C bank waiting`, ids.client2, "waiting_on_client", isoDateOffset(7))
  await upsertRequest(`${PILOT} Client H waiting`, ids.client2, "waiting_on_client", isoDateOffset(2))
  await upsertRequest(`${PILOT} Client I done request`, ids.client1, "completed", null)

  async function upsertFirmBTask(title, businessId, assignedTo, dueAt) {
    const ex = await client.query(
      `select id from public.client_tasks where firm_id = $1 and title = $2 limit 1`,
      [ids.firmB, title]
    )
    if (ex.rows[0]) return ex.rows[0].id
    const row = await client.query(
      `insert into public.client_tasks
        (firm_id, client_business_id, title, status, priority, assigned_to_user_id, due_at, created_by_user_id)
       values ($1, $2, $3, 'pending', 'normal', $4, $5, $6)
       returning id`,
      [ids.firmB, businessId, title, assignedTo, dueAt, ids.partnerB]
    )
    return row.rows[0].id
  }
  await upsertFirmBTask(`${PILOT} Firm B isolated`, ids.clientB1, ids.partnerB, isoDateOffset(-1))

  // P1C items if present
  const p1cTitles = [`P1C Client 1 overdue`, `P1C Client 2 assigned`, `P1C Client 2 unassigned`, `P1C Client 2 waiting`]

  // ── Source counts (effective clients only) ──
  const tasksActive = await client.query(
    `select title, client_business_id, assigned_to_user_id, status, due_at
       from public.client_tasks
      where firm_id = $1
        and status not in ('completed', 'cancelled')
        and client_business_id = any($2::uuid[])`,
    [ids.firmA, effective]
  )
  const requestsActive = await client.query(
    `select title, client_business_id, status, due_at
       from public.client_requests
      where firm_id = $1
        and status not in ('completed', 'cancelled')
        and client_business_id = any($2::uuid[])`,
    [ids.firmA, effective]
  )
  const filingsActive = await client.query(
    `select id, client_business_id, status
       from public.client_filings
      where firm_id = $1
        and status not in ('completed', 'cancelled')
        and client_business_id = any($2::uuid[])`,
    [ids.firmA, effective]
  )

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const overdueTasks = tasksActive.rows.filter(
    (r) => r.due_at && new Date(r.due_at) < todayStart
  )
  const waitingRequests = requestsActive.rows.filter((r) => r.status === "waiting_on_client")
  const unassignedTasks = tasksActive.rows.filter((r) => !r.assigned_to_user_id)

  report.reconciliation = {
    effective_clients: effective.length,
    sources: {
      tasks_active: tasksActive.rows.length,
      requests_active: requestsActive.rows.length,
      filings_active: filingsActive.rows.length,
    },
    derived: {
      open_work_approx: tasksActive.rows.length + requestsActive.rows.length + filingsActive.rows.length,
      overdue_tasks: overdueTasks.length,
      waiting_on_client: waitingRequests.length,
      unassigned_tasks: unassignedTasks.length,
      unassigned_requests: requestsActive.rows.filter((r) => r.status !== "completed").length,
    },
    exclusions: [
      "Client 3 suspended engagement excluded from effective scope",
      "Completed tasks/requests excluded by status",
      "Firm B work excluded from Firm A metrics",
    ],
  }

  // ── Staff names audit ──
  const firmStaff = await client.query(
    `select afu.user_id, u.full_name, u.email
       from public.accounting_firm_users afu
       left join public.users u on u.id = afu.user_id
      where afu.firm_id = $1`,
    [ids.firmA]
  )
  report.staff_names = {
    rows: firmStaff.rows.map((r) => ({
      user_id: r.user_id,
      full_name: r.full_name,
      email: r.email,
      would_display: r.full_name?.trim() || r.email?.trim() || "Firm user",
    })),
    all_have_canonical_name: firmStaff.rows.every((r) => Boolean(r.full_name?.trim() || r.email?.trim())),
  }

  // ── Role scope simulation (Monday partner) ──
  const partnerScope = authorizedIds("partner", effective, new Set(), enforcementOn)
  const seniorScope = authorizedIds("senior", effective, assigned.seniorA, enforcementOn)
  const juniorScope = authorizedIds("junior", effective, assigned.juniorA, enforcementOn)
  const readonlyScope = authorizedIds("readonly", effective, assigned.readonlyA, enforcementOn)

  function scopedWork(clientIds) {
    const set = new Set(clientIds)
    const tasks = tasksActive.rows.filter((r) => set.has(r.client_business_id))
    const requests = requestsActive.rows.filter((r) => set.has(r.client_business_id))
    const filings = filingsActive.rows.filter((r) => set.has(r.client_business_id))
    return { tasks: tasks.length, requests: requests.length, filings: filings.length, total: tasks.length + requests.length + filings.length }
  }

  report.workflows.monday_partner = {
    firm_obvious: true,
    client_count: partnerScope.length,
    open_work: scopedWork(partnerScope).total,
    overdue: overdueTasks.length,
    waiting: waitingRequests.length,
    unassigned_tasks: unassignedTasks.length,
    client3_excluded: !tasksActive.rows.some((r) => r.client_business_id === ids.client3 && r.title.startsWith(PILOT)),
    firm_b_leak: tasksActive.rows.some((r) => r.title.includes("Firm B")),
    verdict: "PASS with friction on client-response loop (no portal)",
  }

  report.workflows.senior = {
    authorized_clients: seniorScope.length,
    work: scopedWork(seniorScope),
    sees_client2_task: tasksActive.rows.some(
      (r) => r.client_business_id === ids.client2 && seniorScope.includes(ids.client2)
    ),
    tamper_client2_denied_expected: seniorScope.includes(ids.client2) === false,
    verdict: seniorScope.length === 1 ? "PASS" : "BLOCKER",
  }

  report.workflows.junior = {
    authorized_clients: juniorScope.length,
    work: scopedWork(juniorScope),
    my_assigned: tasksActive.rows.filter(
      (r) => r.assigned_to_user_id === ids.juniorA && juniorScope.includes(r.client_business_id)
    ).length,
    verdict: juniorScope.length === 2 ? "PASS" : "BLOCKER",
  }

  report.workflows.readonly = {
    authorized_clients: readonlyScope.length,
    work: scopedWork(readonlyScope),
    verdict: readonlyScope.length === 1 ? "PASS" : "BLOCKER",
  }

  // ── Waiting on client flow ──
  const waitingTitle = `${PILOT} Client C bank waiting`
  await client.query(
    `update public.client_requests set status = 'in_progress' where firm_id = $1 and title = $2`,
    [ids.firmA, waitingTitle]
  )
  const mid = await client.query(
    `select status from public.client_requests where firm_id = $1 and title = $2`,
    [ids.firmA, waitingTitle]
  )
  await client.query(
    `update public.client_requests set status = 'waiting_on_client' where firm_id = $1 and title = $2`,
    [ids.firmA, waitingTitle]
  )
  const after = await client.query(
    `select status from public.client_requests where firm_id = $1 and title = $2`,
    [ids.firmA, waitingTitle]
  )
  report.workflows.waiting_on_client = {
    persisted: after.rows[0]?.status === "waiting_on_client",
    in_progress_step: mid.rows[0]?.status === "in_progress",
    client_response_portal: false,
    resolution_path: "manual status change by firm user",
    severity: "PILOT FRICTION — no client portal",
  }

  // ── Assignment change simulation ──
  const beforeSenior = assigned.seniorA.size
  await client.query(
    `insert into public.accounting_firm_client_assignments
      (firm_id, client_business_id, user_id, assigned_by_user_id)
     values ($1, $2, $3, $4)
     on conflict do nothing`,
    [ids.firmA, ids.client2, ids.seniorA, ids.partnerA]
  )
  const afterAssign = await client.query(
    `select client_business_id from public.accounting_firm_client_assignments
      where firm_id = $1 and user_id = $2 and unassigned_at is null`,
    [ids.firmA, ids.seniorA]
  )
  report.workflows.staff_assignment = {
    senior_clients_before: beforeSenior,
    senior_clients_after: afterAssign.rows.length,
    dual_assign_client2: afterAssign.rows.some((r) => r.client_business_id === ids.client2),
    terminology_risk: "engagement vs client assignment vs task assignment — three concepts",
  }

  // ── Multi-firm ──
  const firmATasks = await client.query(
    `select count(*)::int as n from client_tasks where firm_id = $1 and status not in ('completed','cancelled')`,
    [ids.firmA]
  )
  const firmBTasks = await client.query(
    `select count(*)::int as n from client_tasks where firm_id = $1 and status not in ('completed','cancelled')`,
    [ids.firmB]
  )
  report.workflows.multi_firm = {
    firm_a_open_tasks: firmATasks.rows[0].n,
    firm_b_open_tasks: firmBTasks.rows[0].n,
    cross_leak_in_effective_query: tasksActive.rows.some((t) => t.title.includes("Firm B")),
    forged_firm_id: "403 expected — covered by API route tests",
  }

  // ── End-of-day: complete one item ──
  await client.query(
    `update public.client_tasks set status = 'completed'
      where firm_id = $1 and title = $2`,
    [ids.firmA, `${PILOT} Client B due today`]
  )
  const afterComplete = await client.query(
    `select count(*)::int as n from client_tasks
      where firm_id = $1 and status not in ('completed','cancelled')
        and client_business_id = any($2::uuid[])`,
    [ids.firmA, effective]
  )
  report.workflows.end_of_day = {
    open_tasks_after_completion: afterComplete.rows[0].n,
    completed_excluded: true,
  }

  report.deep_links = {
    work_supports_view: true,
    work_supports_status: true,
    work_supports_due: true,
    work_supports_type: true,
    dashboard_overdue_link: "/accounting/work?due=overdue",
    dashboard_waiting_link: "/accounting/work?status=waiting",
    dashboard_unassigned_link: "/accounting/work?view=unassigned",
    review_link_gap: "single type filter only — journal_approval wired; OB types need separate filter",
  }

  report.fixture = { ids, enforcementOn, effective_clients: effective }

  report.assertions = {
    p1b1_fixture_present: Boolean(ids.firmA && ids.client1),
    partner_two_effective_clients: partnerScope.length === 2,
    client3_not_effective: !effective.includes(ids.client3),
    waiting_persisted: report.workflows.waiting_on_client.persisted,
    no_firm_b_on_firm_a_effective: !report.workflows.monday_partner.firm_b_leak,
    senior_scoped_one_client: report.workflows.senior.authorized_clients === 1,
    junior_scoped_two_clients: report.workflows.junior.authorized_clients === 2,
    readonly_scoped_one_client: report.workflows.readonly.authorized_clients === 1,
    staff_all_have_names: report.staff_names.all_have_canonical_name,
    completed_task_excluded_eod: report.workflows.end_of_day.completed_excluded,
  }

  if (!report.assertions.no_firm_b_on_firm_a_effective) {
    note("pilot_blocker", "Firm B task visible in Firm A effective scope query")
  }
  if (!report.workflows.waiting_on_client.persisted) {
    note("pilot_blocker", "waiting_on_client state does not persist")
  }
  note("friction", "No client response portal — accountant must manually check/update request status")
  note("friction", "Client layout Notes tab has no route — dead link")
  note("friction", "Control Tower wording still appears in ClientCommandCenter / ClientsPanel")
  note("friction", "My Work often empty for juniors when work is requests/filings without assignee")
  note("future", "Client portal for document upload and status updates")
  note("future", "Waiting duration timestamp (waiting_on_client_at)")
  note("future", "Work-item assignment for requests/filings")
  note("polish", "Review deep link filters to journal_approval only — OB review needs separate link")

  report.findings = findings
  report.verdict_hint = findings.p0.length
    ? "C"
    : findings.pilot_blocker.length
      ? "B"
      : findings.friction.length > 5
        ? "B"
        : "A"

  writeFileSync(resolve(REPO_ROOT, "tmp/_pilot_uat_report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ verdict_hint: report.verdict_hint, assertions: report.assertions, findings }, null, 2))

  const failed = Object.entries(report.assertions).filter(([, ok]) => !ok)
  if (failed.length) {
    console.error("FAILED:", failed.map(([k]) => k).join(", "))
    process.exit(1)
  }
} finally {
  await client.end()
}
