/**
 * Runtime check: PUBLIC_ESTIMATE_COLUMNS + estimate_items select against the DB
 * configured in .env.local (service role). Prints host + HTTP status + error body
 * only (never prints keys or full tokens).
 *
 * Usage:
 *   node scripts/diag-public-quote-columns.mjs
 *   node scripts/diag-public-quote-columns.mjs --token <public_token>
 */
import path from "path"
import { fileURLToPath } from "url"
import { config } from "dotenv"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
config({ path: path.join(root, ".env.local") })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

const PUBLIC_ESTIMATE_COLUMNS_MODERN = [
  "id",
  "business_id",
  "customer_id",
  "estimate_number",
  "issue_date",
  "validity_date",
  "notes",
  "subtotal",
  "subtotal_before_tax",
  "nhil",
  "getfund",
  "covid",
  "vat",
  "total_tax_amount",
  "tax",
  "total_amount",
  "status",
  "tax_lines",
  "currency_code",
  "currency_symbol",
  "public_token",
  "client_name_signed",
  "client_id_type",
  "client_id_number",
  "client_signature",
  "signed_at",
  "rejected_reason",
  "rejected_at",
  "fx_rate",
  "home_currency_code",
  "home_currency_total",
].join(",")

const PUBLIC_ESTIMATE_COLUMNS_LEGACY = [
  "id",
  "business_id",
  "customer_id",
  "estimate_number",
  "issue_date",
  "expiry_date",
  "notes",
  "subtotal",
  "subtotal_before_tax",
  "nhil_amount",
  "getfund_amount",
  "covid_amount",
  "vat_amount",
  "total_tax_amount",
  "tax",
  "total_amount",
  "status",
  "tax_lines",
  "currency_code",
  "currency_symbol",
  "public_token",
  "client_name_signed",
  "client_id_type",
  "client_id_number",
  "client_signature",
  "signed_at",
  "rejected_reason",
  "rejected_at",
  "fx_rate",
  "home_currency_code",
  "home_currency_total",
].join(",")

const ITEM_SELECT = "id, description, quantity, price, total, discount_amount"

function hostOnly(u) {
  try {
    return new URL(u).host
  } catch {
    return "(invalid URL)"
  }
}

async function restSelect(table, label, selectFragment, extraQuery = "") {
  const sel = encodeURIComponent(selectFragment.replace(/\s+/g, " ").trim())
  const href = `${url}/rest/v1/${table}?select=${sel}${extraQuery}`
  const res = await fetch(href, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  })
  const text = await res.text()
  let parsed = text
  try {
    parsed = JSON.parse(text)
  } catch {
    /* keep raw */
  }
  return { label, status: res.status, body: parsed }
}

async function main() {
  const tokenArg = process.argv.find((a) => a === "--token") ? process.argv[process.argv.indexOf("--token") + 1] : null

  if (!url || !key) {
    console.log(JSON.stringify({ error: "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" }))
    process.exit(1)
  }

  const out = {
    supabase_host: hostOnly(url),
    checks: [],
  }

  out.checks.push(await restSelect("estimates", "PUBLIC_ESTIMATE_COLUMNS_MODERN", PUBLIC_ESTIMATE_COLUMNS_MODERN, "&limit=1"))
  out.checks.push(await restSelect("estimates", "PUBLIC_ESTIMATE_COLUMNS_LEGACY", PUBLIC_ESTIMATE_COLUMNS_LEGACY, "&limit=1"))
  out.checks.push(await restSelect("estimate_items", "estimate_items_select_used_in_route", ITEM_SELECT, "&limit=1"))

  const probeCols = ["tax_amount", "discount_amount", "total_tax", "apply_taxes"]
  out.column_probes = []
  for (const c of probeCols) {
    out.column_probes.push(await restSelect("estimates", `estimates_only_${c}`, `id,${c}`, "&limit=1"))
  }

  if (tokenArg && tokenArg.trim()) {
    const tok = tokenArg.trim()
    const tokEnc = encodeURIComponent(tok)
    const safe = { tokenLength: tok.length, tokenPrefix: `${tok.slice(0, 6)}${tok.length > 6 ? "…" : ""}` }
    const rowUrl = `${url}/rest/v1/estimates?select=id,business_id,deleted_at,status,public_token&public_token=eq.${tokEnc}&limit=5`
    const r = await fetch(rowUrl, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    })
    const text = await r.text()
    let rows
    try {
      rows = JSON.parse(text)
    } catch {
      rows = text
    }
    out.token_lookup = { ...safe, status: r.status, rows }
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(String(e?.message || e))
  process.exit(1)
})
