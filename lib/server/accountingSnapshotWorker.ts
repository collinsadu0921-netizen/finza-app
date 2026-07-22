/**
 * Accounting snapshot refresh worker (522/539).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  invalidateDashboardMetricsCacheForBusiness,
  invalidatePnlReportCachesForBusiness,
} from "@/lib/server/accountingSnapshotCacheInvalidation"

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
  claim_token?: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type SnapshotWorkerResult = {
  claimed: number
  completed: number
  failed: number
  retried: number
  batches: number
  errors: Array<{ jobId: string; error: string }>
}

const DEFAULT_BATCH = 10
const MAX_BATCH = 50
const MAX_ATTEMPTS = 5
const DEFAULT_LEASE_SECONDS = 900
/** Stop claiming new batches this many ms before the platform timeout. */
const DEFAULT_TIME_BUDGET_MS = 50_000

export async function processAccountingSnapshotJobs(
  supabase: SupabaseClient,
  options?: {
    batchSize?: number
    maxAttempts?: number
    leaseSeconds?: number
    /** Process multiple claim batches until empty or time budget exhausted. */
    maxBatches?: number
    timeBudgetMs?: number
  }
): Promise<SnapshotWorkerResult> {
  const batchSize = Math.min(MAX_BATCH, Math.max(1, options?.batchSize ?? DEFAULT_BATCH))
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS
  const leaseSeconds = options?.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  const maxBatches = Math.min(20, Math.max(1, options?.maxBatches ?? 1))
  const timeBudgetMs = Math.max(5_000, options?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS)
  const started = Date.now()

  const result: SnapshotWorkerResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    batches: 0,
    errors: [],
  }

  const touchedBusinesses = new Set<string>()

  for (let batch = 0; batch < maxBatches; batch++) {
    if (Date.now() - started >= timeBudgetMs) break

    const { data: jobs, error: claimError } = await supabase.rpc(
      "claim_accounting_snapshot_refresh_jobs",
      { p_limit: batchSize, p_lease_seconds: leaseSeconds }
    )

    if (claimError) {
      throw new Error(`claim_accounting_snapshot_refresh_jobs failed: ${claimError.message}`)
    }

    const claimed = (jobs ?? []) as SnapshotRefreshJob[]
    result.batches++
    if (claimed.length === 0) break

    result.claimed += claimed.length

    for (const job of claimed) {
      if (Date.now() - started >= timeBudgetMs) {
        // Return unprocessed claimed jobs to pending via fail/retry path with soft error.
        await supabase.rpc("fail_accounting_snapshot_refresh_job", {
          p_job_id: job.id,
          p_error: "worker_time_budget_exhausted",
          p_max_attempts: Math.max(maxAttempts, (job.attempts ?? 1) + 1),
          p_backoff_seconds: 5,
          p_claim_token: job.claim_token ?? null,
        })
        result.retried++
        continue
      }

      try {
        await processOneJob(supabase, job)
        const { error: completeError } = await supabase.rpc(
          "complete_accounting_snapshot_refresh_job",
          {
            p_job_id: job.id,
            p_claim_token: job.claim_token ?? null,
          }
        )
        if (completeError) {
          throw new Error(completeError.message)
        }
        result.completed++
        touchedBusinesses.add(job.business_id)
      } catch (err) {
        const message = sanitizeWorkerError(err)
        result.failed++
        result.errors.push({ jobId: job.id, error: message })
        const { data: failData } = await supabase.rpc("fail_accounting_snapshot_refresh_job", {
          p_job_id: job.id,
          p_error: message,
          p_max_attempts: maxAttempts,
          p_backoff_seconds: 60,
          p_claim_token: job.claim_token ?? null,
        })
        void failData
        if ((job.attempts ?? 1) < maxAttempts) {
          result.retried++
        }
      }
    }

    if (claimed.length < batchSize) break
  }

  for (const businessId of touchedBusinesses) {
    await invalidatePnlReportCachesForBusiness(businessId)
    invalidateDashboardMetricsCacheForBusiness(businessId)
  }

  return result
}

async function processOneJob(supabase: SupabaseClient, job: SnapshotRefreshJob): Promise<void> {
  const { business_id: businessId, period_start: periodStart, period_end: periodEnd, job_type: jobType } =
    job

  const { error } = await supabase.rpc("finza_worker_refresh_period_snapshots", {
    p_business_id: businessId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_job_type: jobType,
  })
  if (error) throw new Error(`period refresh failed: ${error.message}`)
}

function sanitizeWorkerError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "unknown_worker_error"
  return raw
    .replace(/postgresql:\/\/[^\s]+/gi, "[redacted_db_url]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 500)
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

export async function fetchAccountingSnapshotQueueDiagnostics(
  supabase: SupabaseClient,
  businessId?: string | null
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("get_accounting_snapshot_queue_diagnostics", {
    p_business_id: businessId ?? null,
  })
  if (error) {
    throw new Error(`get_accounting_snapshot_queue_diagnostics failed: ${error.message}`)
  }
  return (data ?? {}) as Record<string, unknown>
}
