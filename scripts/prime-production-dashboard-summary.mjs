#!/usr/bin/env node
/**
 * Prime production service_dashboard_period_summary (Finza Pro: qjxhibvbmzogyzbhswjj).
 * Read-only checks first, then direct service-role upsert (refresh RPC requires auth.uid()).
 *
 *   node scripts/prime-production-dashboard-summary.mjs
 *   node scripts/prime-production-dashboard-summary.mjs --business-id <uuid>
 *   node scripts/prime-production-dashboard-summary.mjs --all
 */
import { config } from "dotenv"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")
const PROD_REF = "qjxhibvbmzogyzbhswjj"
const PERIODS = 12

config({ path: resolve(ROOT, ".env.local") })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url?.includes(PROD_REF) || !key) {
  console.error(`Need production .env.local with ${PROD_REF} and SUPABASE_SERVICE_ROLE_KEY`)
  process.exit(1)
}

const hdrs = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
}

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...hdrs, ...(init.headers || {}) } })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function rpc(name, body) {
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { ok: res.ok, status: res.status, json, text }
}

async function fetchAll(table, select, filter = "") {
  const rows = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const q = `${table}?select=${encodeURIComponent(select)}${filter}&limit=${pageSize}&offset=${offset}`
    const { ok, status, json } = await rest(q)
    if (!ok) throw new Error(`${table} fetch failed: ${status} ${JSON.stringify(json)}`)
    rows.push(...json)
    if (json.length < pageSize) break
    offset += pageSize
  }
  return rows
}

function pickPilotBusinessId(invoices, expenses, payments) {
  const counts = new Map()
  for (const r of invoices) {
    if (!r.business_id) continue
    const c = counts.get(r.business_id) ?? { invoices: 0, expenses: 0, payments: 0 }
    c.invoices++
    counts.set(r.business_id, c)
  }
  for (const r of expenses) {
    if (!r.business_id) continue
    const c = counts.get(r.business_id) ?? { invoices: 0, expenses: 0, payments: 0 }
    c.expenses++
    counts.set(r.business_id, c)
  }
  for (const r of payments) {
    if (!r.business_id) continue
    const c = counts.get(r.business_id) ?? { invoices: 0, expenses: 0, payments: 0 }
    c.payments++
    counts.set(r.business_id, c)
  }
  let best = null
  for (const [id, c] of counts) {
    const score = c.invoices + c.expenses + c.payments
    if (!best || score > best.score) best = { id, score, ...c }
  }
  return best
}

async function sourceCounts(businessId) {
  const [inv, pay, exp] = await Promise.all([
    rest(`invoices?business_id=eq.${businessId}&deleted_at=is.null&select=id`, { headers: { ...hdrs, Prefer: "count=exact", Range: "0-0" } }),
    rest(`payments?business_id=eq.${businessId}&select=id`, { headers: { ...hdrs, Prefer: "count=exact", Range: "0-0" } }),
    rest(`expenses?business_id=eq.${businessId}&deleted_at=is.null&select=id`, { headers: { ...hdrs, Prefer: "count=exact", Range: "0-0" } }),
  ])
  const countHeader = (r) => {
    const m = String(r.text || "").match(/\/(\d+)$/) || r.json
    return Number(r.json?.length ?? 0) || parseInt(r.text?.match?.(/\d+/)?.[0] ?? "0", 10)
  }
  // Prefer content-range from headers - fetch doesn't expose easily; use select count via head
  async function headCount(table, filter) {
    const res = await fetch(`${url}/rest/v1/${table}?${filter}&select=id`, {
      method: "HEAD",
      headers: { ...hdrs, Prefer: "count=exact" },
    })
    const cr = res.headers.get("content-range") || ""
    const m = cr.match(/\/(\d+)$/)
    return m ? parseInt(m[1], 10) : 0
  }
  return {
    invoice_count: await headCount("invoices", `business_id=eq.${businessId}&deleted_at=is.null`),
    payment_count: await headCount("payments", `business_id=eq.${businessId}`),
    expense_count: await headCount("expenses", `business_id=eq.${businessId}&deleted_at=is.null`),
  }
}

async function summaryCount(businessId) {
  const { ok, json } = await rest(
    `service_dashboard_period_summary?business_id=eq.${businessId}&select=period_start`
  )
  if (!ok) return { error: json, count: null }
  return { count: json.length, rows: json }
}

async function fetchAccountingPeriods(businessId, limit = PERIODS) {
  const { ok, status, json } = await rest(
    `accounting_periods?business_id=eq.${businessId}&select=id,period_start,period_end&order=period_start.desc&limit=${limit}`
  )
  if (!ok) throw new Error(`accounting_periods fetch failed: ${status} ${JSON.stringify(json)}`)
  return json
}

async function pnlTotals(businessId, periodStart, periodEnd) {
  const { ok, status, json, text } = await rpc("finza_dashboard_pnl_totals", {
    p_business_id: businessId,
    p_start_date: periodStart,
    p_end_date: periodEnd,
  })
  if (!ok) return { ok: false, status, error: json ?? text }
  const row = Array.isArray(json) ? json[0] : json
  return {
    ok: true,
    revenue: Number(row?.revenue ?? 0),
    expenses: Number(row?.expenses ?? 0),
    net_profit: Number(row?.net_profit ?? 0),
  }
}

