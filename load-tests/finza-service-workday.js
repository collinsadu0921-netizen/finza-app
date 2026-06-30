/**
 * Finza service-workday load test (k6)
 *
 * Simulates Ghana SME service workspace API traffic during a workday.
 * Exactly ONE scenario runs per invocation — set SCENARIO (never rely on CLI --scenario).
 *
 * Paths in SESSIONS_JSON are relative to this file (load-tests/), e.g.:
 *   -e SESSIONS_JSON=./sessions.staging.json
 *
 * Windows (k6 not on PATH):
 *   $env:SCENARIO="smoke"
 *   & "C:\Program Files\k6\k6.exe" run `
 *     -e BASE_URL="https://your-staging-url.com" `
 *     -e SESSIONS_JSON="./sessions.staging.json" `
 *     load-tests/finza-service-workday.js
 *
 * Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
 */

import http from "k6/http"
import encoding from "k6/encoding"
import { check, group, sleep } from "k6"
import { SharedArray } from "k6/data"

// ── Scenario selection (exactly one per run) ────────────────────────────────

const ALLOWED_SCENARIOS = ["smoke", "workday_50", "workday_100", "workday_200", "stress_500"]

const selectedScenario = (__ENV.SCENARIO || "smoke").trim()

if (!ALLOWED_SCENARIOS.includes(selectedScenario)) {
  throw new Error(
    `Invalid SCENARIO="${selectedScenario}". Allowed: ${ALLOWED_SCENARIOS.join(", ")}. ` +
      `Example: $env:SCENARIO="smoke" or -e SCENARIO=smoke`
  )
}

// ── Config (override via -e) ────────────────────────────────────────────────

if (!__ENV.BASE_URL || !String(__ENV.BASE_URL).trim()) {
  throw new Error(
    "BASE_URL is required. Pass -e BASE_URL=https://your-staging-url.com " +
      "(paths in SESSIONS_JSON are relative to load-tests/finza-service-workday.js)"
  )
}

const BASE_URL = String(__ENV.BASE_URL).trim().replace(/\/$/, "")

/** Relative to this script file (load-tests/). Do NOT prefix with load-tests/. */
const SESSIONS_PATH = __ENV.SESSIONS_JSON || "./sessions.example.json"

/** Per-request soft limit for check() warnings (ms). Scenario thresholds are primary. */
const SOFT_P95_MS = Number(__ENV.SOFT_P95_MS || "10000")

/** Log route/status/content-type/body preview when res.json() fails (no cookies/tokens). */
const DEBUG_JSON_FAILURE =
  String(__ENV.DEBUG_JSON_FAILURE || "").trim() === "1" ||
  String(__ENV.DEBUG_JSON_FAILURE || "").toLowerCase() === "true"

/**
 * Isolate route groups under load (default: all). Does not affect auth validation.
 * Examples: all | business_profile | dashboard_metrics | dashboard | reports | lists |
 *           invoices | bills | payroll
 */
const ROUTE_FILTER = String(__ENV.ROUTE_FILTER || "all").trim().toLowerCase()

const ALLOWED_ROUTE_FILTERS = new Set([
  "all",
  "business_profile",
  "dashboard_metrics",
  "dashboard",
  "reports",
  "lists",
  "invoices",
  "bills",
  "payroll",
])

if (!ALLOWED_ROUTE_FILTERS.has(ROUTE_FILTER)) {
  throw new Error(
    `Invalid ROUTE_FILTER="${ROUTE_FILTER}". Allowed: ${[...ALLOWED_ROUTE_FILTERS].join(", ")}`
  )
}

/** When 1, skip reports_pnl in workday scenarios (not when ROUTE_FILTER=reports). */
const WORKDAY_SKIP_REPORTS =
  String(__ENV.WORKDAY_SKIP_REPORTS || "").trim() === "1" ||
  String(__ENV.WORKDAY_SKIP_REPORTS || "").toLowerCase() === "true"

const ROUTE_FILTER_GROUPS = {
  business_profile: new Set(["business_profile"]),
  dashboard_metrics: new Set(["dashboard_metrics"]),
  dashboard: new Set(["dashboard_metrics", "dashboard_timeline", "dashboard_activity"]),
  reports: new Set(["reports_pnl"]),
  lists: new Set([
    "invoices_list",
    "invoices_overdue",
    "bills_list_paginated",
    "bills_list_default_bounded",
    "payroll_runs",
  ]),
  invoices: new Set(["invoices_list", "invoices_overdue"]),
  bills: new Set(["bills_list_paginated", "bills_list_default_bounded"]),
  payroll: new Set(["payroll_runs"]),
}

