/**
 * Accounting snapshot worker (522).
 */

import { processAccountingSnapshotJobs } from "../accountingSnapshotWorker"
import type { SupabaseClient } from "@supabase/supabase-js"

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
  it("processes dashboard and pnl for both job type", async () => {
    const complete = jest.fn().mockResolvedValue({ data: null, error: null })
    const dashboard = jest.fn().mockResolvedValue({ data: 1, error: null })
    const pnl = jest.fn().mockResolvedValue({ data: 2, error: null })

    const supabase = buildSupabase({
      claim_accounting_snapshot_refresh_jobs: jest.fn().mockResolvedValue({
        data: [
          {
            id: "j1",
            business_id: "biz",
            period_start: "2026-05-01",
            period_end: "2026-05-31",
            job_type: "both",
          },
        ],
        error: null,
      }),
      finza_worker_refresh_dashboard_period_summary: dashboard,
      finza_worker_refresh_pnl_snapshot: pnl,
      complete_accounting_snapshot_refresh_job: complete,
    })

    const result = await processAccountingSnapshotJobs(supabase, { batchSize: 5 })

    expect(result.claimed).toBe(1)
    expect(result.completed).toBe(1)
    expect(result.failed).toBe(0)
    expect(dashboard).toHaveBeenCalled()
    expect(pnl).toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith({ p_job_id: "j1" })
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
          },
        ],
        error: null,
      }),
      finza_worker_refresh_pnl_snapshot: jest
        .fn()
        .mockResolvedValue({ data: null, error: { message: "boom" } }),
      fail_accounting_snapshot_refresh_job: fail,
    })

    const result = await processAccountingSnapshotJobs(supabase)

    expect(result.failed).toBe(1)
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ p_job_id: "j2", p_error: expect.stringContaining("boom") })
    )
  })
})
