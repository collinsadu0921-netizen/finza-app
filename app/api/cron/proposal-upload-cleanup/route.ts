import { NextRequest, NextResponse } from "next/server"
import { cleanupExpiredProposalUploads } from "@/lib/proposals/uploadCleanup"

export const dynamic = "force-dynamic"
export const maxDuration = 60

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 })
}

function assertCronAuth(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return unauthorized()
  const authHeader = request.headers.get("authorization")
  if (!authHeader || !authHeader.startsWith("Bearer ")) return unauthorized()
  const token = authHeader.slice(7).trim()
  if (!token || token !== cronSecret) return unauthorized()
  return null
}

async function run(request: NextRequest): Promise<NextResponse> {
  const denied = assertCronAuth(request)
  if (denied) return denied

  const result = await cleanupExpiredProposalUploads({
    olderThanMinutes: 120,
    limit: 200,
  })

  return NextResponse.json(result)
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