function shouldRunRoute(routeName) {
  if (ROUTE_FILTER === "all") return true
  const group = ROUTE_FILTER_GROUPS[ROUTE_FILTER]
  if (!group) return false
  return group.has(routeName)
}

function shouldRunReportsPnl() {
  if (ROUTE_FILTER === "reports") return true
  if (ROUTE_FILTER !== "all") return false
  if (selectedScenario === "smoke") return true
  if (WORKDAY_SKIP_REPORTS) return false
  return true
}

/** Vercel Deployment Protection bypass (Preview only). Never logged. */
const VERCEL_AUTOMATION_BYPASS_SECRET = String(
  __ENV.VERCEL_AUTOMATION_BYPASS_SECRET || ""
).trim()
const VERCEL_BYPASS_ENABLED = VERCEL_AUTOMATION_BYPASS_SECRET.length > 0

/** Staging Supabase project ref (for optional sb-* SSR cookie synthesis from JWT). */
const STAGING_SUPABASE_REF = String(__ENV.STAGING_SUPABASE_REF || "adonhhtooawkeemdqqeo").trim()

/** Minimum authorization token length (real Supabase JWTs are much longer). */
const MIN_AUTH_TOKEN_LEN = 80

const PLACEHOLDER_COOKIE_MARKERS = [
  "your-project-ref",
  "base64-json-cookie-value",
  "base64value",
]

const PLACEHOLDER_BUSINESS_IDS = new Set([
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000000",
])

function isExampleSessionsPath(path) {
  const normalized = path.replace(/\\/g, "/")
  return (
    normalized.endsWith("sessions.example.json") ||
    normalized.endsWith("/sessions.example.json")
  )
}

/** Cookie header sent on requests — session.cookie is passed through unchanged. */
function rawCookieHeader(session) {
  if (Array.isArray(session.cookies) && session.cookies.length > 0) {
    return session.cookies
      .map((c) => {
        const name = String(c.name || "").trim()
        const value = String(c.value ?? "")
        if (!name) return ""
        return `${name}=${value}`
      })
      .filter(Boolean)
      .join("; ")
  }
  return String(session.cookie ?? "")
}

/** Parse `authorization=Bearer <token>` from a Cookie header value. Never logged. */
function bearerAuthorizationFromCookie(cookie) {
  if (!cookie) return null
  const parts = String(cookie).split(";")
  for (const part of parts) {
    const trimmed = part.trim()
    const eq = trimmed.indexOf("=")
    if (eq < 0) continue
    const name = trimmed.slice(0, eq).trim()
    if (name.toLowerCase() !== "authorization") continue
    let value = trimmed.slice(eq + 1).trim()
    try {
      value = decodeURIComponent(value)
    } catch {
      // keep raw value
    }
    if (!value) return null
    if (/^bearer\s+/i.test(value)) return value
    return `Bearer ${value}`
  }
  return null
}

function resolveAuthorizationHeader(session, cookieHeader) {
  const fromField = String(session.authorization || "").trim()
  if (fromField) {
    let value = fromField
    try {
      value = decodeURIComponent(value)
    } catch {
      // keep raw
    }
    return /^bearer\s+/i.test(value) ? value : `Bearer ${value}`
  }
  return bearerAuthorizationFromCookie(cookieHeader || rawCookieHeader(session))
}

function authorizationTokenValue(session, cookieHeader) {
  const bearer = resolveAuthorizationHeader(session, cookieHeader)
  if (!bearer) return ""
  return bearer.replace(/^Bearer\s+/i, "").trim()
}

function hasSupabaseSsrAuthCookie(cookieHeader) {
  return /sb-[a-z0-9]+-auth-token(\.\d+)?=/i.test(String(cookieHeader || ""))
}

function toBase64UrlJson(obj) {
  return `base64-${encoding.b64encode(JSON.stringify(obj), "rawurl")}`
}

function jwtPayload(token) {
  const parts = String(token).split(".")
  if (parts.length < 2) return null
  try {
    return JSON.parse(encoding.b64decode(parts[1], "rawurl", "s"))
  } catch {
    return null
  }
}

