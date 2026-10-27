#!/usr/bin/env node
/**
 * Non-destructive Vercel authentication check.
 *
 * Validates the repository VERCEL_TOKEN against the CLI and the exact
 * production project/team. Never deploys, never prints the token, and never
 * echoes raw CLI stderr.
 *
 * Usage:
 *   VERCEL_TOKEN=... node scripts/verify-vercel-auth.mjs
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { PRODUCTION, VERCEL_CLI_VERSION } = require("./lib/productionReleaseGuards.cjs")

const token = (process.env.VERCEL_TOKEN || "").trim()
if (!token) {
  console.error("Vercel authentication check failed: VERCEL_TOKEN is not set.")
  process.exit(2)
}

const childEnv = {
  ...process.env,
  VERCEL_TOKEN: token,
  VERCEL_ORG_ID: PRODUCTION.teamId,
  VERCEL_PROJECT_ID: PRODUCTION.projectId,
}

function vercel(args) {
  return spawnSync("npx", ["--yes", `vercel@${VERCEL_CLI_VERSION}`, ...args], {
    env: childEnv,
    encoding: "utf8",
    shell: true,
    timeout: 60000,
  })
}

function failureReason(result) {
  const text = `${result.stdout || ""}\n${result.stderr || ""}`.toLowerCase()
  if (/not valid|user not found|not able to load user|unauthorized|\b401\b/.test(text)) {
    return "invalid or expired"
  }
  if (/not authorized|forbidden|\b403\b/.test(text)) {
    return "not authorized for the production team/project"
  }
  if (/enotfound|econn|network|timeout/.test(text)) {
    return "unable to reach Vercel"
  }
  return "rejected by the Vercel CLI"
}

const whoami = vercel(["whoami"])
if (whoami.status !== 0) {
  console.error(`Vercel authentication failed: VERCEL_TOKEN is ${failureReason(whoami)}.`)
  process.exit(1)
}

const user =
  String(whoami.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() || "unknown"

const projectResult = vercel([
  "api",
  `/v9/projects/${encodeURIComponent(PRODUCTION.projectId)}?teamId=${encodeURIComponent(PRODUCTION.teamId)}`,
])
if (projectResult.status !== 0) {
  console.error(
    `Vercel authentication failed: the token authenticated as ${user} but is ${failureReason(projectResult)}.`,
  )
  process.exit(1)
}

const raw = String(projectResult.stdout || "")
const start = raw.indexOf("{")
let project = null
try {
  project = JSON.parse(start >= 0 ? raw.slice(start) : raw)
} catch {
  project = null
}

if (
  !project ||
  project.id !== PRODUCTION.projectId ||
  project.name !== PRODUCTION.projectName
) {
  console.error(
    "Vercel authentication failed: token does not resolve the expected production project.",
  )
  process.exit(1)
}

console.log(
  `Vercel authentication OK: user=${user} project=${project.name} team=${PRODUCTION.teamId}`,
)
