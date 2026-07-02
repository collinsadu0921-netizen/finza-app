/**
 * Staging-only: mint a fresh Supabase session for load-test user when JWT is
 * expired server-side (session_not_found). Does not modify business data.
 *
 *   node scripts/refresh-staging-load-session.mjs
 *   node scripts/refresh-staging-load-session.mjs --probe
 */
import { readFileSync, writeFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "..")
const SESSIONS_PATH = resolve(REPO_ROOT, "load-tests/sessions.staging.json")
const CURL_PATH = resolve(REPO_ROOT, "scripts/service-metrics.curl")

const STAGING_REF = "adonhhtooawkeemdqqeo"
const STAGING_URL = "https://adonhhtooawkeemdqqeo.supabase.co"
const LOAD_EMAIL = "staging@test.com"
const LOAD_BUSINESS_ID = "4e6cdfba-e2ab-4ee4-ac00-9b077d696544"
const PREVIEW_BASE =
  process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1]?.trim() ||
  "https://finza-app-git-staging-collins-projects-f49524b8.vercel.app"

const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNjE2ODAsImV4cCI6MjA5NzczNzY4MH0.gteoKZMizYHZgxbsiFsNfrb-1CI8Mh8Yps5nuX4xjkc"

const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFkb25oaHRvb2F3a2VlbWRxcWVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE2MTY4MCwiZXhwIjoyMDk3NzM3NjgwfQ.kX4ycRl6QBs77Nro5e_uXVj9es75VgYS59XTFvPWFnY"

const probeOnly = process.argv.includes("--probe")

function fail(msg) {
  console.error(`\n[refresh-staging-load-session] ERROR: ${msg}\n`)
  process.exit(1)
}

function assertStagingOnly() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || STAGING_URL
  if (!url.includes(STAGING_REF)) {
    fail(`Refusing: NEXT_PUBLIC_SUPABASE_URL must contain staging ref ${STAGING_REF}`)
  }
  if (url.includes("qjxhibvbmzogyzbhswjj")) {
    fail("Refusing production Supabase ref")
  }
}

function toSbCookie(sessionPayload) {
  const encoded = `base64-${Buffer.from(JSON.stringify(sessionPayload), "utf8").toString("base64url")}`
  return `sb-${STAGING_REF}-auth-token=${encoded}`
}

function preserveVercelCookies(existingCookie) {
  return String(existingCookie || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((part) => {
      const name = part.split("=")[0]?.trim().toLowerCase() || ""
      return (
        name.startsWith("_vercel") ||
        name === "__vercel_toolbar" ||
        name.startsWith("__vercel")
      )
    })
}

async function mintFreshSession() {
  const genRes = await fetch(`${STAGING_URL}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: LOAD_EMAIL }),
  })
  if (!genRes.ok) {
    fail(`generate_link failed: ${genRes.status} ${await genRes.text()}`)
  }
  const link = await genRes.json()
  if (!link.email_otp) {
    fail("generate_link did not return email_otp")
  }

  const verifyRes = await fetch(`${STAGING_URL}/auth/v1/verify`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "email",
      email: LOAD_EMAIL,
      token: link.email_otp,
    }),
  })
  if (!verifyRes.ok) {
    fail(`verify failed: ${verifyRes.status} ${await verifyRes.text()}`)
  }
  const sessionPayload = await verifyRes.json()
  if (!sessionPayload.access_token || !sessionPayload.refresh_token) {
    fail("verify response missing tokens")
  }

  const userRes = await fetch(`${STAGING_URL}/auth/v1/user`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${sessionPayload.access_token}`,
    },
  })
  if (!userRes.ok) {
    fail(`auth/v1/user failed after verify: ${userRes.status} ${await userRes.text()}`)
  }

  return sessionPayload
}

