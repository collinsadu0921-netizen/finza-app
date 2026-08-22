#!/usr/bin/env node
/**
 * Authoritative Finza production release.
 *
 * Production at https://app.finza.africa must run Node/serverless functions in arn1.
 * This script is the only intended production release path.
 *
 *   node scripts/release-production.mjs
 *   node scripts/release-production.mjs --preflight
 *   node scripts/release-production.mjs --verify-only
 *
 * --preflight and --verify-only both prove candidate SHA, clean worktree,
 * project, ARN1 default, production URL, and production service-role identity.
 * They never deploy.
 *
 * --verify-only also inspects the live production alias/region/crons.
 * It does NOT require the live deployment SHA to equal the undeployed candidate.
 * A real release still requires the deployed SHA to equal the candidate SHA.
 *
 * Application rollback (stay on ARN1):
 *   checkout the previous good SHA in a clean worktree
 *   node scripts/release-production.mjs
 *
 * Emergency infrastructure rollback to IAD1 — not an application rollback:
 *   npx vercel rollback dpl_Co9VhCdhSCG98iRYrDx9WefwRquS --yes
 */

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const {
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
  assertProductionSupabasePair,
  classifyServiceRoleCredential,
  evaluateOpaqueSecretVerifierStatus,
  buildOpaqueSecretIdentityRequest,
  extractProductionSupabaseEnv,
  toSafeReleaseFailure,
  buildDeployArgs,
  parseDeployedSha,
  assertCleanWorktree,
} = require("./lib/productionReleaseGuards.cjs")

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const TEAM_QUERY = `teamId=${PRODUCTION.teamId}`

function parseArgs(argv) {
  const args = { verifyOnly: false, preflight: false, expectedSha: null }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--verify-only") args.verifyOnly = true
    else if (token === "--preflight") args.preflight = true
    else if (token === "--expected-sha") {
      args.expectedSha = argv[i + 1] || ""
      i += 1
    } else {
      throw new ReleaseGuardError("BAD_ARGS", `Unknown argument: ${token}`)
    }
  }
  return args
}

function parseDotEnv(text) {
  const out = {}
  for (const line of String(text || "").split(/\r?\n/)) {
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

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0) {
        const error = new ReleaseGuardError(
          opts.failCode || "COMMAND_FAILED",
          `${command} ${args.join(" ")} failed (${code})`,
        )
        error.stdout = stdout
        error.stderr = stderr
        error.exitCode = code
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function gitOutput(args) {
  const { stdout } = await run("git", args, { failCode: "GIT_FAILED" })
  return stdout.trim()
}

function runSecretSafe(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    child.stdout.on("data", () => {})
    child.stderr.on("data", () => {})
    child.on("error", () => {
      reject(
        new ReleaseGuardError(
          "SERVICE_ROLE_ENV_UNVERIFIED",
          "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
        ),
      )
    })
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new ReleaseGuardError(
            "SERVICE_ROLE_ENV_UNVERIFIED",
            "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
          ),
        )
        return
      }
      resolve()
    })
  })
}

async function discardResponseBody(res) {
  try {
    if (res && res.body && typeof res.body.cancel === "function") {
      await res.body.cancel()
      return
    }
    if (res && typeof res.arrayBuffer === "function") {
      await res.arrayBuffer()
    }
  } catch {
    // Body is discarded; never inspect or log it.
  }
}

async function proveOpaqueSecretIdentity(url, secret, fetchImpl = fetch) {
  const request = buildOpaqueSecretIdentityRequest(url)
  let status
  try {
    const res = await fetchImpl(request.url, {
      method: request.method,
      headers: {
        Accept: "application/json",
        apikey: secret,
      },
    })
    status = res.status
    await discardResponseBody(res)
  } catch {
    throw new ReleaseGuardError(
      "SERVICE_ROLE_UNVERIFIED",
      "Production service-role credential could not be verified against the production project",
    )
  }
  const evaluated = evaluateOpaqueSecretVerifierStatus(status)
  if (!evaluated.accepted) {
    throw new ReleaseGuardError(
      "SERVICE_ROLE_UNVERIFIED",
      "Production service-role credential could not be verified against the production project",
    )
  }
  return { accepted: true, projectRef: PRODUCTION.supabaseRef }
}

