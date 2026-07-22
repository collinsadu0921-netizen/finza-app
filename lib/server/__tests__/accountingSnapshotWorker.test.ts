/**
 * Accounting snapshot worker (522/539).
 */

import { processAccountingSnapshotJobs } from "../accountingSnapshotWorker"
import type { SupabaseClient } from "@supabase/supabase-js"

jest.mock("@/lib/server/accountingSnapshotCacheInvalidation", () => ({
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
})
