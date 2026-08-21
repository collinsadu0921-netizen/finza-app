import { NextResponse } from "next/server"
import { publicBuildInfo } from "@/lib/server/buildInfo"

/**
 * GET /api/health/version
 * Public, non-sensitive deploy identity. No secrets, hosts, or user data.
 */
export async function GET() {
  const info = publicBuildInfo()
  const headers = new Headers({ "Content-Type": "application/json" })
  if (info.commit_sha) headers.set("X-Finza-Commit", info.commit_sha)
  if (info.region) headers.set("X-Finza-Region", info.region)
  return NextResponse.json(info, { status: 200, headers })
}