function ensureLocalProjectLink() {
  const vercelDir = join(ROOT, ".vercel")
  const projectFile = join(vercelDir, "project.json")
  const desired = {
    projectId: PRODUCTION.projectId,
    orgId: PRODUCTION.teamId,
    projectName: PRODUCTION.projectName,
  }
  if (existsSync(projectFile)) {
    const linked = JSON.parse(readFileSync(projectFile, "utf8"))
    assertProject({ id: linked.projectId, name: linked.projectName || PRODUCTION.projectName })
    if (linked.projectId !== PRODUCTION.projectId || linked.orgId !== PRODUCTION.teamId) {
      throw new ReleaseGuardError("WRONG_PROJECT", "Local .vercel/project.json is not finza-app production")
    }
    return
  }
  mkdirSync(vercelDir, { recursive: true })
  writeFileSync(projectFile, `${JSON.stringify(desired, null, 2)}\n`)
}

async function vercelApi(path) {
  const { stdout } = await run(
    "npx",
    ["vercel", "api", path],
    { failCode: "VERCEL_API_FAILED" },
  )
  const start = stdout.indexOf("{")
  if (start < 0) throw new ReleaseGuardError("VERCEL_API_FAILED", `No JSON in Vercel API response for ${path}`)
  return JSON.parse(stdout.slice(start))
}

async function readProductionSupabaseEnv() {
  const dir = mkdtempSync(join(tmpdir(), "finza-release-env-"))
  const dest = join(dir, "production.env")
  try {
    await runSecretSafe("npx", [
      "vercel",
      "env",
      "pull",
      dest,
      "--environment",
      "production",
      "--yes",
    ])
    if (!existsSync(dest)) {
      throw new ReleaseGuardError(
        "SERVICE_ROLE_ENV_UNVERIFIED",
        "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
      )
    }
    const extracted = extractProductionSupabaseEnv(parseDotEnv(readFileSync(dest, "utf8")))
    if (!extracted.url) {
      throw new ReleaseGuardError("ENV_UNVERIFIED", "Production Supabase URL could not be read")
    }
    if (!extracted.serviceRoleKey) {
      throw new ReleaseGuardError(
        "SERVICE_ROLE_ENV_UNVERIFIED",
        "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
      )
    }
    return extracted
  } catch (error) {
    if (error instanceof ReleaseGuardError) throw error
    throw new ReleaseGuardError(
      "SERVICE_ROLE_ENV_UNVERIFIED",
      "Could not securely read production SUPABASE_SERVICE_ROLE_KEY",
    )
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      if (existsSync(dest)) unlinkSync(dest)
    }
  }
}

function lastHttpsUrl(text) {
  const matches = [...String(text || "").matchAll(/https:\/\/[^\s]+/g)].map((m) => m[0].replace(/[.,)]+$/, ""))
  return matches.length ? matches[matches.length - 1] : ""
}

async function inspectText(deploymentId) {
  const { stdout, stderr } = await run(
    "npx",
    ["vercel", "inspect", deploymentId, "--scope", PRODUCTION.teamId],
    { failCode: "INSPECT_FAILED" },
  )
  return `${stdout}\n${stderr}`
}

