/**
 * Build load-tests/sessions.staging.json from a browser "Copy as cURL" (local only).
 * Does not print cookie values or tokens.
 *
 *   node scripts/k6-import-curl-session.mjs --business-id=<uuid> --curl-file=./my-request.curl
 *   node scripts/k6-import-curl-session.mjs --business-id=<uuid> --curl-stdin   # paste cURL, then Ctrl+Z Enter
 *
 * Refuses production hosts (app.finza.africa).
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createInterface } from "readline"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const OUT_PATH = resolve(REPO_ROOT, "load-tests/sessions.staging.json")

const PRODUCTION_HOSTS = ["app.finza.africa", "finza.africa", "www.finza.africa"]
const STAGING_PREVIEW_HOST = "finza-dht9279hv-collins-projects-f49524b8.vercel.app"
const STAGING_SUPABASE_REF = "adonhhtooawkeemdqqeo"

const businessId =
  process.argv.find((a) => a.startsWith("--business-id="))?.split("=")[1]?.trim() ||
  "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"

const curlFile = process.argv.find((a) => a.startsWith("--curl-file="))?.split("=")[1]
const curlStdin = process.argv.includes("--curl-stdin")

function fail(msg) {
  console.error(`\n[k6-import-curl] ERROR: ${msg}\n`)
  process.exit(1)
}

async function readCurlText() {
  if (curlFile) {
    const p = resolve(process.cwd(), curlFile)
    if (!existsSync(p)) fail(`File not found: ${p}`)
    return readFileSync(p, "utf8")
  }
  if (curlStdin) {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    const lines = []
    for await (const line of rl) lines.push(line)
    return lines.join("\n")
  }
  fail("Pass --curl-file=path or --curl-stdin")
}

function extractUrl(curl) {
  const m = curl.match(/curl\s+'([^']+)'|curl\s+"([^"]+)"|curl\s+(\S+)/)
  const url = m?.[1] || m?.[2] || m?.[3]
  if (!url) fail("Could not parse URL from cURL")
  return url
}

function extractHeaders(curl) {
  const headers = {}
  const re = /(?:-H|--header)\s+'([^']+)'|(?:-H|--header)\s+"([^"]+)"/g
  let m
  while ((m = re.exec(curl)) !== null) {
    const line = m[1] || m[2]
    const i = line.indexOf(":")
    if (i < 0) continue
    const name = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    headers[name.toLowerCase()] = value
  }
  const cookieFlag = curl.match(/(?:-b|--cookie)\s+'([^']+)'|(?:-b|--cookie)\s+"([^"]+)"/)
  if (cookieFlag) {
    headers.cookie = cookieFlag[1] || cookieFlag[2]
  }
  return headers
}

function cookieNames(cookieHeader) {
  if (!cookieHeader) return []
  return cookieHeader
    .split(";")
    .map((p) => p.trim().split("=")[0])
    .filter(Boolean)
}

function authSummary(headers) {
  const cookie = headers.cookie || ""
  const names = cookieNames(cookie)
  const hasAuthCookie = names.some((n) => n.toLowerCase() === "authorization")
  const hasSb = names.some((n) => /^sb-[a-z0-9]+-auth-token(\.\d+)?$/i.test(n))
  const hasAuthHdr = Boolean(headers.authorization)
  return { names, hasAuthCookie, hasSb, hasAuthHdr }
}

const curl = await readCurlText()
const url = extractUrl(curl)
let host
try {
  host = new URL(url).hostname
} catch {
  fail("Invalid URL in cURL")
}

if (PRODUCTION_HOSTS.includes(host)) {
  fail(`Refusing production host: ${host}`)
}

if (host.includes("qjxhibvbmzogyzbhswjj")) {
  fail("Refusing production Supabase host")
}

const headers = extractHeaders(curl)
let cookie = headers.cookie || ""
const authHeader = headers.authorization || ""

if (!cookie && !authHeader) {
  fail("cURL has no Cookie (-b) or Authorization (-H) header")
}

// Supabase REST cURL: Authorization Bearer JWT only → mirror as authorization= cookie for k6 preview.
if (!cookie && authHeader) {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim()
  cookie = `authorization=${encodeURIComponent(authHeader.startsWith("Bearer") ? authHeader : `Bearer ${token}`)}`
}

const summary = authSummary({ cookie, authorization: authHeader })
console.log(`\n[k6-import-curl] URL host: ${host}`)
console.log(`[k6-import-curl] Cookie names: ${summary.names.join(", ") || "(none)"}`)
console.log(`[k6-import-curl] authorization cookie: ${summary.hasAuthCookie ? "yes" : "no"}`)
console.log(`[k6-import-curl] sb-*-auth-token: ${summary.hasSb ? "yes" : "no"}`)
console.log(`[k6-import-curl] Authorization header: ${summary.hasAuthHdr ? "yes" : "no"}`)

const isPreview = host === STAGING_PREVIEW_HOST || host.endsWith(".vercel.app")
const isStagingSupabase =
  host === `${STAGING_SUPABASE_REF}.supabase.co` ||
  host.endsWith(`.${STAGING_SUPABASE_REF}.supabase.co`)

if (!isPreview && !isStagingSupabase) {
  console.warn(`[k6-import-curl] WARN: unexpected host (expected preview or staging Supabase)`)
}

const session = {
  label: "staging-load-user-1",
  businessId,
  cookie,
}

if (authHeader) {
  session.authorization = authHeader.startsWith("Bearer") ? authHeader : `Bearer ${authHeader}`
}

const out = [session]
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8")
console.log(`[k6-import-curl] Wrote ${OUT_PATH} (values not printed)\n`)
