/**
 * Accounting snapshot worker (522/539/544).
 */

import {
  processAccountingSnapshotJobs,
  processAccountingSnapshotsForPeriod,
} from "../accountingSnapshotWorker"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/server/accountingSnapshotCacheInvalidation", () => ({
  invalidateAccountingCachesForBusiness: jest.fn().mockResolvedValue(undefined),
  invalidatePnlReportCachesForBusiness: jest.fn().mockResolvedValue(undefined),
  invalidateDashboardMetricsCacheForBusiness: jest.fn(),
}))

function buildSupabase(handlers: Record<string, jest.Mock>) {
  return {
    rpc: jest.fn((name: string, args?: Record<string, unknown>) => {
      const fn = handlers[name]
      if (!fn) return Promise.resolve({ data: null, error: { message: `unexpected ${name}` } })
      return fn(args)
    }),
  } as unknown as SupabaseClient
}

describe("processAccountingSnapshotJobs", () => {
  it("processes dashboard and pnl via combined RPC", async () => {
    const complete = jest.fn().mockResolvedValue({ data: true, error: null })
    const refresh = jest.fn().mockResolvedValue({ data: { dashboard: 1, pnl: 2 }, error: null })

    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs: jest.fn().mockResolvedValue({
        data: [
          {
            id: "j1",
            business_id: "biz",
            period_start: "2026-05-01",
            period_end: "2026-05-31",
            job_type: "both",
            claim_token: "tok-1",
            attempts: 1,
          },
        ],
        error: null,
      }),
      finza_worker_refresh_period_snapshots: refresh,
      complete_accounting_snapshot_refresh_job: complete,
    })

    const result = await processAccountingSnapshotJobs(supabase, { batchSize: 5 })

    expect(result.claimed).toBe(1)
    expect(result.completed).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(result.triggerSource).toBe("global_recovery_worker")
    expect(refresh).toHaveBeenCalledWith({
      p_business_id: "biz",
      p_period_start: "2026-05-01",
      p_period_end: "2026-05-31",
      p_job_type: "both",
    })
    expect(complete).toHaveBeenCalledWith({ p_job_id: "j1", p_claim_token: "tok-1" })
  })

  it("marks job failed with backoff on worker error", async () => {
    const fail = jest.fn().mockResolvedValue({ data: null, error: null })

    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs: jest.fn().mockResolvedValue({
        data: [
          {
            id: "j2",
            business_id: "biz",
            period_start: "2026-06-01",
            period_end: "2026-06-30",
            job_type: "pnl",
            claim_token: "tok-2",
            attempts: 1,
          },
        ],
        error: null,
      }),
      finza_worker_refresh_period_snapshots: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: "boom" } }),
      fail_accounting_snapshot_refresh_job: fail,
    })

    const result = await processAccountingSnapshotJobs(supabase)

    expect(result.failed).toBe(1)
    expect(result.retried).toBe(1)
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        p_job_id: "j2",
        p_error: expect.stringContaining("boom"),
        p_claim_token: "tok-2",
      })
    )
  })

  it("respects bounded batch size on claim", async () => {
    const claim = jest.fn().mockResolvedValue({ data: [], error: null })
    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs: claim,
    })

    await processAccountingSnapshotJobs(supabase, { batchSize: 25, maxBatches: 1 })

    expect(claim).toHaveBeenCalledWith({ p_limit: 25, p_lease_seconds: 900 })
  })

  it("passes job_type pnl through to refresh RPC", async () => {
    const refresh = jest.fn().mockResolvedValue({ data: { pnl: 1 }, error: null })
    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs: jest.fn().mockResolvedValue({
        data: [
          {
            id: "j-pnl",
            business_id: "biz",
            period_start: "2026-07-01",
            period_end: "2026-07-31",
            job_type: "pnl",
            claim_token: "tok-pnl",
            attempts: 1,
          },
        ],
        error: null,
      }),
      finza_worker_refresh_period_snapshots: refresh,
      complete_accounting_snapshot_refresh_job: jest.fn().mockResolvedValue({ data: true, error: null }),
    })

    await processAccountingSnapshotJobs(supabase)
    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ p_job_type: "pnl" }))
  })
})