function supabaseSessionFromAccessToken(token) {
  const claims = jwtPayload(token)
  const expiresAt =
    typeof claims?.exp === "number"
      ? claims.exp
      : Math.floor(Date.now() / 1000) + 3600
  const user = claims
    ? {
        id: claims.sub,
        aud: claims.aud,
        role: claims.role,
        email: claims.email,
        phone: claims.phone || "",
        app_metadata: claims.app_metadata || {},
        user_metadata: claims.user_metadata || {},
        created_at: claims.iat
          ? new Date(claims.iat * 1000).toISOString()
          : new Date().toISOString(),
      }
    : undefined
  return {
    access_token: token,
    refresh_token: token,
    expires_in: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
    expires_at: expiresAt,
    token_type: "bearer",
    ...(user ? { user } : {}),
  }
}

/**
 * Finza API routes use @supabase/ssr cookie storage (sb-<ref>-auth-token).
 * If the browser only sends authorization=<JWT>, synthesize the SSR cookie for k6.
 * Original authorization= entry in Cookie is preserved.
 */
function augmentCookieForSupabaseSsr(session, cookieHeader) {
  if (hasSupabaseSsrAuthCookie(cookieHeader)) return cookieHeader
  const token = authorizationTokenValue(session, cookieHeader)
  if (!token || !token.startsWith("eyJ")) return cookieHeader
  const chunk = `sb-${STAGING_SUPABASE_REF}-auth-token=${toBase64UrlJson(
    supabaseSessionFromAccessToken(token)
  )}`
  return cookieHeader ? `${cookieHeader}; ${chunk}` : chunk
}

function validateSessionAuth(session, index) {
  const label = session.label || `sessions[${index}]`
  const cookieHeader = rawCookieHeader(session)

  if (!cookieHeader && !String(session.authorization || "").trim()) {
    throw new Error(
      `${label}: missing auth. Paste browser cURL Cookie header into session.cookie ` +
        `(authorization=Bearer … or authorization=<token>), or use ` +
        `node scripts/k6-import-curl-session.mjs --curl-file=...`
    )
  }

  const bearer = resolveAuthorizationHeader(session, cookieHeader)
  if (!bearer && !hasSupabaseSsrAuthCookie(cookieHeader)) {
    throw new Error(
      `${label}: no usable auth. Need authorization=… cookie, Authorization header, ` +
        `or sb-${STAGING_SUPABASE_REF}-auth-token in session.cookie.`
    )
  }

  const tokenLen = authorizationTokenValue(session, cookieHeader).length
  if (
    tokenLen > 0 &&
    tokenLen < MIN_AUTH_TOKEN_LEN &&
    !hasSupabaseSsrAuthCookie(cookieHeader)
  ) {
    throw new Error(
      `${label}: authorization token looks truncated (${tokenLen} chars). ` +
        `Recapture full Cookie from DevTools → Network → Copy as cURL. ` +
        `Real Supabase JWTs are typically 200+ characters and start with eyJ.`
    )
  }

  return { cookieHeader, authMode: "authorization-cookie", tokenLen }
}

function isPlaceholderSession(entry, index) {
  const label = entry.label || `sessions[${index}]`
  const rawCookie = rawCookieHeader(entry)
  const authField = String(entry.authorization || "").trim()
  const cookie = rawCookie || authField
  const businessId = String(entry.businessId || "").trim()

  if (!cookie) {
    throw new Error(
      `${label}: cookie/cookies missing. Use real staging cookies in ./sessions.staging.json ` +
        `(paths relative to load-tests/finza-service-workday.js).`
    )
  }

  if (!businessId) {
    throw new Error(`${label}: businessId is required.`)
  }

  if (PLACEHOLDER_BUSINESS_IDS.has(businessId)) {
    return true
  }

  const cookieLower = cookie.toLowerCase()
  for (const marker of PLACEHOLDER_COOKIE_MARKERS) {
    if (cookieLower.includes(marker.toLowerCase())) {
      return true
    }
  }

  if (rawCookie && !rawCookie.includes("=")) {
    return true
  }

  return false
}

function validateSessionsFile(path, entries) {
  if (isExampleSessionsPath(path)) {
    throw new Error(
      `Refusing to run with example sessions file "${path}". ` +
        `Copy load-tests/sessions.example.json → load-tests/sessions.staging.json, ` +
        `fill real cookies, then pass -e SESSIONS_JSON=./sessions.staging.json ` +
        `(path is relative to load-tests/finza-service-workday.js, not the repo root).`
    )
  }

  for (let i = 0; i < entries.length; i++) {
    if (isPlaceholderSession(entries[i], i)) {
      const label = entries[i].label || `sessions[${i}]`
      throw new Error(
        `${label}: session looks like placeholder/example data. ` +
          `Use real staging cookies in ./sessions.staging.json — ` +
          `running with sessions.example.json is not a valid smoke test.`
      )
    }
    validateSessionAuth(entries[i], i)
  }
}