async function liveRegionEvidence(deploymentId) {
  const res = await fetch("https://app.finza.africa/api/invoices/list", { redirect: "manual" })
  const header = res.headers.get("x-vercel-id")
  const region = parseXVercelIdRegion(header)
  if (!region) {
    throw new ReleaseGuardError("UNKNOWN_REGION", "Live x-vercel-id did not include a function region")
  }
  assertRegion(region)

  const versionRes = await fetch("https://app.finza.africa/api/health/version", { redirect: "manual" })
  if (versionRes.status === 200) {
    const body = await versionRes.json()
    if (body.region) assertRegion(body.region)
    const headerRegion = versionRes.headers.get("x-finza-region")
    if (headerRegion) assertRegion(headerRegion)
  } else if (versionRes.status !== 404) {
    throw new ReleaseGuardError(
      "VERSION_UNVERIFIED",
      `GET /api/health/version returned ${versionRes.status}`,
    )
  }

  return { deploymentId, header, region, healthStatus: versionRes.status }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const head = await gitOutput(["rev-parse", "HEAD"])
  const expectedSha = assertExpectedSha(args.expectedSha || head)
  if (normalizeCompare(args.expectedSha, head) === false) {
    throw new ReleaseGuardError("SHA_MISMATCH", "--expected-sha does not match HEAD")
  }
  assertCleanWorktree(await gitOutput(["status", "--porcelain"]))
  ensureLocalProjectLink()

  const project = await vercelApi(`/v9/projects/${PRODUCTION.projectId}?${TEAM_QUERY}`)
  assertProject({ id: project.id, name: project.name })
  assertProjectDefaultRegion({
    serverlessFunctionRegion: project.serverlessFunctionRegion,
    functionDefaultRegions: project.defaultResourceConfig?.functionDefaultRegions,
    resourceFunctionRegions: project.resourceConfig?.functionDefaultRegions,
  })
  const supabaseEnv = await readProductionSupabaseEnv()
  const credentialFormat = classifyServiceRoleCredential(supabaseEnv.serviceRoleKey)
  let opaqueProof
  if (credentialFormat === "secret") {
    opaqueProof = await proveOpaqueSecretIdentity(supabaseEnv.url, supabaseEnv.serviceRoleKey)
  }
  const supabasePair = assertProductionSupabasePair(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
    opaqueProof,
  })
  supabaseEnv.serviceRoleKey = ""

  if (args.preflight) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          preflight: true,
          deployed: false,
          project: PRODUCTION.projectName,
          projectId: PRODUCTION.projectId,
          sha: expectedSha,
          region: PRODUCTION.region,
          supabase_ref: PRODUCTION.supabaseRef,
          service_role_format: supabasePair.format,
          service_role_ref: supabasePair.ref,
        },
        null,
        2,
      ),
    )
    return
  }

  let deploymentId = project.targets?.production?.id
  if (!args.verifyOnly) {
    const deployArgs = [
      ...buildDeployArgs(expectedSha),
      "--scope",
      PRODUCTION.teamId,
    ]
    const deployed = await run("npx", ["vercel", ...deployArgs], { failCode: "DEPLOY_FAILURE" })
    const url = lastHttpsUrl(`${deployed.stdout}\n${deployed.stderr}`)
    if (!url) throw new ReleaseGuardError("DEPLOY_FAILURE", "Deploy succeeded but no deployment URL was returned")
    const created = await vercelApi(`/v13/deployments/${encodeURIComponent(url.replace(/^https:\/\//, ""))}?${TEAM_QUERY}`)
    deploymentId = created.id || created.uid
    if (!deploymentId) throw new ReleaseGuardError("MISSING_DEPLOYMENT", "Deployed deployment id is missing")
  }

  if (!deploymentId) throw new ReleaseGuardError("MISSING_DEPLOYMENT", "Production deployment id is missing")

  const deployment = await vercelApi(`/v13/deployments/${deploymentId}?${TEAM_QUERY}`)
  assertProject({ id: deployment.projectId || project.id, name: deployment.name || project.name })
  assertProductionTarget(deployment.target)
  assertReady(deployment.readyState)
  const liveSha = parseDeployedSha(deployment)
  if (!args.verifyOnly) {
    assertShaMatch(expectedSha, liveSha)
  }
  assertRegion(deployment.regions)

  const inspect = await inspectText(deployment.id)
  assertRegion(parseInspectFunctionRegions(inspect))

  const after = await vercelApi(`/v9/projects/${PRODUCTION.projectId}?${TEAM_QUERY}`)
  assertProject({ id: after.id, name: after.name })
  if (after.targets?.production?.id !== deployment.id) {
    throw new ReleaseGuardError(
      "ALIAS_MISMATCH",
      "Deployment is READY but the production target points elsewhere",
    )
  }
  assertAlias(deployment.alias, deployment.id, after.targets.production.id)
  assertCrons(after.crons?.definitions || [])
  if (after.crons?.deploymentId && after.crons.deploymentId !== deployment.id) {
    throw new ReleaseGuardError("CRON_MISMATCH", "Cron host is not the intended production deployment")
  }

  await liveRegionEvidence(deployment.id)

  console.log(
    JSON.stringify(
      {
        ok: true,
        project: PRODUCTION.projectName,
        projectId: PRODUCTION.projectId,
        sha: expectedSha,
        live_sha: liveSha || null,
        live_sha_matches_candidate: Boolean(liveSha) && liveSha === expectedSha,
        deploymentId: deployment.id,
        region: PRODUCTION.region,
        alias: PRODUCTION.domain,
        verifyOnly: args.verifyOnly,
        deployed: !args.verifyOnly,
        supabase_ref: PRODUCTION.supabaseRef,
        service_role_format: supabasePair.format,
        service_role_ref: supabasePair.ref,
      },
      null,
      2,
    ),
  )
}

function normalizeCompare(expected, head) {
  if (!expected) return true
  return String(expected).trim().toLowerCase() === String(head).trim().toLowerCase()
}

main().catch((error) => {
  console.error(JSON.stringify(toSafeReleaseFailure(error), null, 2))
  process.exit(1)
})
