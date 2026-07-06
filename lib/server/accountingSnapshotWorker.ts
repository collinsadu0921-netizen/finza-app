/**
 * Accounting snapshot refresh worker (522).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type SnapshotRefreshJob = {
  id: string
  business_id: string
  period_start: string
  period_end: string
  job_type: "dashboard" | "pnl" | "both"
  reason: string
  source_type: string | null
  source_id: string | null
  status: string
  attempts: number
  next_run_at: string
  locked_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type SnapshotWorkerResult = {
  claimed: number
  completed: number
  failed: number
  errors: Array<{ jobId: string; error: string }>
}

const DEFAULT_BATCH = 10
const MAX_ATTEMPTS = 5

export async function processAccountingSnapshotJobs(
  supabase: SupabaseClient,
  options?: { batchSize?: number; maxAttempts?: number }
): Promise<SnapshotWorkerResult> {
  const batchSize = Math.min(50, Math.max(1, options?.batchSize ?? DEFAULT_BATCH))
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS

  const { data: jobs, error: claimError } = await supabase.rpc(
    "claim_accounting_snapshot_refresh_jobs",
    { p_limit: batchSize }
  )

  if (claimError) {
    throw new Error(`claim_accounting_snapshot_refresh_jobs failed: ${claimError.message}`)
  }

  const claimed = (jobs ?? []) as SnapshotRefreshJob[]
  const result: SnapshotWorkerResult = {
    claimed: claimed.length,
    completed: 0,
    failed: 0,
    errors: [],
  }

  for (const job of claimed) {
    try {
      await processOneJob(supabase, job)
      const { error: completeError } = await supabase.rpc(
        "complete_accounting_snapshot_refresh_job",
        { p_job_id: job.id }
      )
      if (completeError) {
        throw new Error(completeError.message)
      }
      result.completed++
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown_worker_error"
      result.failed++
      result.errors.push({ jobId: job.id, error: message })
      await supabase.rpc("fail_accounting_snapshot_refresh_job", {
        p_job_id: job.id,
        p_error: message,
        p_max_attempts: maxAttempts,
        p_backoff_seconds: 60,
      })
    }
  }

  return result
}

async function processOneJob(supabase: SupabaseClient, job: SnapshotRefreshJob): Promise<void> {
  const { business_id: businessId, period_start: periodStart, period_end: periodEnd, job_type: jobType } =
    job

  if (jobType === "dashboard" || jobType === "both") {
    const { error } = await supabase.rpc("finza_worker_refresh_dashboard_period_summary", {
      p_business_id: businessId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    if (error) throw new Error(`dashboard refresh failed: ${error.message}`)
  }

  if (jobType === "pnl" || jobType === "both") {
    const { error } = await supabase.rpc("finza_worker_refresh_pnl_snapshot", {
      p_business_id: businessId,
      p_period_start: periodStart,
      p_period_end: periodEnd,
    })
    if (error) throw new Error(`pnl refresh failed: ${error.message}`)
  }
}

export async function fetchAccountingSnapshotHealth(
  supabase: SupabaseClient
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("get_accounting_snapshot_health")
  if (error) {
    throw new Error(`get_accounting_snapshot_health failed: ${error.message}`)
  }
  return (data ?? {}) as Record<string, unknown>
}