/** Service-role upsert path — refresh RPC requires auth.uid() and fails for admin priming. */
async function primeBusinessDirect(businessId) {
  const periods = await fetchAccountingPeriods(businessId)
  if (periods.length === 0) {
    return { ok: false, method: "direct_upsert", error: "no_accounting_periods", primed: 0 }
  }

  const rows = []
  const errors = []
  for (const p of periods) {
    const totals = await pnlTotals(businessId, p.period_start, p.period_end)
    if (!totals.ok) {
      errors.push({ period_id: p.id, ...totals })
      continue
    }
    rows.push({
      business_id: businessId,
      period_id: p.id,
      period_start: p.period_start,
      period_end: p.period_end,
      revenue: totals.revenue,
      expenses: totals.expenses,
      net_profit: totals.net_profit,
      refreshed_at: new Date().toISOString(),
    })
  }

  if (rows.length === 0) {
    return { ok: false, method: "direct_upsert", error: "pnl_totals_failed", errors, primed: 0 }
  }

  const res = await fetch(`${url}/rest/v1/service_dashboard_period_summary?on_conflict=business_id,period_id`, {
    method: "POST",
    headers: {
      ...hdrs,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }

  return {
    ok: res.ok,
    method: "direct_upsert",
    status: res.status,
    primed: res.ok ? rows.length : 0,
    errors: errors.length ? errors : undefined,
    response: res.ok ? undefined : json ?? text,
  }
}

async function primeBusiness(businessId) {
  const before = await summaryCount(businessId)
  const refresh = await primeBusinessDirect(businessId)
  const after = await summaryCount(businessId)
  return { before, refresh, after }
}

async function allBusinessIds() {
  const [invoices, expenses, payments] = await Promise.all([
    fetchAll("invoices", "business_id", "&deleted_at=is.null"),
    fetchAll("expenses", "business_id", "&deleted_at=is.null"),
    fetchAll("payments", "business_id"),
  ])
  const ids = new Set()
  for (const r of [...invoices, ...expenses, ...payments]) {
    if (r.business_id) ids.add(r.business_id)
  }
  return [...ids]
}

async function totalSummaryStats() {
  const rows = await fetchAll("service_dashboard_period_summary", "business_id,period_start,revenue,expenses,net_profit")
  const businesses = new Set(rows.map((r) => r.business_id))
  return { total_summary_rows: rows.length, businesses_with_summary: businesses.size }
}

async function main() {
  const args = process.argv.slice(2)
  const allFlag = args.includes("--all")
  const bidIdx = args.indexOf("--business-id")
  const explicitId = bidIdx >= 0 ? args[bidIdx + 1] : null

  console.log("=== Prime production dashboard period summary ===")
  console.log(`project: ${PROD_REF}`)

  let pilotId = explicitId
  let pilotMeta = null

  if (!pilotId) {
    const [invoices, expenses, payments] = await Promise.all([
      fetchAll("invoices", "business_id", "&deleted_at=is.null"),
      fetchAll("expenses", "business_id", "&deleted_at=is.null"),
      fetchAll("payments", "business_id"),
    ])
    pilotMeta = pickPilotBusinessId(invoices, expenses, payments)
    pilotId = pilotMeta?.id
  }

  if (!pilotId) {
    console.error("No business with source data found.")
    process.exit(1)
  }

  console.log("\n--- Step 2: source counts (pilot) ---")
  console.log("business_id:", pilotId)
  if (pilotMeta) console.log("pilot_rank:", pilotMeta)
  const counts = await sourceCounts(pilotId)
  console.log(counts)

  const beforeAll = await totalSummaryStats()
  console.log("\n--- Global summary before ---")
  console.log(beforeAll)

  const beforePilot = await summaryCount(pilotId)
  console.log("\n--- Pilot summary before ---")
  console.log({ existing_summary_rows: beforePilot.count })

  if (counts.invoice_count + counts.payment_count + counts.expense_count === 0) {
    console.log("Source counts zero — empty chart is correct for this business.")
    process.exit(0)
  }

  console.log("\n--- Step 3: prime pilot ---")
  const pilotResult = await primeBusiness(pilotId)
  console.log(JSON.stringify(pilotResult, null, 2))

  if (!pilotResult.refresh.ok) {
    console.error("Prime failed for pilot business:", pilotResult.refresh)
    process.exit(1)
  }

  const sample = await rest(
    `service_dashboard_period_summary?business_id=eq.${pilotId}&select=period_start,period_end,revenue,expenses,net_profit,refreshed_at&order=period_start.desc&limit=12`
  )
  console.log("\n--- Pilot summary sample (up to 12) ---")
  console.log(sample.json)

  if (allFlag && pilotResult.after.count > 0) {
    console.log("\n--- Step 5: prime all businesses with activity ---")
    const ids = await allBusinessIds()
    let ok = 0
    let fail = 0
    for (const id of ids) {
      if (id === pilotId) continue
      const r = await primeBusinessDirect(id)
      if (r.ok) ok++
      else {
        fail++
        console.warn(`fail ${id}:`, r.error ?? r.response)
      }
    }
    console.log({ primed: ok, failed: fail, total_ids: ids.length })
    const afterAll = await totalSummaryStats()
    console.log("\n--- Global summary after ---")
    console.log(afterAll)
  } else if (allFlag) {
    console.log("Skipping --all because pilot prime did not produce rows.")
  } else {
    console.log("\nPilot complete. Re-test dashboard on app.finza.africa, then run with --all if chart renders.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
