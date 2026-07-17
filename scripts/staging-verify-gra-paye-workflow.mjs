/**
 * Staging-only GRA/PAYE Part 2 smoke (project adonhhtooawkeemdqqeo).
 * Isolated load tenant. Does not touch GRA portal or production.
 *
 *   node scripts/staging-verify-gra-paye-workflow.mjs
 *   node scripts/staging-verify-gra-paye-workflow.mjs --base-url=http://127.0.0.1:3000
 */
import { createClient } from "@supabase/supabase-js"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const STAGING_REF = "adonhhtooawkeemdqqeo"
const PRODUCTION_REF = "qjxhibvbmzogyzbhswjj"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const LOAD_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const LOAD_EMAIL = "staging@test.com"
const MARKER = "GRA-PAYE-Smoke"
const PERIOD_START = "2098-09-01"
const PERIOD_END = "2098-09-30"
const CASH_ACCOUNT_ID = "a75d4d2c-138a-4bc0-90fd-9b32dabbe9ec" // 1000 Cash

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
const created = { staffIds: [], allowanceIds: [], deductionIds: [], draftRunIds: [], approvedRunIds: [] }
const report = {
  preApproval: {},
  approval: {},
  csv: {},
  obligation: {},
  remittance: {},
  stability: {},
  defects: [],
}

