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

function isPlaceholderSession(entry, index) {
  const label = entry.label || `sessions[${index}]`
  const cookie = String(entry.cookie || "").trim()
  const businessId = String(entry.businessId || "").trim()

  if (!cookie) {
    throw new Error(
      `${label}: cookie is empty. Use real staging cookies in ./sessions.staging.json ` +
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

  if (!cookie.includes("=")) {
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
  console.log("[finza-k6] ── starting traffic ──")
  return { scenario: selectedScenario, sessions: sessions.length }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sessionForVu(vu) {
  return sessions[(vu - 1) % sessions.length]
}

function authHeaders(session) {
  return {
    headers: {
      Cookie: session.cookie,
      Accept: "application/json",
    },
    tags: { business_id: session.businessId },
  }
}

function getJson(name, url, session, fieldChecks) {
  const res = http.get(url, {
    ...authHeaders(session),
    tags: { name },
  })

  const ok = check(res, {
    [`${name} status 200`]: (r) => r.status === 200,
    [`${name} has body`]: (r) => r.body && r.body.length > 0,
    [`${name} under soft limit`]: (r) => r.timings.duration < SOFT_P95_MS,
  })

  if (ok && fieldChecks && res.status === 200) {
    try {
      const body = res.json()
      check(body, fieldChecks)
    } catch {
      check(null, { [`${name} valid json`]: () => false })
    }
  }

  return res
}

// ── Main flow ───────────────────────────────────────────────────────────────

export function workdayFlow() {
  const session = sessionForVu(__VU)
  const bid = session.businessId

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

  group("dashboard", function () {
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

    getJson(
      "dashboard_timeline",
      `${BASE_URL}/api/dashboard/service-timeline?business_id=${bid}&periods=6`,
      session,
      {
        "timeline is array": (b) => Array.isArray(b.timeline),
      }
    )

    getJson(
      "dashboard_activity",
      `${BASE_URL}/api/dashboard/service-activity?business_id=${bid}&limit=10`,
      session,
      {
        "activity has items": (b) => Array.isArray(b.items),
      }
    )
  })

  group("invoices", function () {
    getJson(
      "invoices_list",
      `${BASE_URL}/api/invoices/list?business_id=${bid}&page=1&limit=25`,
      session,
      {
        "invoices array": (b) => Array.isArray(b.invoices),
        "invoices pagination": (b) => b.pagination && typeof b.pagination.totalCount === "number",
        "invoices page size bounded": (b) => (b.invoices || []).length <= 25,
      }
    )

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
  })

  group("bills", function () {
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

    getJson(
      "bills_list_default_bounded",
      `${BASE_URL}/api/bills/list?business_id=${bid}`,
      session,
      {
        "bills default pagination": (b) => b.pagination && b.pagination.limit <= 100,
        "bills default bounded": (b) => (b.bills || []).length <= 100,
      }
    )
  })

  group("payroll", function () {
    getJson("payroll_runs", `${BASE_URL}/api/payroll/runs`, session, {
      "payroll runs array": (b) => Array.isArray(b.runs),
    })
  })

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

  if (selectedScenario !== "smoke") {
    sleep(1 + Math.random() * 3)
  }
}
