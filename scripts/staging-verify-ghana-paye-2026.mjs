/**
 * Staging-only Ghana PAYE Act 1178 verification (project adonhhtooawkeemdqqeo).
 *
 * Creates three synthetic monthly staff (low / medium / high), creates a
 * September 2026 payroll run through the real API, checks the statutory
 * calculations, approves + locks it, and verifies payslip, PAYE schedule and
 * journal output. Refuses production.
 *
 *   node scripts/staging-verify-ghana-paye-2026.mjs
 *   node scripts/staging-verify-ghana-paye-2026.mjs --base-url=http://127.0.0.1:3000
 *
 * Run requires the Next.js server for the target branch to be running locally
 * (or another staging preview URL) with .env.staging credentials loaded.
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const BUSINESS_ID = "b4766e05-f5c0-4232-a97f-4dfba6e1f0c2" // Materials staging (isolated)
const OWNER_EMAIL = "staging2@test.com"
const PERIOD_START = "2026-09-01"
const PERIOD_END = "2026-09-30"
const MARKER = `PAYE-2026-VERIFY-${Date.now()}`

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
  "http://127.0.0.1:3000"

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
  // Mirror @supabase/ssr chunking: sessions above 3180 chars must be split.
  const max = 3180
  if (encoded.length <= max) return `${key}=${encoded}`
  const parts = []
  for (let i = 0; i < encoded.length; i += max) {
    parts.push(`${key}.${parts.length}=${encoded.slice(i, i + max)}`)
  }
  return parts.join("; ")
}
async function api(cookie, method, path, body) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Accept: "application/json",
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
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/api/health/version`)
      if (r.ok || r.status === 401 || r.status === 404) return
    } catch {
      // not ready yet
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
    const business = await db.query(
      "select id, name, owner_id, address_country from businesses where id=$1",
      [BUSINESS_ID]
    )
    if (!business.rows[0]) failFatal("staging verification business not found")
    record(
      "setup",
      "staging business resolved",
      /ghana|^gh$/i.test(business.rows[0].address_country),
      business.rows[0].name
    )

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
      record("setup", "created open September 2026 accounting period", true)
    } else {
      record(
        "setup",
        "September 2026 accounting period is open",
        period.rows[0].status === "open",
        period.rows[0].status
      )
    }

    for (const target of TARGETS) {
      const name = `${MARKER} ${target.key}`
      const inserted = await db.query(
        `insert into staff (
           business_id, name, basic_salary, employment_type, is_tax_resident,
           is_pensionable, secondary_employment, salary_basis, status,
           tin_number, position, gra_position_code
         ) values ($1,$2,$3,'full_time',true,true,false,'monthly','active',$4,'Accountant','OTHR')
         returning id, name, basic_salary`,
        [BUSINESS_ID, name, target.basic, `P${Date.now()}${target.key}`.slice(0, 15)]
      )
      target.staffId = inserted.rows[0].id
      createdStaff.push(inserted.rows[0])
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
    record("run", "created September 2026 run", true, runId)

    const runRes = await api(cookie, "GET", `/api/payroll/runs/${runId}`)
    if (!runRes.ok) failFatal(`fetch run failed: ${runRes.status} ${runRes.text}`)
    const run = runRes.data.payrollRun
    const entries = runRes.data.entries || []
    record(
      "run",
      "run stores Act 1178 PAYE version",
      run.paye_rate_version === "gh-paye-2026-09",
      String(run.paye_rate_version)
    )
    record(
      "run",
      "run stores 2026 pension version",
      run.pension_rate_version === "gh-pension-2026-01",
      String(run.pension_rate_version)
    )

    for (const target of TARGETS) {
      const entry = entries.find((e) => e.staff_id === target.staffId)
      if (!entry) {
        record("calc", `${target.key} staff entry present`, false, target.staffId)
        continue
      }
      record("calc", `${target.key} gross pay`, same(entry.gross_salary, target.basic), `${entry.gross_salary}`)
      record(
        "calc",
        `${target.key} employee SSNIT`,
        same(entry.ssnit_employee, target.ssnit),
        `${entry.ssnit_employee}`
      )
      record(
        "calc",
        `${target.key} chargeable income`,
        same(entry.taxable_income, target.chargeable),
        `${entry.taxable_income}`
      )
      record("calc", `${target.key} PAYE`, same(entry.paye, target.paye), `${entry.paye}`)
      record("calc", `${target.key} net pay`, same(entry.net_salary, target.net), `${entry.net_salary}`)
      record(
        "calc",
        `${target.key} gross - SSNIT - PAYE = net`,
        same(Number(entry.gross_salary) - Number(entry.ssnit_employee) - Number(entry.paye), entry.net_salary),
        `${entry.net_salary}`
      )
    }

    const included = entries.filter((e) => e.is_included !== false)
    const sums = included.reduce(
      (acc, e) => {
        acc.gross += Number(e.gross_salary || 0)
        acc.ssnit += Number(e.ssnit_employee || 0)
        acc.paye += Number(e.paye || 0)
        acc.net += Number(e.net_salary || 0)
        return acc
      },
      { gross: 0, ssnit: 0, paye: 0, net: 0 }
    )
    record("summary", "run total gross reconciles", same(run.total_gross_salary, sums.gross), `${run.total_gross_salary}`)
    record("summary", "run total SSNIT reconciles", same(run.total_ssnit_employee, sums.ssnit), `${run.total_ssnit_employee}`)
    record("summary", "run total PAYE reconciles", same(run.total_paye, sums.paye), `${run.total_paye}`)
    record("summary", "run total net reconciles", same(run.total_net_salary, sums.net), `${run.total_net_salary}`)

    const approved = await api(cookie, "PUT", `/api/payroll/runs/${runId}`, { status: "approved" })
    if (!approved.ok) failFatal(`approve failed: ${approved.status} ${approved.text}`)
    record("approval", "run approved", true, "ok")

    const approvedRunRes = await api(cookie, "GET", `/api/payroll/runs/${runId}`)
    const approvedRun = approvedRunRes.data.payrollRun
    record(
      "approval",
      "journal entry linked",
      approvedRun.status === "approved" && Boolean(approvedRun.journal_entry_id),
      String(approvedRun.journal_entry_id)
    )

    const journal = await db.query(
      `select l.debit, l.credit, a.code, a.name
       from journal_entry_lines l
       join accounts a on a.id = l.account_id
       where l.journal_entry_id = $1
       order by a.code`,
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
    record(
      "journal",
      "net salaries payable credit equals run net",
      same(
        journal.rows.filter((r) => r.code === "2240").reduce((s, r) => s + Number(r.credit || 0), 0),
        approvedRun.total_net_salary
      ),
      String(approvedRun.total_net_salary)
    )

    const payslipGen = await api(cookie, "POST", `/api/payroll/runs/${runId}/generate-payslips`, {})
    record("payslip", "payslips generated", payslipGen.ok, payslipGen.data?.message || "")
    const payslipList = await api(cookie, "GET", `/api/payroll/runs/${runId}/payslips`)
    const payslips = payslipList.data?.payslips || []
    for (const target of TARGETS) {
      const slip = payslips.find((p) => p.staff_id === target.staffId)
      if (!slip) {
        record("payslip", `${target.key} payslip exists`, false)
        continue
      }
      const publicRes = await api(cookie, "GET", `/api/payslips/public/${slip.public_token}`)
      const pe = publicRes.data?.payslip?.payroll_entries
      record(
        "payslip",
        `${target.key} payslip PAYE/net`,
        Boolean(pe) && same(pe.paye, target.paye) && same(pe.net_salary, target.net),
        pe ? `PAYE ${pe.paye} net ${pe.net_salary}` : publicRes.text
      )
    }

    const csv = await apiBinary(cookie, `/api/payroll/runs/${runId}/exports/paye-schedule`)
    record("paye-schedule", "PAYE schedule downloads", csv.ok && csv.text.length > 0, `${csv.status}`)
    for (const target of TARGETS) {
      const row = csv.text.split(/\r?\n/).find((line) => line.includes(target.staffId))
      record(
        "paye-schedule",
        `${target.key} row PAYE`,
        Boolean(row) && row.includes(target.paye.toFixed(2)),
        row ? "found" : "missing"
      )
    }

    const locked = await api(cookie, "PUT", `/api/payroll/runs/${runId}`, { status: "locked" })
    record("lock", "run locks after approval", locked.ok, `${locked.status}`)
    const lockedRes = await api(cookie, "GET", `/api/payroll/runs/${runId}`)
    record(
      "lock",
      "locked status persisted",
      lockedRes.data?.payrollRun?.status === "locked",
      String(lockedRes.data?.payrollRun?.status)
    )

    console.log(`\nRun: ${runId}`)
    console.log(`Created staff: ${createdStaff.map((s) => `${s.name} (${s.id})`).join(", ")}`)
    console.log(JSON.stringify({ runId, results }, null, 2))

    const failed = results.filter((r) => !r.pass)
    if (failed.length) {
      console.error(`\n${failed.length} checks failed`)
      process.exit(1)
    }
    console.log("\nALL STAGING CHECKS PASSED")
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
