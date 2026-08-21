#!/usr/bin/env node
/**
 * Authoritative Finza production release.
 *
 * Production at https://app.finza.africa must run Node/serverless functions in arn1.
 * This script is the only intended production release path.
 *
 *   node scripts/release-production.mjs
 *   node scripts/release-production.mjs --verify-only
 *
 * Application rollback (stay on ARN1):
 *   checkout the previous good SHA in a clean worktree
 *   node scripts/release-production.mjs
 *
 * Emergency infrastructure rollback to IAD1 — not an application rollback:
 *   npx vercel rollback dpl_Co9VhCdhSCG98iRYrDx9WefwRquS --yes
 */

import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
  assertSupabaseIdentity,
  buildDeployArgs,
  parseDeployedSha,
  assertCleanWorktree,
} = require("./lib/productionReleaseGuards.cjs")

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const TEAM_QUERY = `teamId=${PRODUCTION.teamId}`

function parseArgs(argv) {
  const args = { verifyOnly: false, expectedSha: null }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === "--verify-only") args.verifyOnly = true
    else if (token === "--expected-sha") {
      args.expectedSha = argv[i + 1] || ""
      i += 1
    } else {
      throw new ReleaseGuardError("BAD_ARGS", `Unknown argument: ${token}`)
    }
  }
  return args
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

async function readProductionSupabaseUrl() {
  try {
    const { stdout } = await run(
      "npx",
      ["vercel", "env", "get", "NEXT_PUBLIC_SUPABASE_URL", "production", "--yes"],
      { failCode: "ENV_UNVERIFIED" },
    )
    const line = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => /supabase\.co/i.test(entry) || entry.includes(PRODUCTION.supabaseRef) || entry.includes(PRODUCTION.forbiddenSupabaseRef))
    if (line) return line
  } catch (error) {
    if (error instanceof ReleaseGuardError && error.code === "ENV_UNVERIFIED") {
      throw error
    }
  }
  throw new ReleaseGuardError("ENV_UNVERIFIED", "Could not read production NEXT_PUBLIC_SUPABASE_URL")
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
  assertSupabaseIdentity(await readProductionSupabaseUrl())

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
  assertShaMatch(expectedSha, parseDeployedSha(deployment))
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
        deploymentId: deployment.id,
        region: PRODUCTION.region,
        alias: PRODUCTION.domain,
        verifyOnly: args.verifyOnly,
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
  const code = error && error.code ? error.code : "RELEASE_FAILED"
  console.error(JSON.stringify({ ok: false, code, message: error.message }, null, 2))
  process.exit(1)
})
