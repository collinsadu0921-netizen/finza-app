/**
 * Accounting snapshot refresh worker (522/539/544).
 * Global recovery drain + tenant/period-scoped immediate processor share per-job logic.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { invalidateAccountingCachesForBusiness } from "@/lib/server/accountingSnapshotCacheInvalidation"

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

export type SnapshotRefreshTriggerSource =
  | "post_transaction"
  | "stale_report_read"
  | "stale_dashboard_read"
  | "global_recovery_worker"

export type SnapshotWorkerResult = {
  claimed: number
  completed: number
  failed: number
  retried: number
  batches: number
  errors: Array<{ jobId: string; error: string }>
  elapsedMs: number
  triggerSource?: SnapshotRefreshTriggerSource
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
  const triggerSource: SnapshotRefreshTriggerSource = "global_recovery_worker"

  const result: SnapshotWorkerResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    batches: 0,
    errors: [],
    elapsedMs: 0,
    triggerSource,
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
        await failClaimedJob(supabase, job, "worker_time_budget_exhausted", {
          maxAttempts: Math.max(maxAttempts, (job.attempts ?? 1) + 1),
          backoffSeconds: 5,
        })
        result.retried++
        continue
      }

      const outcome = await processClaimedSnapshotJob(supabase, job, {
        maxAttempts,
        triggerSource,
      })
      applyJobOutcome(result, outcome)
      if (outcome.kind === "completed") {
        touchedBusinesses.add(job.business_id)
      }
    }

    if (claimed.length < batchSize) break
  }

  for (const businessId of touchedBusinesses) {
    await invalidateAccountingCachesForBusiness(businessId)
  }

  result.elapsedMs = Date.now() - started
  logSnapshotWorkerResult(result, { scoped: false })
  return result
}

/**
 * Claim and process only jobs for one business-period.
 * Empty claim returns immediately (authoritative concurrency gate).
 */
export async function processAccountingSnapshotsForPeriod(
  supabase: SupabaseClient,
  input: {
    businessId: string
    periodStart: string
    periodEnd: string
    maxJobs?: number
    maxAttempts?: number
    leaseSeconds?: number
    triggerSource?: SnapshotRefreshTriggerSource
  }
): Promise<SnapshotWorkerResult> {
  const started = Date.now()
  const maxJobs = Math.min(MAX_BATCH, Math.max(1, input.maxJobs ?? 5))
  const maxAttempts = input.maxAttempts ?? MAX_ATTEMPTS
  const leaseSeconds = input.leaseSeconds ?? DEFAULT_LEASE_SECONDS
  const triggerSource = input.triggerSource ?? "post_transaction"

  const result: SnapshotWorkerResult = {
    claimed: 0,
    completed: 0,
    failed: 0,
    retried: 0,
    batches: 1,
    errors: [],
    elapsedMs: 0,
    triggerSource,
  }

  const { data: jobs, error: claimError } = await supabase.rpc(
    "claim_accounting_snapshot_refresh_jobs_for_period",
    {
      p_business_id: input.businessId,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_limit: maxJobs,
      p_lease_seconds: leaseSeconds,
    }
  )

  if (claimError) {
    throw new Error(
      `claim_accounting_snapshot_refresh_jobs_for_period failed: ${claimError.message}`
    )
  }

  const claimed = (jobs ?? []) as SnapshotRefreshJob[]
  if (claimed.length === 0) {
    result.elapsedMs = Date.now() - started
    logSnapshotWorkerResult(result, {
      scoped: true,
      businessId: input.businessId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    })
    return result
  }

  result.claimed = claimed.length
  const touchedBusinesses = new Set<string>()

  for (const job of claimed) {
    // Defense in depth — scoped RPC must already filter, never process other tenants.
    if (
      job.business_id !== input.businessId ||
      job.period_start !== input.periodStart ||
      job.period_end !== input.periodEnd
    ) {
      result.failed++
      result.errors.push({
        jobId: job.id,
        error: "scoped_claim_returned_unrelated_job",
      })
      await failClaimedJob(supabase, job, "scoped_claim_returned_unrelated_job", {
        maxAttempts,
        backoffSeconds: 30,
      })
      continue
    }

    const outcome = await processClaimedSnapshotJob(supabase, job, {
      maxAttempts,
      triggerSource,
    })
    applyJobOutcome(result, outcome)
    if (outcome.kind === "completed") {
      touchedBusinesses.add(job.business_id)
    }
  }

  for (const businessId of touchedBusinesses) {
    await invalidateAccountingCachesForBusiness(businessId)
  }

  result.elapsedMs = Date.now() - started
  logSnapshotWorkerResult(result, {
    scoped: true,
    businessId: input.businessId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  })
  return result
}

