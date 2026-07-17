/**
 * Staging-only GRA DT107A export hardening smoke (project adonhhtooawkeemdqqeo).
 * Isolated load tenant. Does not post remittances.
 *
 *   node scripts/staging-verify-gra-export-hardening.mjs
 *   node scripts/staging-verify-gra-export-hardening.mjs --base-url=http://127.0.0.1:3000
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
const APPROVED_FIXTURE_RUN = "58e466f6-ea99-4f86-a9da-5f5cb7af2be0"
const MARKER = "GRA-Hardening-Smoke"

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

function record(name, pass, detail = "") {
  results.push({ name, pass, detail })
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`)
}

function failFatal(msg) {
  console.error(`\nFATAL: ${msg}\n`)
  process.exit(1)
}

function assertStaging() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || STAGING_URL
  if (url.includes(PRODUCTION_REF)) failFatal("Production credentials detected")
  if (!url.includes(STAGING_REF)) failFatal(`Expected staging ref ${STAGING_REF}, got ${url}`)
  if (!SERVICE_ROLE_KEY || !ANON_KEY) failFatal("Missing staging Supabase keys")
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

function firstCsvDataLine(csv) {
  const body = csv.replace(/^\uFEFF/, "")
  return body.split(/\r?\n/).find((l) => l.trim().length > 0) || ""
}

function parsePayeCol25(csv) {
  const body = csv.replace(/^\uFEFF/, "")
  const lines = body.split(/\r?\n/).filter((l) => l.trim())
  let total = 0
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",")
    if (cols.length < 25) continue
    total += Number(cols[24] || 0)
  }
  return Math.round(total * 100) / 100
}

async function main() {
  console.log("\n=== GRA Export Hardening Smoke ===")
  console.log(`Project: ${STAGING_REF}`)
  console.log(`Business: ${LOAD_BUSINESS_ID}`)
  console.log(`Base URL: ${BASE_URL}`)
  assertStaging()

  const sb = createClient(STAGING_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const session = await mintUserSession()
  const cookie = cookieHeader(session)

  const probe = await api(cookie, "GET", "/api/payroll/runs")
  if (probe.status === 401 || probe.status === 403) {
    failFatal(`API auth failed (${probe.status}). Is next start running with .env.staging?`)
  }
  if ((probe.text || "").startsWith("<!DOCTYPE")) {
    failFatal(`API returned HTML (${probe.status}). Use next start, not turbopack HTML 404.`)
  }

  // 1) Draft export rejected
  let draftId = null
  {
    const { data: drafts } = await sb
      .from("payroll_runs")
      .select("id")
      .eq("business_id", LOAD_BUSINESS_ID)
      .eq("status", "draft")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
    draftId = drafts?.[0]?.id || null
  }
  if (!draftId) {
    const create = await api(cookie, "POST", "/api/payroll/runs", {
      pay_period_start: "2099-04-01",
      pay_period_end: "2099-04-30",
      payroll_frequency: "monthly",
      run_type: "regular",
      notes: MARKER,
    })
    draftId = create.data?.payroll_run?.id || create.data?.id || null
  }
  if (draftId) {
    const draftExport = await api(
      cookie,
      "GET",
      `/api/payroll/runs/${draftId}/exports/gra-dt107a-paye?mode=gra-ready`
    )
    const ok =
      draftExport.status === 400 &&
      String(draftExport.data?.error || "").includes("only after payroll approval")
    record(
      "1. Draft run export rejected",
      ok,
      `${draftExport.status} ${draftExport.data?.error || draftExport.text?.slice(0, 120)}`
    )
  } else {
    record("1. Draft run export rejected", false, "no draft run available")
  }

  const { data: approvedRun, error: runErr } = await sb
    .from("payroll_runs")
    .select("id,status,total_paye,business_id,deleted_at")
    .eq("id", APPROVED_FIXTURE_RUN)
    .single()
  if (runErr || !approvedRun || approvedRun.business_id !== LOAD_BUSINESS_ID) {
    failFatal(`Approved fixture missing: ${runErr?.message || "not found"}`)
  }
  if (approvedRun.deleted_at) failFatal("Approved fixture is soft-deleted")
  if (approvedRun.status !== "approved" && approvedRun.status !== "locked") {
    failFatal(`Fixture status is ${approvedRun.status}`)
  }

  const { data: entries } = await sb
    .from("payroll_entries")
    .select(
      "id,staff_id,is_included,paye,filing_tin,filing_employee_name,payroll_tax_profile,staff:staff_id(id,name,tin_number)"
    )
    .eq("payroll_run_id", APPROVED_FIXTURE_RUN)
  const included = (entries || []).filter((e) => e.is_included !== false)
  if (!included.length) failFatal("Fixture has no included entries")

  // 2) Approved export
  const readyExport = await apiBinary(
    cookie,
    `/api/payroll/runs/${APPROVED_FIXTURE_RUN}/exports/gra-dt107a-paye?mode=gra-ready`
  )
  record("2. Approved run export succeeds", readyExport.status === 200, `status=${readyExport.status}`)
  const csv1 = readyExport.text || ""
  mkdirSync(resolve(REPO_ROOT, "tmp"), { recursive: true })
  writeFileSync(resolve(REPO_ROOT, "tmp", "gra-hardening-gra-ready.csv"), csv1)

  // 6) Clean header
  const first = firstCsvDataLine(csv1)
  record(
    "6. Clean CSV starts with official GRA header",
    first.startsWith("(3) TIN") && !csv1.includes("Pay run metadata") && !csv1.includes("Pay Period Label"),
    first.slice(0, 80)
  )

  // 7) PAYE totals
  const csvPaye = parsePayeCol25(csv1)
  const runPaye = Math.round(Number(approvedRun.total_paye) * 100) / 100
  const { data: oblig } = await sb
    .from("payroll_obligations")
    .select("amount_due")
    .eq("payroll_run_id", APPROVED_FIXTURE_RUN)
    .eq("obligation_type", "paye_gra")
    .maybeSingle()
  const obligPaye = Math.round(Number(oblig?.amount_due || 0) * 100) / 100
  record(
    "7. Clean CSV PAYE matches payroll and obligation",
    csvPaye === runPaye && csvPaye === obligPaye,
    `csv=${csvPaye} run=${runPaye} oblig=${obligPaye}`
  )

  // 3/4 Exclude one employee (restore after)
  const target = included[0]
  const tinBackup = {
    is_included: target.is_included,
    filing_tin: target.filing_tin,
    payroll_tax_profile: target.payroll_tax_profile,
  }
  const { error: exclErr } = await sb
    .from("payroll_entries")
    .update({
      is_included: false,
      filing_tin: null,
      payroll_tax_profile: {
        ...(target.payroll_tax_profile && typeof target.payroll_tax_profile === "object"
          ? target.payroll_tax_profile
          : {}),
        gra_position_code: null,
      },
    })
    .eq("id", target.id)

  if (exclErr) {
    record("3. Excluded employee absent", false, exclErr.message)
    record("4. Excluded employee with missing TIN does not block export", false, "skipped")
  } else {
    const exclExport = await apiBinary(
      cookie,
      `/api/payroll/runs/${APPROVED_FIXTURE_RUN}/exports/gra-dt107a-paye?mode=gra-ready`
    )
    const name = target.filing_employee_name || target.staff?.name || ""
    const emptyOk =
      exclExport.status === 400 &&
      String(exclExport.text || "").includes("No included employees")
    // JSON error body for apiBinary? It returns text — try parse
    let errMsg = ""
    try {
      errMsg = JSON.parse(exclExport.text || "{}").error || ""
    } catch {
      errMsg = exclExport.text || ""
    }
    const emptyOk2 = exclExport.status === 400 && /No included employees/i.test(errMsg)
    const absent =
      exclExport.status === 200 &&
      (!name || !exclExport.text.includes(name)) &&
      !(target.filing_tin && exclExport.text.includes(String(target.filing_tin)))
    record(
      "3. Excluded employee absent",
      absent || emptyOk || emptyOk2,
      `${exclExport.status}`
    )
    record(
      "4. Excluded employee with missing TIN does not block export",
      exclExport.status === 200 || emptyOk || emptyOk2,
      `${exclExport.status} ${String(errMsg).slice(0, 100)}`
    )

    await sb
      .from("payroll_entries")
      .update({
        is_included: tinBackup.is_included ?? true,
        filing_tin: tinBackup.filing_tin,
        payroll_tax_profile: tinBackup.payroll_tax_profile,
      })
      .eq("id", target.id)
  }

  // 5) Included missing TIN blocks
  const readyEntry = included[0]
  const backupTin = readyEntry.filing_tin
  const staffId = readyEntry.staff_id
  const { data: staffBeforeTin } = await sb
    .from("staff")
    .select("tin_number")
    .eq("id", staffId)
    .single()
  await sb.from("payroll_entries").update({ filing_tin: null }).eq("id", readyEntry.id)
  await sb.from("staff").update({ tin_number: null }).eq("id", staffId)
  const blockExport = await api(
    cookie,
    "GET",
    `/api/payroll/runs/${APPROVED_FIXTURE_RUN}/exports/gra-dt107a-paye?mode=gra-ready`
  )
  const blocked =
    blockExport.status === 400 && /TIN|tin/i.test(String(blockExport.data?.error || blockExport.text || ""))
  record(
    "5. Included employee with missing TIN blocks export",
    blocked,
    `${blockExport.status} ${String(blockExport.data?.error || "").slice(0, 140)}`
  )
  await sb.from("payroll_entries").update({ filing_tin: backupTin }).eq("id", readyEntry.id)
  await sb
    .from("staff")
    .update({ tin_number: staffBeforeTin?.tin_number ?? null })
    .eq("id", staffId)

  // 8) Snapshot stability
  const exportBefore = await apiBinary(
    cookie,
    `/api/payroll/runs/${APPROVED_FIXTURE_RUN}/exports/gra-dt107a-paye?mode=gra-ready`
  )
  const beforeCsv = exportBefore.text || ""
  const { data: staffBefore } = await sb
    .from("staff")
    .select("name,tin_number,gra_position_code")
    .eq("id", staffId)
    .single()
  const mutatedName = `${MARKER}-${randomUUID().slice(0, 8)}`
  await sb
    .from("staff")
    .update({ name: mutatedName, tin_number: "Z9999999999", gra_position_code: "OTHR" })
    .eq("id", staffId)
  const exportAfter = await apiBinary(
    cookie,
    `/api/payroll/runs/${APPROVED_FIXTURE_RUN}/exports/gra-dt107a-paye?mode=gra-ready`
  )
  const afterCsv = exportAfter.text || ""
  record(
    "8. Regenerated approved export unchanged after staff edits",
    beforeCsv === afterCsv && !afterCsv.includes(mutatedName),
    `beforeLen=${beforeCsv.length} afterLen=${afterCsv.length}`
  )
  if (staffBefore) {
    await sb
      .from("staff")
      .update({
        name: staffBefore.name,
        tin_number: staffBefore.tin_number,
        gra_position_code: staffBefore.gra_position_code,
      })
      .eq("id", staffId)
  }

  // 9/10 UX
  const pageSrc = readFileSync(resolve(REPO_ROOT, "app/payroll/[id]/page.tsx"), "utf8")
  record(
    "9. Remittance UI says Record GRA remittance",
    pageSrc.includes("Record GRA remittance") && !pageSrc.includes("Pay GRA PAYE"),
    ""
  )
  record(
    "10. Guidance: filing/payment outside Finza",
    pageSrc.includes("File and pay through the GRA portal first") &&
      pageSrc.includes("Use the GRA-ready DT 107A CSV for portal filing") &&
      pageSrc.includes("Keep the GRA acknowledgement"),
    ""
  )

  const passed = results.filter((r) => r.pass).length
  const failed = results.filter((r) => !r.pass).length
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed / ${results.length} ===\n`)
  if (failed) process.exit(2)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