const sessions = new SharedArray("sessions", function () {
  let raw
  try {
    raw = open(SESSIONS_PATH)
  } catch (err) {
    throw new Error(
      `Could not read SESSIONS_JSON="${SESSIONS_PATH}" (relative to load-tests/finza-service-workday.js). ` +
        `Use ./sessions.staging.json, not ./load-tests/sessions.staging.json. ` +
        `Original error: ${err}`
    )
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`SESSIONS_JSON must be valid JSON: ${SESSIONS_PATH}`)
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`SESSIONS_JSON must be a non-empty array: ${SESSIONS_PATH}`)
  }

  validateSessionsFile(SESSIONS_PATH, parsed)

  console.log(`[finza-k6] Loaded ${parsed.length} session(s) from ${SESSIONS_PATH}`)
  return parsed
})

// ── Scenario definitions (only selectedScenario is exported in options) ───────

const scenarioDefinitions = {
  smoke: {
    executor: "shared-iterations",
    vus: 1,
    iterations: 1,
    maxDuration: "2m",
    exec: "workdayFlow",
  },
  workday_50: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "2m", target: 50 },
      { duration: "5m", target: 50 },
      { duration: "2m", target: 0 },
    ],
    gracefulRampDown: "30s",
    exec: "workdayFlow",
  },
  workday_100: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "3m", target: 100 },
      { duration: "5m", target: 100 },
      { duration: "2m", target: 0 },
    ],
    gracefulRampDown: "45s",
    exec: "workdayFlow",
  },
  workday_200: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "5m", target: 200 },
      { duration: "10m", target: 200 },
      { duration: "3m", target: 0 },
    ],
    gracefulRampDown: "60s",
    exec: "workdayFlow",
  },
  stress_500: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "5m", target: 500 },
      { duration: "5m", target: 500 },
      { duration: "2m", target: 0 },
    ],
    gracefulRampDown: "60s",
    exec: "workdayFlow",
  },
}

const defaultThresholds = {
  http_req_failed: ["rate<0.01"],
  "http_req_duration{name:dashboard_metrics}": ["p(95)<8000"],
  "http_req_duration{name:dashboard_timeline}": ["p(95)<15000"],
  "http_req_duration{name:invoices_overdue}": ["p(95)<5000"],
  "http_req_duration{name:reports_pnl}": ["p(95)<10000"],
}

const thresholdsByScenario = {
  smoke: {
    ...defaultThresholds,
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<5000"],
  },
  workday_50: {
    ...defaultThresholds,
    http_req_duration: ["p(95)<2000"],
  },
  workday_100: {
    ...defaultThresholds,
    http_req_duration: ["p(95)<3000"],
  },
  workday_200: {
    ...defaultThresholds,
    http_req_duration: ["p(95)<5000"],
  },
  stress_500: {
    ...defaultThresholds,
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<8000"],
  },
}

export const options = {
  scenarios: {
    [selectedScenario]: scenarioDefinitions[selectedScenario],
  },
  thresholds: thresholdsByScenario[selectedScenario] || defaultThresholds,
}

