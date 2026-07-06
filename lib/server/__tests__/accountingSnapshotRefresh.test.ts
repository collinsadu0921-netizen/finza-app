/**
 * enqueue_accounting_snapshot_refresh_job coalescing behavior (522) — app-layer contract.
 */

import { enqueueSnapshotRefreshJob } from "../accountingSnapshotRefresh"
import type { SupabaseClient } from "@supabase/supabase-js"

describe("enqueueSnapshotRefreshJob", () => {
  it("returns job id from RPC", async () => {
    const supabase = {
      rpc: jest.fn().mockResolvedValue({ data: "job-uuid", error: null }),
    } as unknown as SupabaseClient

    const id = await enqueueSnapshotRefreshJob(supabase, {
      businessId: "biz",
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      jobType: "both",
      reason: "ledger_change",
    })

    expect(id).toBe("job-uuid")
    expect(supabase.rpc).toHaveBeenCalledWith(
      "enqueue_accounting_snapshot_refresh_job",
      expect.objectContaining({
        p_business_id: "biz",
        p_job_type: "both",
      })
    )
  })
})
