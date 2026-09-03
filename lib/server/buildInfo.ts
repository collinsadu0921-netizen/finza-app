/**
 * Non-sensitive build/runtime identity for deploy verification.
 * Never include secrets, hosts, database identifiers, or user data.
 *
 * Commit sources (first match wins):
 * - VERCEL_GIT_COMMIT_SHA: set automatically for Git-connected Vercel builds
 * - FINZA_BUILD_COMMIT_SHA: injected by the guarded CLI release deploy for
 *   non-Git production releases (same SHA the release script deploys)
 */

export type PublicBuildInfo = {
  commit_sha: string | null
  environment: string
  region: string | null
}

function normalizeCommitSha(value: string | null | undefined): string | null {
  const sha = typeof value === "string" ? value.trim() : ""
  return sha && /^[a-f0-9]{7,40}$/i.test(sha) ? sha : null
}

export function publicBuildInfo(): PublicBuildInfo {
  const sha =
    normalizeCommitSha(process.env.VERCEL_GIT_COMMIT_SHA) ||
    normalizeCommitSha(process.env.FINZA_BUILD_COMMIT_SHA)
  const environment =
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "unknown"
  const region = process.env.VERCEL_REGION?.trim() || null
  return {
    commit_sha: sha,
    environment,
    region,
  }
}

export function runtimeRegion(): string | null {
  return process.env.VERCEL_REGION?.trim() || null
}
