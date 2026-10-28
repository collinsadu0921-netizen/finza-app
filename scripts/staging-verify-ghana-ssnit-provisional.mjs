/**
 * Staging-only verification of the January 2027 provisional SSNIT path.
 *
 * Creates three synthetic monthly staff, creates a 2027-01 payroll run through
 * the real API, verifies provisional snapshots and amounts, rejects approval
 * without acknowledgement, approves with acknowledgement, verifies payslip,
 * PAYE schedule, journal, payment and locking. Refuses production.
 *
 *   node scripts/staging-verify-ghana-ssnit-provisional.mjs --base-url=http://127.0.0.1:3101
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const BUSINESS_ID = "b4766e05-f5c0-4232-a97f-4dfba6e1f0c2" // Materials staging
const OWNER_EMAIL = "staging2@test.com"
const PERIOD_START = "2027-01-01"
const PERIOD_END = "2027-01-31"
const MARKER = `SSNIT-PROVISIONAL-${Date.now()}`

const TARGETS = [
  { key: "low", basic: 1000, ssnit: 55, chargeable: 945, paye: 44.98, net: 900.02 },
  { key: "medium", basic: 10000, ssnit: 550, chargeable: 9450, paye: 1967.0, net: 7483.0 },
  { key: "high", basic: 60000, ssnit: 3300, chargeable: 56700, paye: 15966.1, net: 40733.9 },
]

function loadEnvFile(filename) {
  const path = resolve(REPO_ROOT, filename)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const i = t.indexOf("=")
    if (i < 0) continue
    const key = t.slice(0, i).trim()
    let val = t.slice(i + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvFile(".env.staging")

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const BASE_URL =
  process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1]?.trim() ||
  "http://127.0.0.1:3101"

const results = []
function record(section, name, pass, detail = "") {
  results.push({ section, name, pass, detail })
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`)
}
function failFatal(msg) {
  console.error(`\nFATAL: ${msg}\n`)
  process.exit(1)
}
function assertStaging() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || STAGING_URL
  if (!url.includes(STAGING_REF)) failFatal(`not staging: ${url}`)
  if (url.includes(PRODUCTION_REF)) failFatal("production refused")
  if (!SERVICE_ROLE_KEY || !ANON_KEY) failFatal("missing staging keys")
  if (!process.env.SUPABASE_DB_PASSWORD) failFatal("missing SUPABASE_DB_PASSWORD")
}
function money(n) {
  return Math.round(Number(n) * 100) / 100
}
function same(a, b) {
  return Math.abs(money(a) - money(b)) <= 0.005
}

async function mintUserSession() {
  const genRes = await fetch(`${STAGING_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: OWNER_EMAIL }),
  })
  if (!genRes.ok) throw new Error(`generate_link ${genRes.status}: ${await genRes.text()}`)
  const link = await genRes.json()
  const verifyRes = await fetch(`${STAGING_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", email: OWNER_EMAIL, token: link.email_otp }),
  })
  if (!verifyRes.ok) throw new Error(`verify ${verifyRes.status}: ${await verifyRes.text()}`)
  const session = await verifyRes.json()
  if (!session.access_token) throw new Error("no access_token")
  return session
}
function cookieHeader(session) {
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    token_type: session.token_type || "bearer",
    user: session.user,
  }
  const key = `sb-${STAGING_REF}-auth-token`
  const encoded = `base64-${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`
  const max = 3180
  if (encoded.length <= max) return `${key}=${encoded}`
  const parts = []
  for (let i = 0; i < encoded.length; i += max) {
    parts.push(`${key}.${parts.length}=${encoded.slice(i, i + max)}`)
  }
  return parts.join("; ")
}
async function api(cookie, method, path, body, headers = {}) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text }
  }
  return { ok: r.ok, status: r.status, data, text, headers: r.headers }
}
async function apiBinary(cookie, path) {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie, Accept: "text/csv,*/*" },
  })
  const buf = Buffer.from(await r.arrayBuffer())
  return { ok: r.ok, status: r.status, buf, text: buf.toString("utf8") }
}
async function setupDb() {
  const conn = `postgresql://postgres.${STAGING_REF}:${encodeURIComponent(
    process.env.SUPABASE_DB_PASSWORD
  )}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
  if (!conn.includes(STAGING_REF) || conn.includes(PRODUCTION_REF)) {
    failFatal("refused non-staging database")
  }
  const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  return client
}
async function waitForServer() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/api/health/version`)
      if (r.ok || r.status === 401 || r.status === 404) return
    } catch {
      // not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  failFatal(`server not reachable at ${BASE_URL}`)
}