export function setup() {
  console.log("[finza-k6] ── harness startup ──")
  console.log(`[finza-k6]   scenario:       ${selectedScenario}`)
  console.log(`[finza-k6]   BASE_URL:         ${BASE_URL}`)
  console.log(`[finza-k6]   SESSIONS_JSON:    ${SESSIONS_PATH}`)
  console.log(`[finza-k6]   sessions loaded:  ${sessions.length}`)
  console.log(
    `[finza-k6]   peak VUs (approx): ${
      selectedScenario === "smoke"
        ? 1
        : selectedScenario === "workday_50"
          ? 50
          : selectedScenario === "workday_100"
            ? 100
            : selectedScenario === "workday_200"
              ? 200
              : 500
    }`
  )
  console.log(
    `[finza-k6]   Vercel bypass:    ${VERCEL_BYPASS_ENABLED ? "enabled" : "disabled"}`
  )
  console.log(`[finza-k6]   ROUTE_FILTER:     ${ROUTE_FILTER}`)
  console.log(
    `[finza-k6]   skip reports:     ${WORKDAY_SKIP_REPORTS && selectedScenario !== "smoke" && ROUTE_FILTER === "all" ? "yes (WORKDAY_SKIP_REPORTS)" : "no"}`
  )
  console.log("[finza-k6]   auth mode:        authorization-cookie")
  const rawCookie = rawCookieHeader(sessions[0])
  const tokenLen = authorizationTokenValue(sessions[0], rawCookie).length
  console.log(
    `[finza-k6]   auth token chars: ${tokenLen || "(sb cookie / header only)"}`
  )
  console.log(
    `[finza-k6]   sb SSR cookie:    ${hasSupabaseSsrAuthCookie(rawCookie) ? "present" : "synthesized-if-JWT"}`
  )
  console.log("[finza-k6] ── starting traffic ──")
  return { scenario: selectedScenario, sessions: sessions.length }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sessionForVu(vu) {
  return sessions[(vu - 1) % sessions.length]
}

function authHeaders(session) {
  const rawCookie = rawCookieHeader(session)
  const cookieHeader = augmentCookieForSupabaseSsr(session, rawCookie)
  const headers = {
    Cookie: cookieHeader,
    Accept: "application/json",
  }
  const bearerAuth = resolveAuthorizationHeader(session, rawCookie)
  if (bearerAuth) {
    headers.Authorization = bearerAuth
  }
  if (session.headers && typeof session.headers === "object") {
    for (const key of Object.keys(session.headers)) {
      const lower = key.toLowerCase()
      if (lower === "cookie" || lower === "authorization" || lower === "x-vercel-protection-bypass") {
        continue
      }
      headers[key] = String(session.headers[key])
    }
  }
  if (VERCEL_BYPASS_ENABLED) {
    headers["x-vercel-protection-bypass"] = VERCEL_AUTOMATION_BYPASS_SECRET
  }
  return {
    headers,
    tags: { business_id: session.businessId },
  }
}

function redactBodyPreview(body) {
  if (body == null) return ""
  let text = String(body)
  if (VERCEL_BYPASS_ENABLED) {
    text = text.split(VERCEL_AUTOMATION_BYPASS_SECRET).join("[REDACTED]")
  }
  text = text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
  text = text.replace(/(Cookie:\s*)[^\n]*/gi, "$1[REDACTED]")
  text = text.replace(/(Authorization:\s*)[^\n]*/gi, "$1[REDACTED]")
  text = text.replace(/(sb-[a-z0-9]+-auth-token(?:\.\d+)?=)[^;\s]*/gi, "$1[REDACTED]")
  text = text.replace(/(authorization=)[^;\s]*/gi, "$1[REDACTED]")
  text = text.replace(/(auth-token=)[^;\s]*/gi, "$1[REDACTED]")
  text = text.replace(/(access_token["']?\s*:\s*["'])[^"']+/gi, "$1[REDACTED]")
  text = text.replace(/(refresh_token["']?\s*:\s*["'])[^"']+/gi, "$1[REDACTED]")
  text = text.replace(
    /(x-vercel-protection-bypass["']?\s*[:=]\s*["']?)[^"'\s;]+/gi,
    "$1[REDACTED]"
  )
  return text.slice(0, 300)
}

function logJsonParseFailure(name, res) {
  if (!DEBUG_JSON_FAILURE) return
  const contentType =
    res.headers["Content-Type"] || res.headers["content-type"] || "(none)"
  console.log(
    `[finza-k6] JSON_PARSE_FAIL route=${name} status=${res.status} content-type=${contentType} body_preview=${JSON.stringify(redactBodyPreview(res.body))}`
  )
}

function logNon200Response(name, res) {
  if (!DEBUG_JSON_FAILURE) return
  const contentType =
    res.headers["Content-Type"] || res.headers["content-type"] || "(none)"
  const preview = JSON.stringify(redactBodyPreview(res.body))
  console.log(
    `[finza-k6] HTTP_FAIL route=${name} status=${res.status} content-type=${contentType} body_preview=${preview}`
  )
}

function getJson(name, url, session, fieldChecks) {
  const res = http.get(url, {
    ...authHeaders(session),
    tags: { name },
  })

  if (res.status !== 200) {
    logNon200Response(name, res)
  }

  const ok = check(res, {
    [`${name} status 200`]: (r) => r.status === 200,
    [`${name} has body`]: (r) => r.body && r.body.length > 0,
    [`${name} under soft limit`]: (r) => r.timings.duration < SOFT_P95_MS,
  })

  if (fieldChecks && res.status === 200) {
    try {
      const body = res.json()
      check(body, fieldChecks)
    } catch {
      logJsonParseFailure(name, res)
      check(null, { [`${name} valid json`]: () => false })
    }
  }

  return res
}

// ── Main flow ───────────────────────────────────────────────────────────────

export function workdayFlow() {
  const session = sessionForVu(__VU)
  const bid = session.businessId

  if (shouldRunRoute("business_profile")) {
    group("business_session", function () {
      getJson(
        "business_profile",
        `${BASE_URL}/api/business/profile?business_id=${bid}`,
        session,
        {
          "profile has business.id": (b) => b && b.business && b.business.id === bid,
        }
      )
    })
  }

  if (
    shouldRunRoute("dashboard_metrics") ||
    shouldRunRoute("dashboard_timeline") ||
    shouldRunRoute("dashboard_activity")
  ) {
    group("dashboard", function () {
      if (shouldRunRoute("dashboard_metrics")) {
        getJson(
          "dashboard_metrics",
          `${BASE_URL}/api/dashboard/service-metrics?business_id=${bid}`,
          session,
          {
            "metrics has revenue": (b) => typeof b.revenue === "number",
            "metrics has cashCollected": (b) => typeof b.cashCollected === "number",
            "metrics has period": (b) => b.period != null,
          }
        )
      }

      if (shouldRunRoute("dashboard_timeline")) {
        getJson(
          "dashboard_timeline",
          `${BASE_URL}/api/dashboard/service-timeline?business_id=${bid}&periods=6`,
          session,
          {
            "timeline is array": (b) => Array.isArray(b.timeline),
          }
        )
      }

      if (shouldRunRoute("dashboard_activity")) {
        getJson(
          "dashboard_activity",
          `${BASE_URL}/api/dashboard/service-activity?business_id=${bid}&limit=10`,
          session,
          {
            "activity has items": (b) => Array.isArray(b.items),
          }
        )
      }
    })
  }

  if (shouldRunRoute("invoices_list") || shouldRunRoute("invoices_overdue")) {
    group("invoices", function () {
      if (shouldRunRoute("invoices_list")) {
        getJson(
          "invoices_list",
          `${BASE_URL}/api/invoices/list?business_id=${bid}&page=1&limit=25`,
          session,
          {
            "invoices array": (b) => Array.isArray(b.invoices),
            "invoices pagination": (b) =>
              b.pagination && typeof b.pagination.totalCount === "number",
            "invoices page size bounded": (b) => (b.invoices || []).length <= 25,
          }
        )
      }

      if (shouldRunRoute("invoices_overdue")) {
        getJson(
          "invoices_overdue",
          `${BASE_URL}/api/invoices/list?business_id=${bid}&status=overdue&page=1&limit=25`,
          session,
          {
            "overdue array": (b) => Array.isArray(b.invoices),
            "overdue bounded": (b) => (b.invoices || []).length <= 25,
            "overdue pagination": (b) => b.pagination && b.pagination.pageSize === 25,
          }
        )
      }
    })
  }

  if (shouldRunRoute("bills_list_paginated") || shouldRunRoute("bills_list_default_bounded")) {
    group("bills", function () {
      if (shouldRunRoute("bills_list_paginated")) {
        getJson(
          "bills_list_paginated",
          `${BASE_URL}/api/bills/list?business_id=${bid}&page=1&limit=50`,
          session,
          {
            "bills array": (b) => Array.isArray(b.bills),
            "bills pagination limit 50": (b) =>
              b.pagination && b.pagination.limit === 50 && (b.bills || []).length <= 50,
          }
        )
      }

      if (shouldRunRoute("bills_list_default_bounded")) {
        getJson(
          "bills_list_default_bounded",
          `${BASE_URL}/api/bills/list?business_id=${bid}`,
          session,
          {
            "bills default pagination": (b) => b.pagination && b.pagination.limit <= 100,
            "bills default bounded": (b) => (b.bills || []).length <= 100,
          }
        )
      }
    })
  }

  if (shouldRunRoute("payroll_runs")) {
    group("payroll", function () {
      getJson("payroll_runs", `${BASE_URL}/api/payroll/runs`, session, {
        "payroll runs array": (b) => Array.isArray(b.runs),
      })
    })
  }

  if (shouldRunReportsPnl()) {
    group("reports", function () {
      getJson(
        "reports_pnl",
        `${BASE_URL}/api/accounting/reports/profit-and-loss?business_id=${bid}`,
        session,
        {
          "pnl has sections or period": (b) => b.sections != null || b.period != null,
        }
      )
    })
  }

  if (selectedScenario !== "smoke") {
    sleep(1 + Math.random() * 3)
  }
}