type JobOutcome =
  | { kind: "completed"; jobId: string }
  | { kind: "failed"; jobId: string; error: string; retried: boolean }

export async function processClaimedSnapshotJob(
  supabase: SupabaseClient,
  job: SnapshotRefreshJob,
  options: {
    maxAttempts: number
    triggerSource: SnapshotRefreshTriggerSource
  }
): Promise<JobOutcome> {
  try {
    await refreshPeriodSnapshotsForJob(supabase, job)
    const { data: completed, error: completeError } = await supabase.rpc(
      "complete_accounting_snapshot_refresh_job",
      {
        p_job_id: job.id,
        p_claim_token: job.claim_token ?? null,
      }
    )
    if (completeError) {
      throw new Error(completeError.message)
    }
    if (completed === false) {
      throw new Error("complete_accounting_snapshot_refresh_job rejected claim_token")
    }
    return { kind: "completed", jobId: job.id }
  } catch (err) {
    const message = sanitizeWorkerError(err)
    await failClaimedJob(supabase, job, message, {
      maxAttempts: options.maxAttempts,
      backoffSeconds: 60,
    })
    return {
      kind: "failed",
      jobId: job.id,
      error: message,
      retried: (job.attempts ?? 1) < options.maxAttempts,
    }
  }
}

async function refreshPeriodSnapshotsForJob(
  supabase: SupabaseClient,
  job: SnapshotRefreshJob
): Promise<void> {
  const jobType = job.job_type
  if (jobType !== "dashboard" && jobType !== "pnl" && jobType !== "both") {
    throw new Error(`invalid job_type: ${String(jobType)}`)
  }

  const { error } = await supabase.rpc("finza_worker_refresh_period_snapshots", {
    p_business_id: job.business_id,
    p_period_start: job.period_start,
    p_period_end: job.period_end,
    p_job_type: jobType,
  })
  if (error) throw new Error(`period refresh failed: ${error.message}`)
}

async function failClaimedJob(
  supabase: SupabaseClient,
  job: SnapshotRefreshJob,
  error: string,
  options: { maxAttempts: number; backoffSeconds: number }
): Promise<void> {
  const { data: failData } = await supabase.rpc("fail_accounting_snapshot_refresh_job", {
    p_job_id: job.id,
    p_error: error,
    p_max_attempts: options.maxAttempts,
    p_backoff_seconds: options.backoffSeconds,
    p_claim_token: job.claim_token ?? null,
  })
  void failData
}

function applyJobOutcome(result: SnapshotWorkerResult, outcome: JobOutcome): void {
  if (outcome.kind === "completed") {
    result.completed++
    return
  }
  result.failed++
  result.errors.push({ jobId: outcome.jobId, error: outcome.error })
  if (outcome.retried) result.retried++
}

function logSnapshotWorkerResult(
  result: SnapshotWorkerResult,
  meta: {
    scoped: boolean
    businessId?: string
    periodStart?: string
    periodEnd?: string
  }
): void {
  console.info("[accounting-snapshot-worker]", {
    scoped: meta.scoped,
    business_id: meta.businessId ?? null,
    period_start: meta.periodStart ?? null,
    period_end: meta.periodEnd ?? null,
    trigger_source: result.triggerSource ?? null,
    claimed_count: result.claimed,
    completed_count: result.completed,
    failed_count: result.failed,
    retried_count: result.retried,
    elapsed_ms: result.elapsedMs,
    claim_token_presence: result.claimed > 0,
    error_count: result.errors.length,
  })
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