async function main() {
  assertStaging()
  await waitForServer()
  const adminSb = createClient(STAGING_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const db = await setupDb()
  const createdStaff = []

  try {
    const period = await db.query(
      `select id,status from accounting_periods
       where business_id=$1 and period_start=$2 and period_end=$3
       order by id limit 1`,
      [BUSINESS_ID, PERIOD_START, PERIOD_END]
    )
    if (!period.rows[0]) {
      await db.query(
        `insert into accounting_periods (business_id, period_start, period_end, status)
         values ($1,$2,$3,'open')`,
        [BUSINESS_ID, PERIOD_START, PERIOD_END]
      )
      record("setup", "created open January 2027 accounting period", true)
    } else {
      record(
        "setup",
        "January 2027 accounting period is open",
        period.rows[0].status === "open",
        period.rows[0].status
      )
    }

    for (const target of TARGETS) {
      const name = `${MARKER} ${target.key}`
      const inserted = await adminSb
        .from("staff")
        .insert({
          business_id: BUSINESS_ID,
          name,
          basic_salary: target.basic,
          employment_type: "full_time",
          is_tax_resident: true,
          is_pensionable: true,
          secondary_employment: false,
          salary_basis: "monthly",
          status: "active",
          tin_number: `P${Date.now()}${target.key}`.slice(0, 15),
          position: "Accountant",
          gra_position_code: "OTHR",
        })
        .select("id,name,basic_salary")
        .single()
      if (inserted.error) failFatal(`staff insert failed: ${inserted.error.message}`)
      target.staffId = inserted.data.id
      createdStaff.push(inserted.data)
    }
    record("setup", "created low/medium/high staff", true, String(createdStaff.length))

    const session = await mintUserSession()
    const cookie = cookieHeader(session)
    record("auth", "staging owner session minted", true, OWNER_EMAIL)

    const created = await api(cookie, "POST", "/api/payroll/runs", {
      payroll_frequency: "monthly",
      run_type: "regular",
      pay_period_start: PERIOD_START,
      pay_period_end: PERIOD_END,
    })
    if (!created.ok) failFatal(`create run failed: ${created.status} ${created.text}`)
    const runId = created.data.payrollRun.id
    record("run", "created January 2027 run", true, runId)

    const runRes = await api(cookie, "GET", `/api/payroll/runs/${runId}`)
    if (!runRes.ok) failFatal(`fetch run failed: ${runRes.status} ${runRes.text}`)
    const run = runRes.data.payrollRun
    const entries = runRes.data.entries || []
    record(
      "provisional",
      "run uses provisional SSNIT version",
      run.pension_rate_version === "gh-pension-2027-provisional",
      String(run.pension_rate_version)
    )
    record(
      "provisional",
      "run snapshots provisional status",
      run.pension_limits_provisional === true,
      String(run.pension_limits_provisional)
    )
    record(
      "provisional",
      "run snapshots actual limits",
      same(run.pension_minimum_insurable_earnings, 587.8) &&
        same(run.pension_maximum_insurable_earnings, 69000),
      `${run.pension_minimum_insurable_earnings}–${run.pension_maximum_insurable_earnings}`
    )
    record(
      "provisional",
      "run snapshots limits effective date",
      String(run.pension_limits_effective_from || "").slice(0, 10) === "2026-01-01",
      String(run.pension_limits_effective_from)
    )
    record("provisional", "no acknowledgement before approval", !run.provisional_ssnit_acknowledged_at)

    for (const target of TARGETS) {
      const entry = entries.find((e) => e.staff_id === target.staffId)
      if (!entry) {
        record("calc", `${target.key} staff entry present`, false, target.staffId)
        continue
      }
      record("calc", `${target.key} employee SSNIT`, same(entry.ssnit_employee, target.ssnit), `${entry.ssnit_employee}`)
      record(
        "calc",
        `${target.key} chargeable income`,
        same(entry.taxable_income, target.chargeable),
        `${entry.taxable_income}`
      )
      record("calc", `${target.key} PAYE`, same(entry.paye, target.paye), `${entry.paye}`)
      record("calc", `${target.key} net pay`, same(entry.net_salary, target.net), `${entry.net_salary}`)
    }

    const blocked = await api(cookie, "PUT", `/api/payroll/runs/${runId}`, {
      status: "approved",
    })
    record(
      "approval",
      "approval without acknowledgement is blocked",
      blocked.status === 400 &&
        (blocked.data?.code === "PROVISIONAL_SSNIT_ACKNOWLEDGEMENT_REQUIRED" ||
          /provisional SSNIT|acknowledgement/i.test(String(blocked.data?.error || ""))),
      `${blocked.status} ${blocked.data?.code || ""}`
    )

    const approved = await api(cookie, "PUT", `/api/payroll/runs/${runId}`, {
      status: "approved",
      provisional_ssnit_acknowledged: true,
    })
    if (!approved.ok) failFatal(`approval with acknowledgement failed: ${approved.status} ${approved.text}`)
    record("approval", "approval with acknowledgement succeeds", true, "ok")

    const approvedRunRes = await api(cookie, "GET", `/api/payroll/runs/${runId}`)
    const approvedRun = approvedRunRes.data.payrollRun
    record(
      "approval",
      "run is approved with journal",
      approvedRun.status === "approved" && Boolean(approvedRun.journal_entry_id),
      String(approvedRun.journal_entry_id)
    )
    record(
      "approval",
      "acknowledgement snapshot recorded",
      Boolean(approvedRun.provisional_ssnit_acknowledged_at),
      String(approvedRun.provisional_ssnit_acknowledged_at)
    )

    const journal = await db.query(
      `select l.debit, l.credit, a.code
       from journal_entry_lines l
       join accounts a on a.id = l.account_id
       where l.journal_entry_id = $1`,
      [approvedRun.journal_entry_id]
    )
    const debit = journal.rows.reduce((s, r) => s + Number(r.debit || 0), 0)
    const credit = journal.rows.reduce((s, r) => s + Number(r.credit || 0), 0)
    record("journal", "journal is balanced", same(debit, credit), `dr=${money(debit)} cr=${money(credit)}`)
    const payeLine = journal.rows.find((r) => r.code === "2230")
    record(
      "journal",
      "PAYE payable credit equals run PAYE",
      Boolean(payeLine) && same(payeLine.credit, approvedRun.total_paye),
      payeLine ? `${payeLine.credit}` : "missing 2230"
    )

    const payslipGen = await api(cookie, "POST", `/api/payroll/runs/${runId}/generate-payslips`, {})
    record("payslip", "payslips generated", payslipGen.ok, payslipGen.data?.message || "")
    const payslipList = await api(cookie, "GET", `/api/payroll/runs/${runId}/payslips`)
    const payslips = payslipList.data?.payslips || []
    const low = TARGETS[0]
    const lowSlip = payslips.find((p) => p.staff_id === low.staffId)
    if (lowSlip) {
      const publicRes = await api(cookie, "GET", `/api/payslips/public/${lowSlip.public_token}`)
      const pe = publicRes.data?.payslip?.payroll_entries
      record(
        "payslip",
        "low payslip PAYE/net",
        Boolean(pe) && same(pe.paye, low.paye) && same(pe.net_salary, low.net),
        pe ? `PAYE ${pe.paye} net ${pe.net_salary}` : publicRes.text
      )
    } else {
      record("payslip", "low payslip exists", false)
    }

    const csv = await apiBinary(cookie, `/api/payroll/runs/${runId}/exports/paye-schedule`)
    record("paye-schedule", "PAYE schedule downloads", csv.ok && csv.text.length > 0, `${csv.status}`)
    const lowRow = csv.text.split(/\r?\n/).find((line) => line.includes(low.staffId))
    record(
      "paye-schedule",
      "low row PAYE",
      Boolean(lowRow) && lowRow.includes(low.paye.toFixed(2)),
      lowRow ? "found" : "missing"
    )

    const paymentAccounts = await api(cookie, "GET", `/api/payroll/runs/${runId}/payments`)
    const account = paymentAccounts.data?.paymentAccounts?.[0]
    if (!account) failFatal("no staging payment account available")
    const payment = await api(
      cookie,
      "POST",
      `/api/payroll/runs/${runId}/payments`,
      {
        payment_date: "2027-01-31",
        amount: Number(approvedRun.total_net_salary),
        payment_account_id: account.id,
        reference: `PROVISIONAL-${MARKER}`,
        notes: "Provisional SSNIT staging verification",
      },
      { "Idempotency-Key": `prov-${randomUUID()}` }
    )
    record("payment", "payment recorded on provisional run", payment.ok, `${payment.status}`)

    const locked = await api(cookie, "PUT", `/api/payroll/runs/${runId}`, { status: "locked" })
    record("lock", "run locks after provisional payment", locked.ok, `${locked.status}`)
    const lockedRes = await api(cookie, "GET", `/api/payroll/runs/${runId}`)
    record(
      "lock",
      "locked status persisted",
      lockedRes.data?.payrollRun?.status === "locked",
      String(lockedRes.data?.payrollRun?.status)
    )

    // A stale draft must move onto the current statutory version before approval.
    // Simulate a draft created before the provisional version was configured.
    const refreshStaff = await adminSb
      .from("staff")
      .insert({
        business_id: BUSINESS_ID,
        name: `${MARKER} refresh`,
        basic_salary: 2500,
        employment_type: "full_time",
        is_tax_resident: true,
        is_pensionable: true,
        secondary_employment: false,
        salary_basis: "monthly",
        status: "active",
        tin_number: `R${Date.now()}`.slice(0, 15),
        position: "Accountant",
        gra_position_code: "OTHR",
      })
      .select("id,name,basic_salary")
      .single()
    if (refreshStaff.error) failFatal(`refresh staff insert failed: ${refreshStaff.error.message}`)
    createdStaff.push(refreshStaff.data)
    record("setup", "created stale-draft refresh staff", true, refreshStaff.data.id)

    const created2 = await api(cookie, "POST", "/api/payroll/runs", {
      payroll_frequency: "monthly",
      run_type: "regular",
      pay_period_start: PERIOD_START,
      pay_period_end: PERIOD_END,
    })
    if (!created2.ok) failFatal(`refresh draft create failed: ${created2.status} ${created2.text}`)
    const refreshRunId = created2.data.payrollRun.id
    await db.query(
      `update public.payroll_runs
       set pension_rate_version='gh-pension-2026-01',
           pension_limits_provisional=false,
           pension_minimum_insurable_earnings=null,
           pension_maximum_insurable_earnings=null,
           pension_limits_effective_from=null,
           provisional_ssnit_acknowledged_at=null,
           provisional_ssnit_acknowledged_by=null
       where id=$1`,
      [refreshRunId]
    )
    const refreshedApproval = await api(cookie, "PUT", `/api/payroll/runs/${refreshRunId}`, {
      status: "approved",
      provisional_ssnit_acknowledged: true,
    })
    record(
      "refresh",
      "stale draft is recalculated before approval",
      refreshedApproval.ok,
      `${refreshedApproval.status}`
    )
    const refreshedRunRes = await api(cookie, "GET", `/api/payroll/runs/${refreshRunId}`)
    const refreshedRun = refreshedRunRes.data?.payrollRun
    const refreshedEntry = (refreshedRunRes.data?.entries || []).find(
      (e) => e.staff_id === refreshStaff.data.id
    )
    record(
      "refresh",
      "draft moved to provisional SSNIT version",
      refreshedRun?.pension_rate_version === "gh-pension-2027-provisional" &&
        refreshedRun?.pension_limits_provisional === true &&
        same(refreshedRun?.pension_minimum_insurable_earnings, 587.8) &&
        same(refreshedRun?.pension_maximum_insurable_earnings, 69000) &&
        String(refreshedRun?.pension_limits_effective_from || "").slice(0, 10) ===
          "2026-01-01",
      String(refreshedRun?.pension_rate_version)
    )
    record(
      "refresh",
      "refreshed entry uses provisional pension amount",
      same(refreshedEntry?.ssnit_employee, 137.5),
      `${refreshedEntry?.ssnit_employee}`
    )

    console.log(`\nRun: ${runId}`)
    console.log(`Created staff: ${createdStaff.map((s) => `${s.name} (${s.id})`).join(", ")}`)
    console.log(JSON.stringify({ runId, results }, null, 2))

    const failed = results.filter((r) => !r.pass)
    if (failed.length) {
      console.error(`\n${failed.length} checks failed`)
      process.exit(1)
    }
    console.log("\nALL PROVISIONAL SSNIT STAGING CHECKS PASSED")
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
