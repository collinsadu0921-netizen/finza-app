/**
 * Fail-closed production release invariants for Finza.
 * Pure helpers — no network, no credentials, no side effects.
 */

const PRODUCTION = {
  projectName: "finza-app",
  projectId: "prj_BxbfIgXTl1PAX6W3635Nsc8KXuW1",
  teamId: "team_oWPGv9x9bpRD2nRmUM2lKpzJ",
  region: "arn1",
  forbiddenRegion: "iad1",
  domain: "app.finza.africa",
  supabaseRef: "qjxhibvbmzogyzbhswjj",
  forbiddenSupabaseRef: "adonhhtooawkeemdqqeo",
  emergencyIad1RollbackDeployment: "dpl_Co9VhCdhSCG98iRYrDx9WefwRquS",
  crons: [
    { path: "/api/cron/accounting-snapshots", schedule: "0 2 * * *" },
    { path: "/api/cron/service-subscription-lifecycle", schedule: "0 8 * * *" },
    { path: "/api/cron/trial-growth-lifecycle", schedule: "0 9 * * *" },
  ],
}

class ReleaseGuardError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "ReleaseGuardError"
    this.code = code
  }
}

function fail(code, message) {
  throw new ReleaseGuardError(code, message)
}

function normalizeSha(value) {
  if (typeof value !== "string") return ""
  return value.trim().toLowerCase()
}

function assertExpectedSha(sha) {
  const normalized = normalizeSha(sha)
  if (!normalized) fail("MISSING_SHA", "EXPECTED_SHA is missing")
  if (!/^[a-f0-9]{40}$/.test(normalized)) {
    fail("MISSING_SHA", "EXPECTED_SHA must be a full 40-character git SHA")
  }
  return normalized
}

function assertShaMatch(expected, actual) {
  const want = assertExpectedSha(expected)
  const got = normalizeSha(actual)
  if (!got) fail("SHA_MISMATCH", "Deployed SHA is missing")
  if (got !== want) {
    fail("SHA_MISMATCH", `Deployed SHA ${got} does not match EXPECTED_SHA ${want}`)
  }
}

function assertProject(project) {
  if (!project) fail("WRONG_PROJECT", "Vercel project is missing")
  if (project.id !== PRODUCTION.projectId || project.name !== PRODUCTION.projectName) {
    fail(
      "WRONG_PROJECT",
      `Refusing to release through ${project.name || "unknown"} (${project.id || "no-id"})`,
    )
  }
}

function assertProductionTarget(target) {
  if (target !== "production") {
    fail("WRONG_TARGET", `Deployment target must be production, got ${target || "missing"}`)
  }
}

function assertReady(state) {
  if (!state) fail("NOT_READY", "Deployment status is missing")
  if (String(state).toUpperCase() !== "READY") {
    fail("NOT_READY", `Deployment is not READY (${state})`)
  }
}

function uniqueRegions(values) {
  return [...new Set((values || []).filter(Boolean).map((v) => String(v).trim().toLowerCase()))]
}

function assertRegion(actual) {
  const regions = uniqueRegions(Array.isArray(actual) ? actual : actual == null ? [] : [actual])
  if (!regions.length) fail("UNKNOWN_REGION", "Runtime region could not be determined")
  if (regions.includes(PRODUCTION.forbiddenRegion)) {
    fail("IAD1_REGION", "Production runtime is iad1")
  }
  if (regions.length !== 1 || regions[0] !== PRODUCTION.region) {
    fail("WRONG_REGION", `Production runtime must be arn1, got ${regions.join(",")}`)
  }
}

function assertProjectDefaultRegion(project) {
  const defaults = uniqueRegions([
    project && project.serverlessFunctionRegion,
    ...((project && project.functionDefaultRegions) || []),
    ...((project && project.resourceFunctionRegions) || []),
  ])
  if (!defaults.length) fail("UNKNOWN_REGION", "Project default region could not be determined")
  if (defaults.includes(PRODUCTION.forbiddenRegion) || defaults.some((r) => r !== PRODUCTION.region)) {
    fail(
      "IAD1_REGION",
      `Project default region must be arn1 before a production release, got ${defaults.join(",")}`,
    )
  }
}