describe("processAccountingSnapshotsForPeriod", () => {
  it("exits immediately when scoped claim returns no jobs", async () => {
    const claim = jest.fn().mockResolvedValue({ data: [], error: null })
    const refresh = jest.fn()
    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs_for_period: claim,
      finza_worker_refresh_period_snapshots: refresh,
    })

    const result = await processAccountingSnapshotsForPeriod(supabase, {
      businessId: "biz-a",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      triggerSource: "post_transaction",
    })

    expect(result.claimed).toBe(0)
    expect(result.completed).toBe(0)
    expect(result.batches).toBe(1)
    expect(refresh).not.toHaveBeenCalled()
    expect(claim).toHaveBeenCalledWith({
      p_business_id: "biz-a",
      p_period_start: "2026-07-01",
      p_period_end: "2026-07-31",
      p_limit: 5,
      p_lease_seconds: 900,
    })
  })

  it("does not call the global claim RPC", async () => {
    const globalClaim = jest.fn().mockResolvedValue({ data: [], error: null })
    const scopedClaim = jest.fn().mockResolvedValue({ data: [], error: null })
    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs: globalClaim,
      claim_accounting_snapshot_refresh_jobs_for_period: scopedClaim,
    })

    await processAccountingSnapshotsForPeriod(supabase, {
      businessId: "biz-a",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    })

    expect(scopedClaim).toHaveBeenCalled()
    expect(globalClaim).not.toHaveBeenCalled()
  })

  it("refuses to process a job for another tenant returned by claim", async () => {
    const fail = jest.fn().mockResolvedValue({ data: null, error: null })
    const refresh = jest.fn()
    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs_for_period: jest.fn().mockResolvedValue({
        data: [
          {
            id: "foreign",
            business_id: "biz-other",
            period_start: "2026-07-01",
            period_end: "2026-07-31",
            job_type: "both",
            claim_token: "tok-x",
            attempts: 1,
          },
        ],
        error: null,
      }),
      finza_worker_refresh_period_snapshots: refresh,
      fail_accounting_snapshot_refresh_job: fail,
    })

    const result = await processAccountingSnapshotsForPeriod(supabase, {
      businessId: "biz-a",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    })

    expect(result.claimed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.completed).toBe(0)
    expect(refresh).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        p_job_id: "foreign",
        p_error: "scoped_claim_returned_unrelated_job",
      })
    )
  })

  it("completes scoped job with claim token and preserves job_type", async () => {
    const refresh = jest.fn().mockResolvedValue({ data: { dashboard: 1 }, error: null })
    const complete = jest.fn().mockResolvedValue({ data: true, error: null })
    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs_for_period: jest.fn().mockResolvedValue({
        data: [
          {
            id: "j-dash",
            business_id: "biz-a",
            period_start: "2026-07-01",
            period_end: "2026-07-31",
            job_type: "dashboard",
            claim_token: "tok-dash",
            attempts: 1,
          },
        ],
        error: null,
      }),
      finza_worker_refresh_period_snapshots: refresh,
      complete_accounting_snapshot_refresh_job: complete,
    })

    const result = await processAccountingSnapshotsForPeriod(supabase, {
      businessId: "biz-a",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      triggerSource: "stale_report_read",
    })

    expect(result.completed).toBe(1)
    expect(result.triggerSource).toBe("stale_report_read")
    expect(refresh).toHaveBeenCalledWith({
      p_business_id: "biz-a",
      p_period_start: "2026-07-01",
      p_period_end: "2026-07-31",
      p_job_type: "dashboard",
    })
    expect(complete).toHaveBeenCalledWith({
      p_job_id: "j-dash",
      p_claim_token: "tok-dash",
    })
  })

  it("leaves durable recovery state when refresh throws", async () => {
    const fail = jest.fn().mockResolvedValue({ data: null, error: null })
    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs_for_period: jest.fn().mockResolvedValue({
        data: [
          {
            id: "j-fail",
            business_id: "biz-a",
            period_start: "2026-07-01",
            period_end: "2026-07-31",
            job_type: "both",
            claim_token: "tok-fail",
            attempts: 2,
          },
        ],
        error: null,
      }),
      finza_worker_refresh_period_snapshots: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: "refresh_threw" } }),
      fail_accounting_snapshot_refresh_job: fail,
    })

    const result = await processAccountingSnapshotsForPeriod(supabase, {
      businessId: "biz-a",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    })

    expect(result.failed).toBe(1)
    expect(result.retried).toBe(1)
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        p_job_id: "j-fail",
        p_claim_token: "tok-fail",
        p_error: expect.stringContaining("refresh_threw"),
      })
    )
  })

  it("two concurrent scoped processors each use scoped claim only", async () => {
    const scopedClaim = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "j1",
            business_id: "biz-a",
            period_start: "2026-07-01",
            period_end: "2026-07-31",
            job_type: "both",
            claim_token: "t1",
            attempts: 1,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })

    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs_for_period: scopedClaim,
      claim_accounting_snapshot_refresh_jobs: jest.fn(),
      finza_worker_refresh_period_snapshots: jest.fn().mockResolvedValue({ data: {}, error: null }),
      complete_accounting_snapshot_refresh_job: jest.fn().mockResolvedValue({ data: true, error: null }),
    })

    const [a, b] = await Promise.all([
      processAccountingSnapshotsForPeriod(supabase, {
        businessId: "biz-a",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
      processAccountingSnapshotsForPeriod(supabase, {
        businessId: "biz-a",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    ])

    expect(a.claimed + b.claimed).toBe(1)
    expect(a.completed + b.completed).toBe(1)
    expect(scopedClaim).toHaveBeenCalledTimes(2)
  })
})