function buildSessionFile(sessionPayload, existingCookie) {
  const vercelParts = preserveVercelCookies(existingCookie)
  const sbPart = toSbCookie(sessionPayload)
  const cookie = [...vercelParts, sbPart].join("; ")
  return [
    {
      label: "staging-load-user-1",
      businessId: LOAD_BUSINESS_ID,
      cookie,
      authorization: `Bearer ${sessionPayload.access_token}`,
    },
  ]
}

function resolveProbeBusinessId(session) {
  const fromSession = String(session?.businessId ?? session?.business_id ?? "").trim()
  if (fromSession) return fromSession
  return LOAD_BUSINESS_ID
}

/** Redacted JWT exp check — never logs token values. */
function sessionAuthExpired(session) {
  const bearer = String(session?.authorization ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!bearer.startsWith("eyJ")) return true
  try {
    const payload = JSON.parse(Buffer.from(bearer.split(".")[1], "base64url").toString("utf8"))
    if (typeof payload.exp !== "number") return true
    return Date.now() >= payload.exp * 1000
  } catch {
    return true
  }
}

function writeMetricsCurl(session) {
  const businessId = resolveProbeBusinessId(session)
  const apiUrl = `${PREVIEW_BASE.replace(/\/$/, "")}/api/dashboard/service-metrics?business_id=${encodeURIComponent(businessId)}`
  const lines = [
    `curl '${apiUrl}' \\`,
    `  -H 'accept: application/json' \\`,
    `  -H 'authorization: ${session.authorization}' \\`,
    `  -b '${session.cookie}'`,
    "",
  ]
  writeFileSync(CURL_PATH, lines.join("\n"), "utf8")
}

async function probeEndpoints(session) {
  if (sessionAuthExpired(session)) {
    fail(
      "Session JWT is missing or expired. Run without --probe to mint a fresh session: " +
        "node scripts/refresh-staging-load-session.mjs"
    )
  }

  const businessId = resolveProbeBusinessId(session)
  const base = PREVIEW_BASE.replace(/\/$/, "")
  const headers = {
    Cookie: session.cookie,
    Accept: "application/json",
    Authorization: session.authorization,
  }
  const urls = [
    `${base}/api/business/profile?business_id=${encodeURIComponent(businessId)}`,
    `${base}/api/dashboard/service-cluster?business_id=${encodeURIComponent(businessId)}&periods=6&activity_limit=10`,
  ]
  for (const url of urls) {
    const res = await fetch(url, { headers })
    const body = await res.text()
    const path = new URL(url).pathname
    console.log(`${path}: ${res.status} ${body.slice(0, 120)}`)
    if (res.status !== 200) {
      fail(`Probe failed for ${path}`)
    }
  }
}

assertStagingOnly()

let existingCookie = ""
if (existsSync(SESSIONS_PATH)) {
  try {
    existingCookie = JSON.parse(readFileSync(SESSIONS_PATH, "utf8"))[0]?.cookie || ""
  } catch {
    existingCookie = ""
  }
}

if (probeOnly) {
  if (!existsSync(SESSIONS_PATH)) fail("sessions.staging.json missing")
  const session = JSON.parse(readFileSync(SESSIONS_PATH, "utf8"))[0]
  await probeEndpoints(session)
  console.log("\n[refresh-staging-load-session] Probes passed.\n")
  process.exit(0)
}

console.log("[refresh-staging-load-session] Minting fresh Supabase session (staging only)...")
const sessionPayload = await mintFreshSession()
const sessions = buildSessionFile(sessionPayload, existingCookie)
writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2) + "\n", "utf8")
writeMetricsCurl(sessions[0])
console.log(`[refresh-staging-load-session] Wrote ${SESSIONS_PATH}`)
console.log(`[refresh-staging-load-session] Wrote ${CURL_PATH}`)
console.log("[refresh-staging-load-session] Probing preview APIs...")
await probeEndpoints(sessions[0])
console.log("\n[refresh-staging-load-session] Done. Session refreshed; probes returned 200 JSON.\n")