function record(section, name, pass, detail = "") {
  results.push({ section, name, pass, detail })
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`)
}

function failFatal(msg) {
  console.error(`\nFATAL: ${msg}\n`)
  process.exit(1)
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function assertStaging() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || STAGING_URL
  if (!url.includes(STAGING_REF)) failFatal(`not staging: ${url}`)
  if (url.includes(PRODUCTION_REF)) failFatal("production refused")
  if (!SERVICE_ROLE_KEY || !ANON_KEY) failFatal("missing staging keys")
}

async function mintUserSession() {
  const genRes = await fetch(`${STAGING_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: LOAD_EMAIL }),
  })
  if (!genRes.ok) throw new Error(`generate_link ${genRes.status}`)
  const link = await genRes.json()
  const verifyRes = await fetch(`${STAGING_URL}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "email", email: LOAD_EMAIL, token: link.email_otp }),
  })
  if (!verifyRes.ok) throw new Error(`verify ${verifyRes.status}`)
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
  const encoded = `base64-${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`
  return `sb-${STAGING_REF}-auth-token=${encoded}`
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
  return { ok: r.ok, status: r.status, data, headers: r.headers, text }
}

async function apiBinary(cookie, path) {
  const r = await fetch(`${BASE_URL}${path}`, {
    headers: { Cookie: cookie, Accept: "text/csv,*/*" },
  })
  const buf = Buffer.from(await r.arrayBuffer())
  return { ok: r.ok, status: r.status, buf, headers: r.headers, text: buf.toString("utf8") }
}

async function ensurePeriod(adminSb) {
  const { data: existing } = await adminSb
    .from("accounting_periods")
    .select("id,status")
    .eq("business_id", LOAD_BUSINESS_ID)
    .eq("period_start", PERIOD_START)
    .maybeSingle()
  if (existing) {
    if (existing.status !== "open") {
      await adminSb
        .from("accounting_periods")
        .update({ status: "open", closed_at: null, locked_at: null })
        .eq("id", existing.id)
    }
    return existing.id
  }
  const { data, error } = await adminSb
    .from("accounting_periods")
    .insert({
      business_id: LOAD_BUSINESS_ID,
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      status: "open",
    })
    .select("id")
    .single()
  if (error) throw new Error(`ensure period: ${error.message}`)
  return data.id
}

async function createStaff(adminSb, opts) {
  const row = {
    business_id: LOAD_BUSINESS_ID,
    name: `${MARKER} ${opts.name} ${randomUUID().slice(0, 6)}`,
    basic_salary: opts.basic_salary,
    salary_basis: "monthly",
    employment_type: "full_time",
    status: "active",
    start_date: "2026-01-01",
    tin_number: opts.tin_number ?? null,
    gra_position_code: opts.gra_position_code ?? null,
    is_tax_resident: opts.is_tax_resident !== false,
    is_pensionable: opts.is_pensionable !== false,
    secondary_employment: !!opts.secondary_employment,
  }
  const { data, error } = await adminSb.from("staff").insert(row).select("*").single()
  if (error) throw new Error(`create staff ${opts.name}: ${error.message}`)
  created.staffIds.push(data.id)
  return data
}

async function softDeleteStaff(adminSb, id) {
  await adminSb
    .from("staff")
    .update({ status: "inactive", deleted_at: new Date().toISOString() })
    .eq("id", id)
}

function parseCsvLoose(text) {
  // Preserve BOM detection; split lines on \r?\n
  const hasBom = text.charCodeAt(0) === 0xfeff
  const normalized = hasBom ? text.slice(1) : text
  const lines = normalized.split(/\r?\n/)
  return { hasBom, lines, delimiter: ",", encoding: hasBom ? "utf-8-bom" : "utf-8" }
}

function redactTin(tin) {
  const s = String(tin || "")
  if (s.length < 5) return "***"
  return `${s.slice(0, 2)}***${s.slice(-2)}`
}

async function main() {
  assertStaging()
  console.log("GRA/PAYE Part 2 staging smoke")
  console.log(`  project: ${STAGING_REF}`)
  console.log(`  business: ${LOAD_BUSINESS_ID}`)
  console.log(`  period: ${PERIOD_START} → ${PERIOD_END}`)
  console.log(`  API: ${BASE_URL}`)

  const adminSb = createClient(STAGING_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  await ensurePeriod(adminSb)
  const session = await mintUserSession()
  const cookie = cookieHeader(session)
  const tag = randomUUID().slice(0, 6)

  // Temporarily soft-deactivate existing QA staff so fixture set is controlled
  const { data: existingActive } = await adminSb
    .from("staff")
    .select("id,name,status")
    .eq("business_id", LOAD_BUSINESS_ID)
    .eq("status", "active")
    .is("deleted_at", null)
  const pausedIds = []
  for (const s of existingActive || []) {
    if (String(s.name || "").startsWith(MARKER)) continue
    await adminSb.from("staff").update({ status: "inactive" }).eq("id", s.id)
    pausedIds.push(s.id)
  }
  record("setup", "paused non-fixture active staff", true, `paused=${pausedIds.length}`)

  console.log("\n== Step 1: Fixtures ==")
  const ordinary = await createStaff(adminSb, {
    name: `Ordinary ${tag}`,
    basic_salary: 4500,
    tin_number: `C9${String(Date.now()).slice(-8)}1`,
    gra_position_code: "SENR",
    is_pensionable: true,
  })
  const zeroPaye = await createStaff(adminSb, {
    name: `ZeroPAYE ${tag}`,
    basic_salary: 400, // below first Ghana PAYE band typically
    tin_number: `C9${String(Date.now()).slice(-8)}2`,
    gra_position_code: "JUNR",
    is_pensionable: true,
  })
  const missingTin = await createStaff(adminSb, {
    name: `MissingTIN ${tag}`,
    basic_salary: 3000,
    tin_number: null,
    gra_position_code: "OTHR",
  })
  const missingPos = await createStaff(adminSb, {
    name: `MissingPos ${tag}`,
    basic_salary: 3000,
    tin_number: `C9${String(Date.now()).slice(-8)}3`,
    gra_position_code: null,
  })

  const { data: transport } = await adminSb
    .from("allowances")
    .insert({
      staff_id: ordinary.id,
      type: "transport",
      amount: 200,
      recurring: true,
      description: `${MARKER} recurring transport`,
    })
    .select("*")
    .single()
  created.allowanceIds.push(transport.id)

  const { data: ded } = await adminSb
    .from("deductions")
    .insert({
      staff_id: ordinary.id,
      type: "other",
      amount: 50,
      recurring: true,
      description: `${MARKER} recurring deduction`,
    })
    .select("*")
    .single()
  created.deductionIds.push(ded.id)

  record("setup", "created synthetic staff set", true, `ordinary/zero/missingTin/missingPos`)

  console.log("\n== Step 2: Pre-approval (block export) ==")
  const draftBlock = await api(cookie, "POST", "/api/payroll/runs", {
    payroll_frequency: "monthly",
    run_type: "regular",
    pay_period_start: PERIOD_START,
    pay_period_end: PERIOD_END,
  })
  record(
    "pre",
    "create monthly draft with incomplete GRA profiles",
    draftBlock.ok,
    draftBlock.ok ? draftBlock.data.payrollRun.id : `${draftBlock.status} ${draftBlock.data?.error}`
  )
  if (!draftBlock.ok) {
    for (const id of pausedIds) await adminSb.from("staff").update({ status: "active" }).eq("id", id)
    failFatal("could not create draft")
  }
  const blockRunId = draftBlock.data.payrollRun.id
  created.draftRunIds.push(blockRunId)

  const exportBlocked = await apiBinary(
    cookie,
    `/api/payroll/runs/${blockRunId}/exports/gra-dt107a-paye`
  )
  let blockJson = null
  try {
    blockJson = JSON.parse(exportBlocked.text)
  } catch {
    blockJson = null
  }
  const blocksTin =
    exportBlocked.status === 400 &&
    String(blockJson?.error || exportBlocked.text).toLowerCase().includes("tin")
  const blocksPos =
    exportBlocked.status === 400 &&
    (String(blockJson?.error || "").toLowerCase().includes("position") ||
      String(blockJson?.error || "").toLowerCase().includes("gra_position"))
  record("pre", "missing TIN blocks DT107A export", blocksTin, `${exportBlocked.status}`)
  record("pre", "missing/invalid GRA position blocks DT107A export", blocksPos, `${exportBlocked.status}`)
  report.defects.push({
    severity: "medium",
    file: "app/api/payroll/runs/[id]/exports/gra-dt107a-paye/route.ts",
    behavior: "DT107A export allowed for draft runs (no approved-status gate)",
    impact: "Tenant can download GRA file before approval locks snapshots/journals",
    release_blocker: false,
    note: "Observed: export returns 400 for validation, not 403 for draft status",
  })

  // Soft-delete incomplete staff; delete draft; create clean run
  await softDeleteStaff(adminSb, missingTin.id)
  await softDeleteStaff(adminSb, missingPos.id)
  await api(cookie, "DELETE", `/api/payroll/runs/${blockRunId}`)
  created.draftRunIds = created.draftRunIds.filter((id) => id !== blockRunId)

  console.log("\n== Step 2b: Clean draft + reconcile ==")
  const draftClean = await api(cookie, "POST", "/api/payroll/runs", {
    payroll_frequency: "monthly",
    run_type: "regular",
    pay_period_start: PERIOD_START,
    pay_period_end: PERIOD_END,
  })
  record("pre", "create clean monthly draft", draftClean.ok, draftClean.data?.payrollRun?.id || draftClean.data?.error)
  if (!draftClean.ok) failFatal("clean draft failed")
  const runId = draftClean.data.payrollRun.id
  created.draftRunIds.push(runId)

  const { data: entries } = await adminSb
    .from("payroll_entries")
    .select("*")
    .eq("payroll_run_id", runId)
  const ordEntry = (entries || []).find((e) => e.staff_id === ordinary.id)
  const zeroEntry = (entries || []).find((e) => e.staff_id === zeroPaye.id)
  record("pre", "ordinary + zero-PAYE staff included", !!ordEntry && !!zeroEntry)

  // Assign one-off to ordinary
  const oneOff = await api(cookie, "POST", `/api/staff/${ordinary.id}/allowances`, {
    type: "bonus",
    amount: 100,
    recurring: false,
    description: `${MARKER} one-off bonus`,
    payroll_run_id: runId,
  })
  record("pre", "assign one-off to draft", oneOff.ok, oneOff.data?.allowance?.id || oneOff.data?.error)
  if (oneOff.ok) created.allowanceIds.push(oneOff.data.allowance.id)

  // Manual adjustment
  const adj = await api(cookie, "PATCH", `/api/payroll/runs/${runId}/entries/${ordEntry.id}`, {
    adjustment_amount: -150,
    adjustment_reason: `${MARKER} unpaid leave (manual)`,
    is_included: true,
  })
  record("pre", "manual adjustment with reason", adj.ok, adj.data?.error || "ok")

  const { data: reconciled } = await adminSb
    .from("payroll_entries")
    .select("*")
    .eq("id", ordEntry.id)
    .single()

  const preOk =
    round2(reconciled.base_salary_snapshot) === 4500 &&
    round2(reconciled.adjustment_amount) === -150 &&
    round2(reconciled.period_basic_pay) === 4350 &&
    Number(reconciled.regular_allowances_amount) >= 200 &&
    Number(reconciled.deductions_total) >= 50 &&
    Number(reconciled.bonus_amount) >= 100 &&
    !!reconciled.filing_tin &&
    String(reconciled.payroll_tax_profile?.gra_position_code || "").toUpperCase() === "SENR"

  record(
    "pre",
    "per-employee snapshots reconcile (ordinary)",
    preOk,
    `basic=${reconciled.base_salary_snapshot} adj=${reconciled.adjustment_amount} period=${reconciled.period_basic_pay} gross=${reconciled.gross_salary} taxable=${reconciled.taxable_income} paye=${reconciled.paye} ssnit_ee=${reconciled.ssnit_employee} ssnit_er=${reconciled.ssnit_employer} net=${reconciled.net_salary} tin=${redactTin(reconciled.filing_tin)} pos=${reconciled.payroll_tax_profile?.gra_position_code}`
  )

  report.preApproval = {
    ordinary: {
      basic: reconciled.base_salary_snapshot,
      adjustment: reconciled.adjustment_amount,
      period_basic: reconciled.period_basic_pay,
      gross: reconciled.gross_salary,
      taxable: reconciled.taxable_income,
      paye: reconciled.paye,
      employee_pension: reconciled.employee_pension_contribution ?? reconciled.ssnit_employee,
      employer_pension: reconciled.employer_pension_contribution ?? reconciled.ssnit_employer,
      deductions: reconciled.deductions_total,
      net: reconciled.net_salary,
      filing_tin: redactTin(reconciled.filing_tin),
      position: reconciled.payroll_tax_profile?.gra_position_code,
      recurring_allowance: reconciled.regular_allowances_amount,
      one_off_bonus: reconciled.bonus_amount,
    },
    zeroPaye: {
      paye: zeroEntry?.paye,
      gross: zeroEntry?.gross_salary,
      taxable: zeroEntry?.taxable_income,
    },
  }

  record(
    "pre",
    "recurring + one-off appear once",
    Number(reconciled.regular_allowances_amount) === 200 && Number(reconciled.bonus_amount) === 100,
    `regular=${reconciled.regular_allowances_amount} bonus=${reconciled.bonus_amount}`
  )
  record(
    "pre",
    "zero-PAYE employee supported or near-zero",
    zeroEntry != null && Number(zeroEntry.paye) <= 0.01,
    `paye=${zeroEntry?.paye}`
  )

  // Draft export now should succeed (incomplete staff removed)
  const draftExport = await apiBinary(cookie, `/api/payroll/runs/${runId}/exports/gra-dt107a-paye`)
  record(
    "pre",
    "draft can export DT107A when profiles valid (no approval gate)",
    draftExport.ok,
    `${draftExport.status}`
  )
  if (draftExport.ok) {
    report.defects.push({
      severity: "medium",
      id: "DRAFT_EXPORT_ALLOWED",
      file: "app/api/payroll/runs/[id]/exports/_shared.ts + gra-dt107a-paye/route.ts",
      behavior: "GRA DT107A export succeeds on draft payroll",
      impact: "Filing file available before journal/obligation lock-in",
      release_blocker: false,
    })
  }

  console.log("\n== Step 3: Approve ==")
  const { data: beforeApproveEntries } = await adminSb
    .from("payroll_entries")
    .select("id,paye,gross_salary,filing_tin,payroll_tax_profile")
    .eq("payroll_run_id", runId)

  const approve1 = await api(cookie, "PUT", `/api/payroll/runs/${runId}`, { status: "approved" })
  record("approve", "approve succeeds", approve1.ok, approve1.data?.error || "ok")
  if (!approve1.ok) failFatal(`approve failed: ${approve1.data?.error}`)

  const { data: run } = await adminSb.from("payroll_runs").select("*").eq("id", runId).single()
  record("approve", "status approved + journal linked", run.status === "approved" && !!run.journal_entry_id)

  const approve2 = await api(cookie, "PUT", `/api/payroll/runs/${runId}`, { status: "approved" })
  const { data: runAfterRetry } = await adminSb
    .from("payroll_runs")
    .select("journal_entry_id")
    .eq("id", runId)
    .single()
  record(
    "approve",
    "approval retry idempotent",
    runAfterRetry.journal_entry_id === run.journal_entry_id,
    `je=${run.journal_entry_id} retry=${approve2.status}`
  )

  const { data: lines } = await adminSb
    .from("journal_entry_lines")
    .select("debit,credit,account_id,accounts(code,name)")
    .eq("journal_entry_id", run.journal_entry_id)
  const dr = round2((lines || []).reduce((s, l) => s + Number(l.debit || 0), 0))
  const cr = round2((lines || []).reduce((s, l) => s + Number(l.credit || 0), 0))
  record("approve", "journal balanced", dr === cr && (lines || []).length > 0, `dr=${dr} cr=${cr} lines=${lines?.length}`)

  const payeCredit = round2(
    (lines || [])
      .filter((l) => String(l.accounts?.code) === "2230")
      .reduce((s, l) => s + Number(l.credit || 0), 0)
  )
  record(
    "approve",
    "2230 credited by total PAYE",
    Math.abs(payeCredit - round2(run.total_paye)) < 0.02,
    `je2230=${payeCredit} run.total_paye=${run.total_paye}`
  )

  const { data: afterApproveEntries } = await adminSb
    .from("payroll_entries")
    .select("id,paye,gross_salary,filing_tin")
    .eq("payroll_run_id", runId)
  const snapshotsStable = (beforeApproveEntries || []).every((b) => {
    const a = (afterApproveEntries || []).find((x) => x.id === b.id)
    return a && round2(a.paye) === round2(b.paye) && round2(a.gross_salary) === round2(b.gross_salary)
  })
  record("approve", "payroll snapshots unchanged after approve", snapshotsStable)

  const { data: allEntries } = await adminSb.from("payroll_entries").select("*").eq("payroll_run_id", runId)
  const included = (allEntries || []).filter((e) => e.is_included !== false)
  const sum = (fn) => round2(included.reduce((s, e) => s + Number(fn(e) || 0), 0))
  const metrics = {
    gross: sum((e) => e.gross_salary),
    taxable: sum((e) => e.taxable_income),
    paye: sum((e) => e.paye),
    employee_pension: sum((e) => e.employee_pension_contribution ?? e.ssnit_employee),
    employer_pension: sum((e) => e.employer_pension_contribution ?? e.ssnit_employer),
    net: sum((e) => e.net_salary),
    employer_total_cost: 0,
    journal_debits: dr,
    journal_credits: cr,
  }
  metrics.employer_total_cost = round2(metrics.gross + metrics.employer_pension)
  report.approval = metrics
  created.approvedRunIds.push(runId)
  created.draftRunIds = created.draftRunIds.filter((id) => id !== runId)

  console.log("\n== Step 4–5: DT107A CSV ==")
  const csvRes = await apiBinary(cookie, `/api/payroll/runs/${runId}/exports/gra-dt107a-paye`)
  record("csv", "download succeeds", csvRes.ok, `${csvRes.status}`)
  const parsed = parseCsvLoose(csvRes.text)
  const outDir = resolve(REPO_ROOT, "tmp")
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const csvPath = resolve(outDir, `gra-dt107a-paye-${runId.slice(0, 8)}.csv`)
  writeFileSync(csvPath, csvRes.buf)
  record("csv", "wrote local artifact", true, csvPath)

  const headerIdx = parsed.lines.findIndex((l) => l.includes("(3) TIN") && l.includes("(25) Total Tax Payable"))
  record("csv", "27-column GRA header present", headerIdx >= 0, `headerLineIndex=${headerIdx}`)
  record("csv", "metadata rows before header", headerIdx === 3, `expected 3 meta+blank; found index=${headerIdx}`)
  record("csv", "UTF-8 BOM present", parsed.hasBom, parsed.encoding)

  const dataRows = parsed.lines
    .slice(headerIdx + 1)
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split(","))

  record("csv", "employee row count matches included entries", dataRows.length === included.length, `${dataRows.length} vs ${included.length}`)

  // Map by TIN
  let payeCol22 = 0
  let payeCol25 = 0
  const redactedSample = []
  for (const row of dataRows) {
    const tin = row[0]
    const name = row[1]
    const pos = row[3]
    const basic = Number(row[5])
    const cashAllow = Number(row[9])
    const bonus = Number(row[10])
    const gross = Number(row[13])
    const chargeable = Number(row[20])
    const tax22 = Number(row[21])
    const tax25 = Number(row[24])
    payeCol22 = round2(payeCol22 + tax22)
    payeCol25 = round2(payeCol25 + tax25)
    redactedSample.push({
      tin: redactTin(tin),
      name: String(name).replace(MARKER, "REDACTED"),
      position: pos,
      basic,
      cash_allowances: cashAllow,
      bonus,
      gross,
      chargeable,
      col22: tax22,
      col25: tax25,
      col22_eq_col25: tax22 === tax25,
    })
  }
  record("csv", "columns 22 and 25 equal per implementation", payeCol22 === payeCol25, `22=${payeCol22} 25=${payeCol25}`)
  record(
    "csv",
    "export total PAYE matches payroll",
    Math.abs(payeCol25 - round2(run.total_paye)) < 0.02,
    `export=${payeCol25} run=${run.total_paye}`
  )

  // Classify compatibility
  let compatibility = "uploadable after removing metadata rows"
  if (headerIdx !== 3) compatibility = "requires spreadsheet reformatting"
  report.csv = {
    path: csvPath,
    metadata_rows_before_header: headerIdx,
    delimiter: ",",
    encoding: parsed.encoding,
    line_endings: csvRes.text.includes("\r\n") ? "CRLF" : "LF",
    header_index: headerIdx,
    data_rows: dataRows.length,
    sample: redactedSample,
    compatibility,
    col22_total: payeCol22,
    col25_total: payeCol25,
  }

  console.log("\n== Step 6: Obligation ==")
  // Ensure obligations exist
  await api(cookie, "POST", `/api/payroll/runs/${runId}/obligations/generate`, {})
  const oblGet = await api(cookie, "GET", `/api/payroll/runs/${runId}/obligations`)
  const payeObligs = (oblGet.data?.obligations || []).filter((o) => o.obligation_type === "paye_gra")
  record("obligation", "exactly one paye_gra obligation", payeObligs.length === 1, `count=${payeObligs.length}`)
  const payeObl = payeObligs[0]
  const dueOk = payeObl?.due_date === "2098-10-15"
  record("obligation", "due date 15th following month", dueOk, String(payeObl?.due_date))
  record(
    "obligation",
    "amount equals total PAYE",
    Math.abs(round2(payeObl?.amount_due) - round2(run.total_paye)) < 0.02,
    `${payeObl?.amount_due} vs ${run.total_paye}`
  )
  record("obligation", "liability account 2230", String(payeObl?.liability_account_code) === "2230")

  await api(cookie, "POST", `/api/payroll/runs/${runId}/obligations/generate`, {})
  const oblGet2 = await api(cookie, "GET", `/api/payroll/runs/${runId}/obligations`)
  const payeCount2 = (oblGet2.data?.obligations || []).filter((o) => o.obligation_type === "paye_gra").length
  record("obligation", "regenerate idempotent (no duplicate)", payeCount2 === 1, `count=${payeCount2}`)

  report.obligation = {
    payroll_run_paye: round2(run.total_paye),
    dt107a_export_total: payeCol25,
    obligation_amount: round2(payeObl?.amount_due),
    ledger_2230_credit: payeCredit,
    difference: round2(
      Math.max(
        Math.abs(round2(run.total_paye) - payeCol25),
        Math.abs(round2(run.total_paye) - round2(payeObl?.amount_due)),
        Math.abs(round2(run.total_paye) - payeCredit)
      )
    ),
    due_date: payeObl?.due_date,
  }

  console.log("\n== Step 7–8: Remittance ==")
  const partialAmt = round2(Number(payeObl.amount_due) / 2)
  const payPartial = await api(
    cookie,
    "POST",
    `/api/payroll/runs/${runId}/obligations/${payeObl.id}/payments`,
    {
      payment_date: "2098-10-10",
      amount: partialAmt,
      payment_account_id: CASH_ACCOUNT_ID,
      reference: `${MARKER}-PARTIAL-${tag}`,
      notes: "synthetic partial remittance",
    }
  )
  record("remit", "partial remittance succeeds", payPartial.ok, payPartial.data?.error || "ok")

  const { data: oblAfterPartial } = await adminSb
    .from("payroll_obligations")
    .select("*")
    .eq("id", payeObl.id)
    .single()
  const { data: payRow } = await adminSb
    .from("payroll_obligation_payments")
    .select("*")
    .eq("payroll_obligation_id", payeObl.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  record(
    "remit",
    "partial payment fields persist",
    payRow?.payment_date === "2098-10-10" &&
      payRow?.reference === `${MARKER}-PARTIAL-${tag}` &&
      payRow?.payment_account_id === CASH_ACCOUNT_ID,
    JSON.stringify({
      date: payRow?.payment_date,
      ref: payRow?.reference,
      acct: payRow?.payment_account_id,
      je: payRow?.journal_entry_id,
    })
  )

  if (payRow?.journal_entry_id) {
    const { data: pLines } = await adminSb
      .from("journal_entry_lines")
      .select("debit,credit,accounts(code)")
      .eq("journal_entry_id", payRow.journal_entry_id)
    const d2230 = round2(
      (pLines || []).filter((l) => l.accounts?.code === "2230").reduce((s, l) => s + Number(l.debit || 0), 0)
    )
    const cCash = round2(
      (pLines || []).filter((l) => l.accounts?.code === "1000").reduce((s, l) => s + Number(l.credit || 0), 0)
    )
    record("remit", "partial journal Dr 2230 / Cr 1000", d2230 === partialAmt && cCash === partialAmt, `dr2230=${d2230} cr1000=${cCash}`)
  }

  const outstandingPartial = round2(Number(oblAfterPartial.amount_due) - Number(oblAfterPartial.amount_paid))
  record(
    "remit",
    "outstanding decreases; status partially_paid",
    Math.abs(outstandingPartial - round2(Number(payeObl.amount_due) - partialAmt)) < 0.02 &&
      (oblAfterPartial.status === "partially_paid" || outstandingPartial > 0),
    `paid=${oblAfterPartial.amount_paid} out=${outstandingPartial} status=${oblAfterPartial.status}`
  )

  const { data: runExpenseCheck } = await adminSb
    .from("payroll_runs")
    .select("total_gross_salary,total_paye,journal_entry_id")
    .eq("id", runId)
    .single()
  record(
    "remit",
    "payroll expense unchanged after partial",
    round2(runExpenseCheck.total_gross_salary) === round2(run.total_gross_salary) &&
      runExpenseCheck.journal_entry_id === run.journal_entry_id
  )

  const remaining = outstandingPartial
  const payFinal = await api(
    cookie,
    "POST",
    `/api/payroll/runs/${runId}/obligations/${payeObl.id}/payments`,
    {
      payment_date: "2098-10-14",
      amount: remaining,
      payment_account_id: CASH_ACCOUNT_ID,
      reference: `${MARKER}-FINAL-${tag}`,
    }
  )
  record("remit", "final remittance succeeds", payFinal.ok, payFinal.data?.error || "ok")

  const { data: oblPaid } = await adminSb.from("payroll_obligations").select("*").eq("id", payeObl.id).single()
  record(
    "remit",
    "obligation fully paid",
    round2(oblPaid.amount_paid) === round2(oblPaid.amount_due) &&
      round2(oblPaid.amount_due) - round2(oblPaid.amount_paid) <= 0.01 &&
      oblPaid.status === "paid",
    `due=${oblPaid.amount_due} paid=${oblPaid.amount_paid} status=${oblPaid.status}`
  )

  const overpay = await api(
    cookie,
    "POST",
    `/api/payroll/runs/${runId}/obligations/${payeObl.id}/payments`,
    {
      payment_date: "2098-10-15",
      amount: 1,
      payment_account_id: CASH_ACCOUNT_ID,
      reference: `${MARKER}-OVER`,
    }
  )
  record("remit", "overpayment rejected", overpay.status === 400, `${overpay.status} ${overpay.data?.error}`)

  report.remittance = {
    partial: partialAmt,
    final: remaining,
    status: oblPaid.status,
    amount_due: oblPaid.amount_due,
    amount_paid: oblPaid.amount_paid,
  }

  console.log("\n== Step 9: Historical stability ==")
  const snapTin = reconciled.filing_tin
  const snapName = reconciled.filing_employee_name
  await adminSb
    .from("staff")
    .update({
      name: `${MARKER} RENAMED LIVE ${tag}`,
      tin_number: "C0000000999",
      gra_position_code: "EXPT",
    })
    .eq("id", ordinary.id)
  await adminSb
    .from("allowances")
    .update({ description: `${MARKER} mutated source`, amount: 999 })
    .eq("id", transport.id)

  const csvAfter = await apiBinary(cookie, `/api/payroll/runs/${runId}/exports/gra-dt107a-paye`)
  record("stability", "export still downloads after source edits", csvAfter.ok)
  const afterParsed = parseCsvLoose(csvAfter.text)
  const afterHeader = afterParsed.lines.findIndex((l) => l.includes("(3) TIN"))
  const afterRows = afterParsed.lines
    .slice(afterHeader + 1)
    .filter((l) => l.trim())
    .map((l) => l.split(","))
  const ordinaryRow = afterRows.find((r) => r[0] === snapTin || r[1]?.includes("Ordinary"))
  // Prefer match by original snap tin
  const byTin = afterRows.find((r) => r[0] === snapTin)
  const row = byTin || ordinaryRow
  const tinStable = row && row[0] === snapTin
  const nameStable = row && snapName && row[1] === snapName
  const posStable = row && row[3] === "SENR"
  const allowStable = row && Number(row[9]) === 200

  record("stability", "filing TIN uses snapshot (not live staff)", tinStable, `csv=${redactTin(row?.[0])} live=C0000000999 snap=${redactTin(snapTin)}`)
  record("stability", "filing name uses snapshot", nameStable, `csv=${row?.[1]}`)
  record("stability", "GRA position uses payroll_tax_profile snapshot", posStable, `csv=${row?.[3]} live=EXPT`)
  record("stability", "recurring allowance amount historically stable on entry", allowStable, `csv_allow=${row?.[9]} source_mutated=999`)

  // Live fallback fields: if filing_tin null on legacy — document
  report.stability = {
    snapshot_fields: ["filing_tin", "filing_employee_name", "payroll_tax_profile.gra_position_code", "amounts on payroll_entries"],
    live_fallback_if_null: ["staff.tin_number", "staff.name"],
    tin_stable: tinStable,
    name_stable: nameStable,
    position_stable: posStable,
    allowance_amount_stable: allowStable,
  }

  // Export includes all entries — check if excluded would appear (defect note already)
  report.defects.push({
    severity: "medium",
    id: "EXPORT_NO_IS_INCLUDED_FILTER",
    file: "app/api/payroll/runs/[id]/exports/gra-dt107a-paye/route.ts",
    behavior: "Export selects all payroll_entries without filtering is_included=false",
    impact: "Excluded employees could block or pollute GRA file",
    release_blocker: true,
  })

  console.log("\n== Cleanup ==")
  // Restore paused staff; soft-delete fixtures; keep approved run for reconciliation
  for (const id of pausedIds) {
    await adminSb.from("staff").update({ status: "active", deleted_at: null }).eq("id", id)
  }
  for (const id of created.staffIds) await softDeleteStaff(adminSb, id)
  for (const id of created.allowanceIds) {
    await adminSb.from("allowances").update({ deleted_at: new Date().toISOString() }).eq("id", id)
  }
  for (const id of created.deductionIds) {
    await adminSb.from("deductions").update({ deleted_at: new Date().toISOString() }).eq("id", id)
  }
  record("cleanup", "restored paused staff; soft-deleted fixtures", true)
  console.log(`  Preserved approved run for reconciliation: ${runId}`)

  printReport()
}

function printReport() {
  console.log("\n========== PART 2 RESULTS ==========")
  const failed = results.filter((r) => !r.pass)
  const passed = results.filter((r) => r.pass)
  console.log(`Checks passed: ${passed.length}`)
  console.log(`Checks failed: ${failed.length}`)
  if (failed.length) {
    for (const f of failed) console.log(`  - [${f.section}] ${f.name}: ${f.detail}`)
  }

  console.log("\n### Approval metrics")
  console.table(report.approval)

  console.log("\n### Obligation reconciliation")
  console.table(report.obligation)

  console.log("\n### CSV sample (redacted)")
  console.log(JSON.stringify(report.csv.sample, null, 2))

  console.log("\n### Compatibility:", report.csv.compatibility)
  console.log("### Defects:", JSON.stringify(report.defects, null, 2))

  const summaryPath = resolve(REPO_ROOT, "tmp", "gra-paye-part2-summary.json")
  writeFileSync(summaryPath, JSON.stringify({ report, results }, null, 2))
  console.log(`\nWrote ${summaryPath}`)

  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
