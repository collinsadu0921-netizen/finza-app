import { NextRequest, NextResponse } from "next/server"

import { createSupabaseAdminClient } from "@/lib/supabaseAdmin"
import { processAccountingSnapshotJobs } from "@/lib/server/accountingSnapshotWorker"

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

  const url = new URL(request.url)
  const batchRaw = url.searchParams.get("batch")
  const batchesRaw = url.searchParams.get("batches")
  const batchSize = batchRaw ? parseInt(batchRaw, 10) : 20
  const maxBatches = batchesRaw ? parseInt(batchesRaw, 10) : 5

  const supabase = createSupabaseAdminClient()
  const result = await processAccountingSnapshotJobs(supabase, {
    batchSize: Number.isFinite(batchSize) ? batchSize : 20,
    maxBatches: Number.isFinite(maxBatches) ? maxBatches : 5,
    timeBudgetMs: 50_000,
  })

  return NextResponse.json({
    claimed: result.claimed,
    completed: result.completed,
    retried: result.retried,
    failed: result.failed,
    batches: result.batches,
    error_count: result.errors.length,
  })
}

export async function GET(request: NextRequest) {
  return run(request)
}

export async function POST(request: NextRequest) {
  return run(request)
}
