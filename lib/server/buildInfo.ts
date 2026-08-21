/**
 * Non-sensitive build/runtime identity for deploy verification.
 * Never include secrets, hosts, database identifiers, or user data.
 */

export type PublicBuildInfo = {
  commit_sha: string | null
  environment: string
  region: string | null
}

export function publicBuildInfo(): PublicBuildInfo {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null
  const environment =
    process.env.VERCEL_ENV?.trim() ||
    process.env.NODE_ENV?.trim() ||
    "unknown"
  const region = process.env.VERCEL_REGION?.trim() || null
  return {
    commit_sha: sha && /^[a-f0-9]{7,40}$/i.test(sha) ? sha : null,
    environment,
    region,
  }
}

export function runtimeRegion(): string | null {
  return process.env.VERCEL_REGION?.trim() || null
}