function parseInspectFunctionRegions(text) {
  if (typeof text !== "string" || !text.trim()) return []
  const matches = [...text.matchAll(/\[([a-z0-9]+)\]/gi)].map((m) => m[1].toLowerCase())
  return uniqueRegions(matches)
}

function parseXVercelIdRegion(header) {
  if (typeof header !== "string" || !header.trim()) return null
  const parts = header.split("::").map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  return parts[1].toLowerCase()
}

function aliasNames(aliases) {
  return (aliases || [])
    .map((entry) => {
      if (typeof entry === "string") return entry
      if (!entry || typeof entry !== "object") return ""
      return entry.alias || entry.domain || entry.host || ""
    })
    .map((value) =>
      String(value)
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "")
        .toLowerCase(),
    )
    .filter(Boolean)
}

function assertAlias(aliases, deploymentId, productionTargetId) {
  if (!deploymentId) fail("MISSING_DEPLOYMENT", "Deployment id is missing")
  const names = aliasNames(aliases)
  if (!names.includes(PRODUCTION.domain)) {
    fail("ALIAS_MISMATCH", `Deployment is not aliased to ${PRODUCTION.domain}`)
  }
  if (productionTargetId && productionTargetId !== deploymentId) {
    fail(
      "ALIAS_MISMATCH",
      `app.finza.africa production target is ${productionTargetId}, not ${deploymentId}`,
    )
  }
}

function cronKey(entry) {
  return `${entry.path}|${entry.schedule}`
}

function assertCrons(definitions) {
  if (!Array.isArray(definitions)) fail("CRON_MISMATCH", "Cron definitions are missing")
  if (definitions.length !== PRODUCTION.crons.length) {
    fail("CRON_MISMATCH", `Expected exactly ${PRODUCTION.crons.length} production crons`)
  }
  const got = definitions.map(cronKey).sort()
  const expected = PRODUCTION.crons.map(cronKey).sort()
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    fail("CRON_MISMATCH", "Production cron definitions do not match the required set")
  }
}

function extractSupabaseRef(value) {
  if (typeof value !== "string" || !value.trim()) return null
  const match = value.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)
  if (match) return match[1].toLowerCase()
  const loose = value.match(/\b([a-z]{20})\b/i)
  return loose ? loose[1].toLowerCase() : null
}

function assertSupabaseIdentity(url) {
  if (typeof url !== "string" || !url.trim()) {
    fail("ENV_UNVERIFIED", "Production Supabase URL could not be read")
  }
  if (url.includes(PRODUCTION.forbiddenSupabaseRef)) {
    fail("STAGING_ENV", "Production environment resolved to the staging Supabase project")
  }
  if (!url.includes(PRODUCTION.supabaseRef)) {
    fail("SUPABASE_MISMATCH", "Production environment is not the production Supabase project")
  }
}

function buildDeployArgs(sha) {
  const expected = assertExpectedSha(sha)
  return [
    "deploy",
    "--prod",
    "--yes",
    "--regions",
    PRODUCTION.region,
    "--meta",
    `gitCommitSha=${expected}`,
  ]
}

function parseDeployedSha(deployment) {
  if (!deployment) return ""
  const meta = deployment.meta || {}
  return (
    meta.gitCommitSha ||
    meta.githubCommitSha ||
    deployment.metaGitCommitSha ||
    ""
  )
}

function assertCleanWorktree(porcelain) {
  if (typeof porcelain !== "string") fail("DIRTY_WORKTREE", "Worktree status could not be read")
  if (porcelain.trim()) fail("DIRTY_WORKTREE", "Production release requires a clean worktree")
}

module.exports = {
  PRODUCTION,
  ReleaseGuardError,
  assertExpectedSha,
  assertShaMatch,
  assertProject,
  assertProductionTarget,
  assertReady,
  assertRegion,
  assertProjectDefaultRegion,
  parseInspectFunctionRegions,
  parseXVercelIdRegion,
  assertAlias,
  assertCrons,
  assertSupabaseIdentity,
  extractSupabaseRef,
  buildDeployArgs,
  parseDeployedSha,
  assertCleanWorktree,
  aliasNames,
}
