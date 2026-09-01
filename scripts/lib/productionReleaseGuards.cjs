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
    error.stdout = ""
    error.stderr = ""
    delete error.stdout
    delete error.stderr
  }
  const safe = {
    ok: false,
    code: error && error.code ? error.code : "RELEASE_FAILED",
    message: redactCredentialFragments(error && error.message ? error.message : "Release failed"),
  }
  const diagnostic = toSafeEnvPullDiagnostic(error)
  if (diagnostic) Object.assign(safe, diagnostic)
  return safe
}

function sanitizeToolVersion(value) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!/^[v0-9][A-Za-z0-9.+_-]{0,40}$/.test(trimmed)) return null
  return trimmed
}

function sanitizeToolVersions(versions) {
  if (!versions || typeof versions !== "object") return null
  const node = sanitizeToolVersion(versions.node)
  const npm = sanitizeToolVersion(versions.npm)
  const vercel = sanitizeToolVersion(versions.vercel)
  if (!node && !npm && !vercel) return null
  return { node, npm, vercel }
}

function envPullDiagnosticError(stage, extras) {
  const error = new ReleaseGuardError(
    "SERVICE_ROLE_ENV_UNVERIFIED",
    "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
  )
  error.stage = stage
  const source = extras && typeof extras === "object" ? extras : {}
  error.exitCode = Number.isInteger(source.exitCode) ? source.exitCode : null
  error.signal = typeof source.signal === "string" && source.signal ? source.signal : null
  error.exportFileExists = typeof source.exportFileExists === "boolean" ? source.exportFileExists : null
  error.hasUrl = typeof source.hasUrl === "boolean" ? source.hasUrl : null
  error.hasServiceRoleKey = typeof source.hasServiceRoleKey === "boolean" ? source.hasServiceRoleKey : null
  error.serviceRoleKeyNonEmpty =
    typeof source.serviceRoleKeyNonEmpty === "boolean" ? source.serviceRoleKeyNonEmpty : null
  const versions = sanitizeToolVersions(source.versions)
  if (versions) error.versions = versions
  return error
}

function toSafeEnvPullDiagnostic(error) {
  if (!error || typeof error !== "object" || typeof error.stage !== "string" || !error.stage) return null
  return {
    stage: error.stage,
    exitCode: Number.isInteger(error.exitCode) ? error.exitCode : null,
    signal: typeof error.signal === "string" && error.signal ? error.signal : null,
    exportFileExists: typeof error.exportFileExists === "boolean" ? error.exportFileExists : null,
    hasUrl: typeof error.hasUrl === "boolean" ? error.hasUrl : null,
    hasServiceRoleKey: typeof error.hasServiceRoleKey === "boolean" ? error.hasServiceRoleKey : null,
    serviceRoleKeyNonEmpty:
      typeof error.serviceRoleKeyNonEmpty === "boolean" ? error.serviceRoleKeyNonEmpty : null,
    versions: sanitizeToolVersions(error.versions),
  }
}

function diagnoseSecretSafeChild(result) {
  const source = result && typeof result === "object" ? result : {}
  if (source.started !== true) {
    return { ok: false, stage: "CHILD_SPAWN_FAILED", exitCode: null, signal: null }
  }
  const signal = typeof source.signal === "string" && source.signal ? source.signal : null
  const exitCode = Number.isInteger(source.exitCode) ? source.exitCode : source.exitCode === 0 ? 0 : null
  if (signal || exitCode !== 0) {
    return { ok: false, stage: "ENV_PULL_NONZERO", exitCode, signal }
  }
  return { ok: true, stage: null, exitCode: 0, signal: null }
}

function parseDotEnv(text) {
  if (typeof text !== "string") throw new Error("EXPORT_PARSE_FAILED")
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const i = trimmed.indexOf("=")
    let value = trimmed.slice(i + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[trimmed.slice(0, i).trim()] = value
  }
  return out
}

function inspectPulledProductionEnv(dest, io) {
  const ops = io && typeof io === "object" ? io : {}
  const exists = typeof ops.existsSync === "function" ? ops.existsSync : null
  const readFile = typeof ops.readFileSync === "function" ? ops.readFileSync : null
  const parse = typeof ops.parseDotEnv === "function" ? ops.parseDotEnv : parseDotEnv
  if (typeof exists !== "function" || !exists(dest)) {
    throw envPullDiagnosticError("EXPORT_FILE_MISSING", { exportFileExists: false })
  }
  let text
  try {
    text = readFile(dest, "utf8")
  } catch {
    throw envPullDiagnosticError("EXPORT_READ_FAILED", { exportFileExists: true })
  }
  let parsed
  try {
    parsed = parse(text)
    if (!parsed || typeof parsed !== "object") throw new Error("EXPORT_PARSE_FAILED")
  } catch {
    throw envPullDiagnosticError("EXPORT_PARSE_FAILED", { exportFileExists: true })
  }
  const extracted = extractProductionSupabaseEnv(parsed)
  const hasServiceRoleKey = Object.prototype.hasOwnProperty.call(parsed, "SUPABASE_SERVICE_ROLE_KEY")
  const hasUrl = Boolean(extracted.url)
  const serviceRoleKeyNonEmpty = Boolean(extracted.serviceRoleKey)
  const extras = {
    exportFileExists: true,
    hasUrl,
    hasServiceRoleKey,
    serviceRoleKeyNonEmpty,
  }
  if (!hasUrl) {
    const error = envPullDiagnosticError("URL_ABSENT_OR_EMPTY", extras)
    error.code = "ENV_UNVERIFIED"
    error.message = "Production Supabase URL could not be read"
    throw error
  }
  if (!serviceRoleKeyNonEmpty) throw envPullDiagnosticError("SERVICE_ROLE_KEY_ABSENT_OR_EMPTY", extras)
  return { stage: "KEYS_PRESENT", extracted, ...extras }
}

function withTempProductionEnvDir(fn) {
  const fs = require("node:fs")
  const os = require("node:os")
  const path = require("node:path")
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finza-release-env-test-"))
  const dest = path.join(dir, "production.env")
  try {
    return fn({ dir, dest })
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
    }
  }
}

function resolveHostedReleaseMode(inputs) {
  const source = inputs && typeof inputs === "object" ? inputs : {}
  const confirm = source.confirm
  const mode = source.mode
  const diagnose = mode === "diagnose"
  const release = confirm === "RELEASE" && !diagnose
  return {
    runReleaseJob: release,
    runDiagnoseJob: diagnose,
    mayDeploy: release,
    releaseRequiresConfirm: true,
    scriptArgs: diagnose
      ? ["--preflight", "--expected-sha"]
      : ["--expected-sha"],
    includesPreflight: diagnose,
    includesDeploy: release,
  }
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
  toSafeEnvPullDiagnostic,
  envPullDiagnosticError,
  diagnoseSecretSafeChild,
  parseDotEnv,
  inspectPulledProductionEnv,
  resolveHostedReleaseMode,
  withTempProductionEnvDir,
  sanitizeToolVersions,
  extractSupabaseRef,
  buildDeployArgs,
  parseDeployedSha,
  assertCleanWorktree,
  aliasNames,
}
