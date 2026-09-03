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
  const matches = [...text.matchAll(/\[([a-z]{3}\d+)\]/gi)].map((m) => m[1].toLowerCase())
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

const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const OPAQUE_IDENTITY_PATH = "/auth/v1/admin/users?page=1&per_page=1"

function classifyServiceRoleCredential(value) {
  if (typeof value !== "string" || !value.trim()) return "missing"
  const key = value.trim()
  if (JWT_RE.test(key)) return "jwt"
  if (/^sb_secret_/.test(key) || /^sb_service_/.test(key)) return "secret"
  return "malformed"
}

const detectSupabaseCredentialFormat = classifyServiceRoleCredential

function decodeJwtPayloadJson(token) {
  const parts = String(token || "").split(".")
  if (parts.length !== 3) return null
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8")
    const payload = JSON.parse(json)
    return payload && typeof payload === "object" ? payload : null
  } catch {
    return null
  }
}

function decodeSupabaseServiceRoleJwtIdentity(key) {
  const format = classifyServiceRoleCredential(key)
  if (format !== "jwt") {
    fail("SERVICE_ROLE_UNVERIFIED", "Production SUPABASE_SERVICE_ROLE_KEY is not a JWT")
  }
  const payload = decodeJwtPayloadJson(key)
  if (!payload) fail("SERVICE_ROLE_UNVERIFIED", "Production SUPABASE_SERVICE_ROLE_KEY is malformed")
  return {
    ref: typeof payload.ref === "string" ? payload.ref.trim().toLowerCase() : "",
    role: typeof payload.role === "string" ? payload.role.trim() : "",
  }
}

const decodeServiceRoleJwtClaims = decodeSupabaseServiceRoleJwtIdentity

function assertLegacyServiceRoleClaims(claims) {
  if (!claims || typeof claims !== "object") {
    fail("SERVICE_ROLE_UNVERIFIED", "Production service-role credential has no identity claims")
  }
  const ref = typeof claims.ref === "string" ? claims.ref.trim().toLowerCase() : ""
  const role = typeof claims.role === "string" ? claims.role.trim() : ""
  if (!ref) fail("SERVICE_ROLE_UNVERIFIED", "Production service-role credential has no project ref")
  if (ref === PRODUCTION.forbiddenSupabaseRef) {
    fail("STAGING_ENV", "Production service-role credential belongs to the staging Supabase project")
  }
  if (ref !== PRODUCTION.supabaseRef) {
    fail("SERVICE_ROLE_MISMATCH", "Production service-role credential is not the production Supabase project")
  }
  if (!role) fail("SERVICE_ROLE_UNVERIFIED", "Production service-role credential has no role claim")
  if (role !== "service_role") {
    fail("SERVICE_ROLE_UNVERIFIED", "Production credential is not a service-role key")
  }
  return { ref, role }
}

function buildOpaqueSecretIdentityRequest(url) {
  assertSupabaseIdentity(url)
  return {
    method: "GET",
    url: `https://${PRODUCTION.supabaseRef}.supabase.co${OPAQUE_IDENTITY_PATH}`,
    headers: { Accept: "application/json" },
  }
}

function evaluateOpaqueSecretVerifierStatus(status) {
  if (status === 200) return { accepted: true }
  if (status === 401 || status === 403) return { accepted: false, reason: "rejected" }
  return { accepted: false, reason: "unverifiable" }
}

function assertOpaqueSecretProof(proof) {
  if (!proof || proof.accepted !== true) {
    fail(
      "SERVICE_ROLE_UNVERIFIED",
      "Production service-role credential could not be verified against the production project",
    )
  }
  const ref = typeof proof.projectRef === "string" ? proof.projectRef.trim().toLowerCase() : ""
  if (!ref) {
    fail("SERVICE_ROLE_UNVERIFIED", "Opaque service-role identity proof has no project ref")
  }
  if (ref === PRODUCTION.forbiddenSupabaseRef) {
    fail("STAGING_ENV", "Production service-role credential belongs to the staging Supabase project")
  }
  if (ref !== PRODUCTION.supabaseRef) {
    fail("SERVICE_ROLE_MISMATCH", "Production service-role credential is not the production Supabase project")
  }
  return { ref, role: "service_role" }
}

function extractProductionSupabaseEnv(parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {}
  const url = typeof source.NEXT_PUBLIC_SUPABASE_URL === "string" ? source.NEXT_PUBLIC_SUPABASE_URL.trim() : ""
  const serviceRoleKey =
    typeof source.SUPABASE_SERVICE_ROLE_KEY === "string" ? source.SUPABASE_SERVICE_ROLE_KEY.trim() : ""
  return { url, serviceRoleKey }
}

function redactCredentialFragments(text) {
  if (typeof text !== "string") return ""
  return text
    .replace(/sb_secret_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/sb_service_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
}

function toSafeReleaseFailure(error) {
  if (error && typeof error === "object") {
    const deployReason =
      error.code === "DEPLOY_FAILURE"
        ? classifyDeployFailureText(`${error.stdout || ""}\n${error.stderr || ""}`)
        : null
    error.stdout = ""
    error.stderr = ""
    delete error.stdout
    delete error.stderr
    if (deployReason) error.deployReason = deployReason
  }
  const safe = {
    ok: false,
    code: error && error.code ? error.code : "RELEASE_FAILED",
    message: redactCredentialFragments(error && error.message ? error.message : "Release failed"),
  }
  if (error && typeof error === "object" && typeof error.stage === "string" && error.stage) {
    safe.stage = error.stage
  }
  if (error && typeof error === "object" && Number.isInteger(error.exitCode)) {
    safe.exitCode = error.exitCode
  }
  if (error && typeof error === "object" && typeof error.deployReason === "string" && error.deployReason) {
    safe.deployReason = error.deployReason
  }
  return safe
}

/**
 * URL and service-role must both identify the production Supabase project.
 * Never include the credential in thrown messages.
 * Opaque `sb_secret_` keys require an injected read-only proof; this helper stays network-free.
 */
function assertProductionSupabasePair(url, serviceRoleKey, options) {
  assertSupabaseIdentity(url)
  if (typeof serviceRoleKey !== "string" || !serviceRoleKey.trim()) {
    fail("SERVICE_ROLE_ENV_UNVERIFIED", "Could not securely read production SUPABASE_SERVICE_ROLE_KEY")
  }

  const format = classifyServiceRoleCredential(serviceRoleKey)
  if (format === "missing") {
    fail("SERVICE_ROLE_ENV_UNVERIFIED", "Could not securely read production SUPABASE_SERVICE_ROLE_KEY")
  }
  if (format === "malformed") {
    fail("SERVICE_ROLE_UNVERIFIED", "Production SUPABASE_SERVICE_ROLE_KEY is malformed")
  }

  const urlRef = extractSupabaseRef(url)
  const opts = options && typeof options === "object" ? options : {}

  if (format === "secret") {
    const identity = assertOpaqueSecretProof(opts.opaqueProof)
    if (urlRef !== identity.ref) {
      fail("SERVICE_ROLE_MISMATCH", "Production Supabase URL and service-role credential are not the same project")
    }
    return { format: "secret", ref: identity.ref, role: identity.role }
  }

  const claims = assertLegacyServiceRoleClaims(decodeSupabaseServiceRoleJwtIdentity(serviceRoleKey))
  if (urlRef !== claims.ref) {
    fail("SERVICE_ROLE_MISMATCH", "Production Supabase URL and service-role credential are not the same project")
  }
  return { format: "jwt", ref: claims.ref, role: claims.role }
}

const assertSupabaseServiceCredentialIdentity = assertProductionSupabasePair

/** Public build commit placeholder path used by CLI production releases. */
const BUILD_COMMIT_GENERATED_RELATIVE = "lib/server/buildCommit.generated.ts"

function buildDeployArgs(sha) {
  const expected = assertExpectedSha(sha)
  return [
    "deploy",
    "--prod",
    "--yes",
    "--regions",
    PRODUCTION.region,
    "--project",
    PRODUCTION.projectName,
    "--meta",
    `gitCommitSha=${expected}`,
  ]
}

function buildCommitGeneratedSource(sha) {
  if (sha == null) {
    return [
      "/**",
      " * Placeholder overwritten by scripts/release-production.mjs immediately before a",
      " * CLI production deploy, then restored. Git-connected builds leave this null and",
      " * use VERCEL_GIT_COMMIT_SHA instead.",
      " */",
      "export const FINZA_BUILD_COMMIT_SHA: string | null = null",
      "",
    ].join("\n")
  }
  const expected = assertExpectedSha(sha)
  return [
    "/** Generated by scripts/release-production.mjs for this CLI production deploy. */",
    `export const FINZA_BUILD_COMMIT_SHA: string | null = ${JSON.stringify(expected)}`,
    "",
  ].join("\n")
}

/**
 * Map discarded vercel deploy stderr to a small reason class. Never returns raw text.
 */
function classifyDeployFailureText(text) {
  const raw = typeof text === "string" ? text : ""
  const lower = raw.toLowerCase()
  if (!lower.trim()) return "unknown"
  if (/not logged|login required|no existing credentials|token.*invalid|unauthorized|401/.test(lower)) {
    return "auth"
  }
  if (/forbidden|403|permission|access denied/.test(lower)) return "forbidden"
  if (/isn't linked|not linked|project.*not found|404/.test(lower)) return "project_unlinked"
  if (/build-env|environment variable|--env/.test(lower)) return "env_flags"
  if (/dirty|git/.test(lower) && /worktree|working directory/.test(lower)) return "dirty_tree"
  if (/timeout|etimedout|network/.test(lower)) return "network"
  return "unknown"
}

/**
 * Prefer API env reads when VERCEL_TOKEN is present (GitHub Actions).
 * Local interactive releases keep using `vercel env pull`.
 */
function preferHostedProductionEnvApi(env) {
  const source = env && typeof env === "object" ? env : process.env
  return typeof source.VERCEL_TOKEN === "string" && source.VERCEL_TOKEN.trim().length > 0
}

function isProductionScopedEnv(entry) {
  if (!entry || typeof entry !== "object") return false
  const targets = Array.isArray(entry.target) ? entry.target : [entry.target]
  if (!targets.includes("production")) return false
  return !entry.gitBranch
}

/**
 * Validate a decrypted Production env listing entry without retaining the value
 * in thrown messages. Returns { key, value } or throws SERVICE_ROLE_ENV_UNVERIFIED /
 * ENV_UNVERIFIED with stage metadata.
 */
function selectDecryptedProductionEnvValue(listing, key) {
  const envs = listing && Array.isArray(listing.envs) ? listing.envs : null
  if (!envs) {
    const error = new ReleaseGuardError(
      "SERVICE_ROLE_ENV_UNVERIFIED",
      "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
    )
    error.stage = "API_ENV_LISTING_INVALID"
    throw error
  }
  const matches = envs.filter((entry) => entry && entry.key === key && isProductionScopedEnv(entry))
  if (matches.length !== 1 || !matches[0].id) {
    const error = new ReleaseGuardError(
      key === "NEXT_PUBLIC_SUPABASE_URL" ? "ENV_UNVERIFIED" : "SERVICE_ROLE_ENV_UNVERIFIED",
      key === "NEXT_PUBLIC_SUPABASE_URL"
        ? "Production Supabase URL could not be read"
        : "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
    )
    error.stage = "API_ENV_KEY_MISSING_OR_AMBIGUOUS"
    error.hasUrl = key === "NEXT_PUBLIC_SUPABASE_URL" ? false : null
    error.hasServiceRoleKey = key === "SUPABASE_SERVICE_ROLE_KEY" ? false : null
    throw error
  }
  return { id: matches[0].id, key }
}

function assertDecryptedProductionEnvValue(key, value) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) {
    const error = new ReleaseGuardError(
      key === "NEXT_PUBLIC_SUPABASE_URL" ? "ENV_UNVERIFIED" : "SERVICE_ROLE_ENV_UNVERIFIED",
      key === "NEXT_PUBLIC_SUPABASE_URL"
        ? "Production Supabase URL could not be read"
        : "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
    )
    error.stage = "API_ENV_VALUE_ABSENT_OR_EMPTY"
    error.hasUrl = key === "NEXT_PUBLIC_SUPABASE_URL" ? false : true
    error.hasServiceRoleKey = key === "SUPABASE_SERVICE_ROLE_KEY" ? false : true
    error.serviceRoleKeyNonEmpty = key === "SUPABASE_SERVICE_ROLE_KEY" ? false : null
    throw error
  }
  return value.trim()
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
  assertProductionSupabasePair,
  assertSupabaseServiceCredentialIdentity,
  classifyServiceRoleCredential,
  detectSupabaseCredentialFormat,
  decodeServiceRoleJwtClaims,
  decodeSupabaseServiceRoleJwtIdentity,
  assertLegacyServiceRoleClaims,
  buildOpaqueSecretIdentityRequest,
  evaluateOpaqueSecretVerifierStatus,
  assertOpaqueSecretProof,
  extractProductionSupabaseEnv,
  redactCredentialFragments,
  toSafeReleaseFailure,
  extractSupabaseRef,
  buildDeployArgs,
  parseDeployedSha,
  assertCleanWorktree,
  preferHostedProductionEnvApi,
  isProductionScopedEnv,
  selectDecryptedProductionEnvValue,
  assertDecryptedProductionEnvValue,
  buildCommitGeneratedSource,
  BUILD_COMMIT_GENERATED_RELATIVE,
  classifyDeployFailureText,
  aliasNames,
}
